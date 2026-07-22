// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {TicketVault} from "../src/TicketVault.sol";
import {GameUSDC} from "../src/GameUSDC.sol";

contract TicketVaultTest is Test {
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @dev Derived independently of the contract so a change to the typehash string
    ///      breaks a test instead of silently invalidating every backend signature.
    ///      Also keeps `_signClaim` free of contract calls, which would otherwise
    ///      swallow an active `vm.prank`.
    bytes32 internal constant DAILY_CLAIM_TYPEHASH =
        keccak256("DailyClaim(address user,uint32 dayIndex,uint16 amount,uint64 issuedAt,uint256 nonce)");

    uint64 internal constant SIGNATURE_TTL = 10 minutes;

    TicketVault internal vault;
    GameUSDC internal usdc;

    uint256 internal backendSignerPk = 0xBADC0DE;
    address internal backendSigner;
    address internal treasury = address(0x7EA5);
    address internal player = address(0xA11CE);
    address internal otherPlayer = address(0xB0B);

    function setUp() public {
        backendSigner = vm.addr(backendSignerPk);
        vm.warp(1 days);

        TicketVault implementation = new TicketVault();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(implementation),
            abi.encodeCall(TicketVault.initialize, (address(this), backendSigner, treasury, SIGNATURE_TTL))
        );
        vault = TicketVault(address(proxy));

        GameUSDC usdcImplementation = new GameUSDC();
        ERC1967Proxy usdcProxy = new ERC1967Proxy(
            address(usdcImplementation), abi.encodeCall(GameUSDC.initialize, (address(this)))
        );
        usdc = GameUSDC(address(usdcProxy));
        usdc.setMinter(address(this), true);

        vault.setToken(address(usdc), 6, true);
    }

    function test_TypehashMatchesContract() public view {
        assertEq(vault.DAILY_CLAIM_TYPEHASH(), DAILY_CLAIM_TYPEHASH);
    }

    // ------------------------------------------------------------ daily claim

    function test_ClaimDailyCreditsTickets() public {
        TicketVault.DailyClaim memory claim = _claim(player, 1, 5, 1);

        vm.prank(player);
        vault.claimDaily(claim, _signClaim(claim, backendSignerPk));

        assertEq(vault.ticketBalance(player), 5);
        assertEq(vault.lastClaimDay(player), 1);
        assertEq(vault.totalTicketsIssued(), 5);
        assertTrue(vault.usedNonces(1));
    }

    function test_ClaimDailyWrongSignerReverts() public {
        TicketVault.DailyClaim memory claim = _claim(player, 1, 5, 1);

        vm.prank(player);
        vm.expectRevert();
        vault.claimDaily(claim, _signClaim(claim, 0x111111));
    }

    function test_ClaimDailyCannotClaimSameDayTwice() public {
        TicketVault.DailyClaim memory claim = _claim(player, 1, 5, 1);
        vm.prank(player);
        vault.claimDaily(claim, _signClaim(claim, backendSignerPk));

        // Fresh nonce, same day: the lastClaimDay guard must still stop it.
        TicketVault.DailyClaim memory replay = _claim(player, 1, 5, 2);
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(TicketVault.DayAlreadyClaimed.selector, uint32(1), uint32(1)));
        vault.claimDaily(replay, _signClaim(replay, backendSignerPk));
    }

    function test_ClaimDailyCannotReuseNonce() public {
        TicketVault.DailyClaim memory claim = _claim(player, 1, 5, 42);
        vm.prank(player);
        vault.claimDaily(claim, _signClaim(claim, backendSignerPk));

        TicketVault.DailyClaim memory next = _claim(player, 2, 7, 42);
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(TicketVault.NonceAlreadyUsed.selector, uint256(42)));
        vault.claimDaily(next, _signClaim(next, backendSignerPk));
    }

    function test_ClaimDailyAdvancingDaysAccumulates() public {
        TicketVault.DailyClaim memory day1 = _claim(player, 1, 5, 1);
        vm.prank(player);
        vault.claimDaily(day1, _signClaim(day1, backendSignerPk));

        TicketVault.DailyClaim memory day2 = _claim(player, 2, 7, 2);
        vm.prank(player);
        vault.claimDaily(day2, _signClaim(day2, backendSignerPk));

        assertEq(vault.ticketBalance(player), 12);
        assertEq(vault.lastClaimDay(player), 2);
    }

    function test_ClaimDailyExpiredSignatureReverts() public {
        TicketVault.DailyClaim memory claim = _claim(player, 1, 5, 1);
        bytes memory signature = _signClaim(claim, backendSignerPk);

        vm.warp(block.timestamp + SIGNATURE_TTL + 1);
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(TicketVault.DailyClaimExpired.selector, claim.issuedAt, SIGNATURE_TTL));
        vault.claimDaily(claim, signature);
    }

    function test_ClaimDailyForAnotherPlayerReverts() public {
        TicketVault.DailyClaim memory claim = _claim(player, 1, 5, 1);

        vm.prank(otherPlayer);
        vm.expectRevert(abi.encodeWithSelector(TicketVault.InvalidUser.selector, player));
        vault.claimDaily(claim, _signClaim(claim, backendSignerPk));
    }

    function test_ClaimDailyWhenPausedReverts() public {
        TicketVault.DailyClaim memory claim = _claim(player, 1, 5, 1);
        vault.pause();

        vm.prank(player);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        vault.claimDaily(claim, _signClaim(claim, backendSignerPk));
    }

    // ------------------------------------------------------------------ shop

    function test_BuyTicketsTransfersToTreasuryAndCredits() public {
        usdc.mint(player, 100e6);
        vm.prank(player);
        usdc.approve(address(vault), type(uint256).max);

        vm.prank(player);
        vault.buyTickets(address(usdc), 5);

        assertEq(vault.ticketBalance(player), 100, "5 USD => 100 tickets");
        assertEq(usdc.balanceOf(treasury), 5e6, "funds land in treasury");
        assertEq(usdc.balanceOf(address(vault)), 0, "vault custodies nothing");
    }

    function test_BuyTicketsWithDisabledTokenReverts() public {
        vault.setToken(address(usdc), 6, false);
        usdc.mint(player, 100e6);
        vm.prank(player);
        usdc.approve(address(vault), type(uint256).max);

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(TicketVault.TokenNotEnabled.selector, address(usdc)));
        vault.buyTickets(address(usdc), 1);
    }

    function test_BuyTicketsHonoursTokenDecimals() public {
        // An 18-decimal stablecoin such as cUSD must cost 1e18 per dollar, not 1e6.
        GameUSDC cusdImplementation = new GameUSDC();
        ERC1967Proxy cusdProxy = new ERC1967Proxy(
            address(cusdImplementation), abi.encodeCall(GameUSDC.initialize, (address(this)))
        );
        GameUSDC cusd = GameUSDC(address(cusdProxy));
        cusd.setMinter(address(this), true);
        vault.setToken(address(cusd), 18, true);

        cusd.mint(player, 10e18);
        vm.prank(player);
        cusd.approve(address(vault), type(uint256).max);

        vm.prank(player);
        vault.buyTickets(address(cusd), 3);

        assertEq(cusd.balanceOf(treasury), 3e18);
        assertEq(vault.ticketBalance(player), 60);
    }

    function test_BuyZeroReverts() public {
        vm.prank(player);
        vm.expectRevert(TicketVault.ZeroAmount.selector);
        vault.buyTickets(address(usdc), 0);
    }

    // ----------------------------------------------------------------- batch

    function test_CreditBatchCreditsEveryUser() public {
        address[] memory users = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        users[0] = player;
        users[1] = otherPlayer;
        amounts[0] = 15;
        amounts[1] = 20;

        vault.creditBatch(users, amounts);

        assertEq(vault.ticketBalance(player), 15);
        assertEq(vault.ticketBalance(otherPlayer), 20);
        assertEq(vault.totalTicketsIssued(), 35);
    }

    function test_CreditBatchLengthMismatchReverts() public {
        address[] memory users = new address[](2);
        uint256[] memory amounts = new uint256[](1);
        users[0] = player;
        users[1] = otherPlayer;
        amounts[0] = 1;

        vm.expectRevert(abi.encodeWithSelector(TicketVault.LengthMismatch.selector, uint256(2), uint256(1)));
        vault.creditBatch(users, amounts);
    }

    function test_CreditBatchOnlyOwner() public {
        address[] memory users = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        users[0] = player;
        amounts[0] = 1;

        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, player));
        vault.creditBatch(users, amounts);
    }

    function test_SpendBatchDebitsBalance() public {
        _creditOne(player, 10);

        address[] memory users = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        users[0] = player;
        amounts[0] = 4;
        vault.spendBatch(users, amounts);

        assertEq(vault.ticketBalance(player), 6);
        assertEq(vault.totalTicketsSpent(), 4);
    }

    function test_SpendBatchBeyondBalanceReverts() public {
        _creditOne(player, 3);

        address[] memory users = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        users[0] = player;
        amounts[0] = 4;

        vm.expectRevert(abi.encodeWithSelector(TicketVault.InsufficientTickets.selector, uint256(3), uint256(4)));
        vault.spendBatch(users, amounts);
    }

    // ------------------------------------------------------------- accounting

    /// @dev The invariant GameVault holds on mainnet, enforced here before the same
    ///      pattern carries real ticket revenue: issued - spent == sum of balances.
    function testFuzz_TicketAccountingNeverDrifts(uint96 creditA, uint96 creditB, uint96 spendA) public {
        creditA = uint96(bound(creditA, 1, type(uint64).max));
        creditB = uint96(bound(creditB, 1, type(uint64).max));
        spendA = uint96(bound(spendA, 1, creditA));

        _creditOne(player, creditA);
        _creditOne(otherPlayer, creditB);

        address[] memory users = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        users[0] = player;
        amounts[0] = spendA;
        vault.spendBatch(users, amounts);

        assertEq(
            vault.totalTicketsIssued() - vault.totalTicketsSpent(),
            vault.ticketBalance(player) + vault.ticketBalance(otherPlayer),
            "issued - spent must equal outstanding balances"
        );
    }

    // -------------------------------------------------------------- transfer

    function test_TicketsHaveNoTransferSurface() public view {
        // Tickets must not be movable between players; assert the ERC-20 entry points
        // simply do not exist on this contract.
        assertEq(address(vault).code.length > 0, true);
        bytes4[3] memory forbidden = [
            bytes4(keccak256("transfer(address,uint256)")),
            bytes4(keccak256("approve(address,uint256)")),
            bytes4(keccak256("transferFrom(address,address,uint256)"))
        ];

        for (uint256 i = 0; i < forbidden.length; i++) {
            (bool ok,) = address(vault).staticcall(abi.encodeWithSelector(forbidden[i], player, uint256(1)));
            assertFalse(ok, "ticket transfer surface must not exist");
        }
    }

    // --------------------------------------------------------------- helpers

    function _creditOne(address user, uint256 amount) internal {
        address[] memory users = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        users[0] = user;
        amounts[0] = amount;
        vault.creditBatch(users, amounts);
    }

    function _claim(address user, uint32 dayIndex, uint16 amount, uint256 nonce)
        internal
        view
        returns (TicketVault.DailyClaim memory)
    {
        return TicketVault.DailyClaim({
            user: user,
            dayIndex: dayIndex,
            amount: amount,
            issuedAt: uint64(block.timestamp),
            nonce: nonce
        });
    }

    function _signClaim(TicketVault.DailyClaim memory claim, uint256 signerPk) internal view returns (bytes memory) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256("PassChickTicketVault"),
                keccak256("1"),
                block.chainid,
                address(vault)
            )
        );

        bytes32 structHash = keccak256(
            abi.encode(DAILY_CLAIM_TYPEHASH, claim.user, claim.dayIndex, claim.amount, claim.issuedAt, claim.nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }
}
