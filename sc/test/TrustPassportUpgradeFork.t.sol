// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {TrustPassport} from "../src/TrustPassport.sol";
import {TicketVault} from "../src/TicketVault.sol";

/// @notice Rehearses the V2 upgrade against the real mainnet proxy and its real storage.
/// @dev The unit tests upgrade a hand-written legacy stand-in; this one upgrades the
///      actual contract holding live player data, which is the only way to prove the
///      append-only layout holds against production bytes. Runs read-only inside a fork
///      and never touches the chain.
///
///      Requires network access:
///        forge test --match-contract TrustPassportUpgradeForkTest
///      Skips itself when the RPC is unreachable so offline runs stay green.
contract TrustPassportUpgradeForkTest is Test {
    address internal constant PASSPORT_PROXY = 0x4Bf6D3C0dBbC14eF0C7f2a4daeD7D97418Fc5aDf;
    address internal constant OWNER = 0x57394581E832cD31EE0233618c58035033D3cFB9;

    address internal constant SEPOLIA_TICKET_VAULT = 0x1490e6B836f552e8504fE6404C30953B15F899c8;
    address internal constant SEPOLIA_MOCK_USDC = 0x8FB74c2a678811aECC6Ed98Bd5Bc70E1119b7B61;

    string internal rpcUrl = vm.envOr("CELO_RPC_URL", string("https://forno.celo.org"));
    string internal sepoliaRpcUrl =
        vm.envOr("CELO_SEPOLIA_RPC_URL", string("https://forno.celo-sepolia.celo-testnet.org"));

    function test_MainnetUpgradePreservesLiveState() public {
        // Forno prunes state, so a pinned historical block gets rejected with
        // "block is out of range". Fork the chain head instead.
        try vm.createSelectFork(rpcUrl) {}
        catch {
            vm.skip(true);
            return;
        }
        vm.rollFork(block.number);

        TrustPassport passport = TrustPassport(PASSPORT_PROXY);

        // Snapshot the live V1 state before touching anything.
        address signerBefore = passport.backendSigner();
        address ownerBefore = passport.owner();
        bool nonceBefore = passport.usedNonces(1);

        assertEq(ownerBefore, OWNER, "fork sanity: expected owner");

        // Perform the upgrade exactly as DeployV2Contracts.upgradePassport() would.
        TrustPassport newImplementation = new TrustPassport();
        vm.prank(OWNER);
        passport.upgradeToAndCall(address(newImplementation), "");

        // V1 storage must read back byte-identical.
        assertEq(passport.backendSigner(), signerBefore, "backendSigner drifted");
        assertEq(passport.owner(), ownerBefore, "owner drifted");
        assertEq(passport.usedNonces(1), nonceBefore, "nonce mapping drifted");

        // V2 slots must start empty rather than aliasing V1 bytes.
        assertFalse(passport.verifiedHuman(OWNER), "verifiedHuman must start false");
        assertEq(passport.badges(OWNER), 0, "badges must start empty");
        assertEq(passport.getSeasonHistory(OWNER).length, 0, "season history must start empty");

        // And the new behaviour is actually live.
        assertFalse(passport.canClaimMonetaryReward(OWNER), "reward gate closed without verification");
    }

    /// @notice Proves the S9 fix against real production data: a genuine player whose tier
    ///         credential has already lapsed must still be able to claim an earned reward.
    /// @dev Every passport on mainnet is currently past its expiry, so before this change
    ///      the gate was shut for the entire player base. Verification is forced through
    ///      storage rather than a signature because the backend signing key is not available
    ///      to tests; the gate logic under test is unaffected by how the flag got set.
    function test_MainnetExpiredPassportCanStillClaimReward() public {
        try vm.createSelectFork(rpcUrl) {}
        catch {
            vm.skip(true);
            return;
        }
        vm.rollFork(block.number);

        // A real player, claimed via the live backend, whose passport has since expired.
        address player = 0x065Ba78045b55c037e21170319eB5e75E0af8286;
        TrustPassport passport = TrustPassport(PASSPORT_PROXY);

        TrustPassport.Passport memory stored = passport.getPassport(player);
        assertGt(stored.tier, 0, "fork sanity: expected a real passport");
        assertLt(stored.expiry, block.timestamp, "fork sanity: expected it to be expired");

        TrustPassport newImplementation = new TrustPassport();
        vm.prank(OWNER);
        passport.upgradeToAndCall(address(newImplementation), "");

        assertFalse(passport.isPassportValid(player), "tier credential is lapsed");
        assertFalse(passport.canClaimMonetaryReward(player), "still gated on verification");

        // verifiedHuman lives in slot 3.
        vm.store(PASSPORT_PROXY, keccak256(abi.encode(player, uint256(3))), bytes32(uint256(1)));
        assertTrue(passport.verifiedHuman(player), "storage slot assumption holds");

        assertTrue(
            passport.canClaimMonetaryReward(player), "expired-but-verified player can claim what they earned"
        );
    }

    /// @notice Rehearses the operator-role upgrade against the Sepolia TicketVault, which
    ///         already holds real usage: ticket balances, a claimed day, a whitelisted token.
    /// @dev Mainnet's TicketVault is still untouched, so Sepolia is the only deployment
    ///      with state worth proving survives. `operators` takes slot 8 out of __gap.
    function test_SepoliaTicketVaultUpgradePreservesState() public {
        try vm.createSelectFork(sepoliaRpcUrl) {}
        catch {
            vm.skip(true);
            return;
        }
        vm.rollFork(block.number);

        TicketVault vault = TicketVault(SEPOLIA_TICKET_VAULT);
        VaultSnapshot memory before = _snapshot(vault);

        assertGt(before.issued, 0, "fork sanity: expected real usage on Sepolia");
        assertTrue(before.tokenEnabled, "fork sanity: expected mock USDC whitelisted");

        TicketVault newImplementation = new TicketVault();
        vm.prank(before.owner);
        vault.upgradeToAndCall(address(newImplementation), "");

        VaultSnapshot memory afterUpgrade = _snapshot(vault);
        assertEq(keccak256(abi.encode(afterUpgrade)), keccak256(abi.encode(before)), "live state drifted");

        // New slot starts empty, and the role actually works end to end.
        assertFalse(vault.operators(before.owner), "operators must start empty");
        _assertOperatorRoleWorks(vault, before.owner);
    }

    struct VaultSnapshot {
        address owner;
        address treasury;
        address signer;
        uint256 issued;
        uint256 spent;
        uint256 ownerBalance;
        uint32 lastClaimDay;
        bool tokenEnabled;
        uint8 tokenDecimals;
    }

    function _snapshot(TicketVault vault) internal view returns (VaultSnapshot memory snap) {
        snap.owner = vault.owner();
        snap.treasury = vault.treasury();
        snap.signer = vault.backendSigner();
        snap.issued = vault.totalTicketsIssued();
        snap.spent = vault.totalTicketsSpent();
        snap.ownerBalance = vault.ticketBalance(snap.owner);
        snap.lastClaimDay = vault.lastClaimDay(snap.owner);
        (snap.tokenEnabled, snap.tokenDecimals) = vault.tokens(SEPOLIA_MOCK_USDC);
    }

    function _assertOperatorRoleWorks(TicketVault vault, address owner) internal {
        address backend = address(0xB4CE);

        vm.prank(owner);
        vault.setOperator(backend, true);
        assertTrue(vault.operators(backend));

        address[] memory users = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        users[0] = backend;
        amounts[0] = 3;

        vm.prank(backend);
        vault.creditBatch(users, amounts);
        assertEq(vault.ticketBalance(backend), 3, "operator can credit after upgrade");
    }
}
