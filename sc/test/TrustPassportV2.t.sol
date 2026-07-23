// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {TrustPassport} from "../src/TrustPassport.sol";

/// @notice Pre-upgrade bytecode of TrustPassport, kept byte-identical to what is live at
///         0x4Bf6D3C0dBbC14eF0C7f2a4daeD7D97418Fc5aDf so the upgrade can be rehearsed
///         against real V1 storage rather than against a fresh V2 deployment.
contract TrustPassportV1Legacy {
    struct Passport {
        uint8 tier;
        uint64 issuedAt;
        uint64 expiry;
        bool revoked;
    }

    address public backendSigner;
    mapping(address => Passport) internal passports;
    mapping(uint256 => bool) public usedNonces;

    function seedForTest(address player, Passport calldata passport, uint256 nonce, address signer) external {
        passports[player] = passport;
        usedNonces[nonce] = true;
        backendSigner = signer;
    }

    function getPassport(address player) external view returns (Passport memory) {
        return passports[player];
    }
}

contract TrustPassportV2Test is Test {
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 internal constant PASSPORT_CLAIM_TYPEHASH =
        keccak256("PassportClaim(address player,uint8 tier,uint64 issuedAt,uint64 expiry,uint256 nonce)");

    bytes32 internal constant VERIFY_CLAIM_TYPEHASH =
        keccak256("VerifyClaim(address player,uint64 issuedAt,uint64 expiry,uint256 nonce)");

    TrustPassport internal passport;

    uint256 internal backendSignerPk = 0xBADC0DE;
    address internal backendSigner;
    address internal player = address(0xA11CE);
    address internal otherPlayer = address(0xB0B);

    function setUp() public {
        backendSigner = vm.addr(backendSignerPk);
        vm.warp(1 days);

        TrustPassport implementation = new TrustPassport();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(implementation), abi.encodeCall(TrustPassport.initialize, (address(this), backendSigner))
        );
        passport = TrustPassport(address(proxy));
    }

    // ------------------------------------------------- storage layout safety

    /// @dev The whole point of the append-only rule: V1 data written before the upgrade
    ///      must read back identically afterwards. Anything that shifts the layout
    ///      corrupts live passports.
    function test_UpgradePreservesV1Storage() public {
        TrustPassportV1Legacy legacyImplementation = new TrustPassportV1Legacy();
        TrustPassportV1Legacy.Passport memory seeded = TrustPassportV1Legacy.Passport({
            tier: 3,
            issuedAt: uint64(block.timestamp),
            expiry: uint64(block.timestamp + 30 days),
            revoked: false
        });

        // Seed V1 state through the proxy constructor: as of OZ v5.6 an ERC1967Proxy
        // deployed with empty init data reverts.
        ERC1967Proxy legacyProxy = new ERC1967Proxy(
            address(legacyImplementation),
            abi.encodeCall(TrustPassportV1Legacy.seedForTest, (player, seeded, 4242, backendSigner))
        );

        // Upgrade the same proxy to the V2 implementation.
        TrustPassport v2Implementation = new TrustPassport();
        vm.store(address(legacyProxy), bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1), bytes32(uint256(uint160(address(v2Implementation)))));

        TrustPassport upgraded = TrustPassport(address(legacyProxy));
        TrustPassport.Passport memory stored = upgraded.getPassport(player);

        assertEq(stored.tier, 3, "tier survived upgrade");
        assertEq(stored.issuedAt, seeded.issuedAt, "issuedAt survived upgrade");
        assertEq(stored.expiry, seeded.expiry, "expiry survived upgrade");
        assertFalse(stored.revoked, "revoked survived upgrade");
        assertTrue(upgraded.usedNonces(4242), "nonce survived upgrade");
        assertEq(upgraded.backendSigner(), backendSigner, "signer survived upgrade");

        // New V2 slots start empty rather than reading leftover V1 bytes.
        assertFalse(upgraded.verifiedHuman(player), "new mapping starts clean");
        assertEq(upgraded.badges(player), 0, "new mapping starts clean");
    }

    // ------------------------------------------------------------- verifyHuman

    function test_VerifyHumanSetsFlag() public {
        TrustPassport.VerifyClaim memory claim = _verifyClaim(player, 1);
        bytes memory signature = _signVerify(claim, backendSignerPk);

        vm.prank(player);
        passport.verifyHuman(claim, signature);

        assertTrue(passport.verifiedHuman(player));
        assertTrue(passport.usedNonces(1));
    }

    function test_VerifyHumanWrongSignerReverts() public {
        TrustPassport.VerifyClaim memory claim = _verifyClaim(player, 1);
        bytes memory signature = _signVerify(claim, 0x111111);

        vm.prank(player);
        vm.expectRevert();
        passport.verifyHuman(claim, signature);
    }

    function test_VerifyHumanForAnotherPlayerReverts() public {
        TrustPassport.VerifyClaim memory claim = _verifyClaim(player, 1);
        bytes memory signature = _signVerify(claim, backendSignerPk);

        vm.prank(otherPlayer);
        vm.expectRevert(abi.encodeWithSelector(TrustPassport.InvalidPlayer.selector, player));
        passport.verifyHuman(claim, signature);
    }

    function test_VerifyHumanTwiceReverts() public {
        TrustPassport.VerifyClaim memory claim = _verifyClaim(player, 1);
        bytes memory signature = _signVerify(claim, backendSignerPk);
        vm.prank(player);
        passport.verifyHuman(claim, signature);

        TrustPassport.VerifyClaim memory second = _verifyClaim(player, 2);
        bytes memory secondSignature = _signVerify(second, backendSignerPk);
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(TrustPassport.AlreadyVerified.selector, player));
        passport.verifyHuman(second, secondSignature);
    }

    /// @dev Shared nonce space: a passport-claim nonce must not be reusable for verification.
    function test_VerifyHumanCannotReusePassportNonce() public {
        TrustPassport.PassportClaim memory claim = TrustPassport.PassportClaim({
            player: player,
            tier: 1,
            issuedAt: uint64(block.timestamp),
            expiry: uint64(block.timestamp + 30 days),
            nonce: 99
        });
        bytes memory passportSignature = _signPassport(claim, backendSignerPk);
        vm.prank(player);
        passport.claimWithSignature(claim, passportSignature);

        TrustPassport.VerifyClaim memory verify = _verifyClaim(player, 99);
        bytes memory verifySignature = _signVerify(verify, backendSignerPk);
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(TrustPassport.NonceAlreadyUsed.selector, uint256(99)));
        passport.verifyHuman(verify, verifySignature);
    }

    // -------------------------------------------------------- reward gating

    function test_CanClaimMonetaryRewardRequiresBothPassportAndVerification() public {
        assertFalse(passport.canClaimMonetaryReward(player), "no passport, no verification");

        TrustPassport.PassportClaim memory claim = TrustPassport.PassportClaim({
            player: player,
            tier: 2,
            issuedAt: uint64(block.timestamp),
            expiry: uint64(block.timestamp + 30 days),
            nonce: 7
        });
        bytes memory signature = _signPassport(claim, backendSignerPk);
        vm.prank(player);
        passport.claimWithSignature(claim, signature);
        assertFalse(passport.canClaimMonetaryReward(player), "passport alone is not enough");

        TrustPassport.VerifyClaim memory verify = _verifyClaim(player, 8);
        bytes memory verifySignature = _signVerify(verify, backendSignerPk);
        vm.prank(player);
        passport.verifyHuman(verify, verifySignature);
        assertTrue(passport.canClaimMonetaryReward(player), "passport + verification unlocks payout");

        passport.revokePassport(player);
        assertFalse(passport.canClaimMonetaryReward(player), "revocation closes the gate again");
    }

    /// @dev S9 option (b): a reward earned in a finished season must survive the tier
    ///      credential lapsing. Every live mainnet passport is already past its expiry,
    ///      so without this the gate would be shut for literally everyone.
    function test_CanClaimMonetaryRewardSurvivesExpiry() public {
        TrustPassport.PassportClaim memory claim = TrustPassport.PassportClaim({
            player: player,
            tier: 4,
            issuedAt: uint64(block.timestamp),
            expiry: uint64(block.timestamp + 30 days),
            nonce: 21
        });
        vm.prank(player);
        passport.claimWithSignature(claim, _signPassport(claim, backendSignerPk));

        TrustPassport.VerifyClaim memory verify = _verifyClaim(player, 22);
        vm.prank(player);
        passport.verifyHuman(verify, _signVerify(verify, backendSignerPk));
        assertTrue(passport.canClaimMonetaryReward(player));

        // Walk past the tier credential's expiry.
        vm.warp(block.timestamp + 31 days);

        assertFalse(passport.isPassportValid(player), "tier credential has lapsed");
        assertTrue(passport.canClaimMonetaryReward(player), "but the earned reward stays claimable");

        // Enforcement still works on an expired passport.
        passport.revokePassport(player);
        assertFalse(passport.canClaimMonetaryReward(player), "revoke still shuts the gate");
    }

    function test_CanClaimMonetaryRewardStillNeedsVerification() public {
        TrustPassport.PassportClaim memory claim = TrustPassport.PassportClaim({
            player: player,
            tier: 3,
            issuedAt: uint64(block.timestamp),
            expiry: uint64(block.timestamp + 30 days),
            nonce: 31
        });
        vm.prank(player);
        passport.claimWithSignature(claim, _signPassport(claim, backendSignerPk));

        vm.warp(block.timestamp + 31 days);

        // Dropping expiry must not accidentally drop the sybil gate with it.
        assertFalse(passport.canClaimMonetaryReward(player), "unverified stays locked out");
    }

    // ---------------------------------------------------------------- revoke

    function test_UnrevokeRestoresPassport() public {
        TrustPassport.PassportClaim memory claim = TrustPassport.PassportClaim({
            player: player,
            tier: 2,
            issuedAt: uint64(block.timestamp),
            expiry: uint64(block.timestamp + 30 days),
            nonce: 11
        });
        bytes memory signature = _signPassport(claim, backendSignerPk);
        vm.prank(player);
        passport.claimWithSignature(claim, signature);

        passport.revokePassport(player);
        assertFalse(passport.isPassportValid(player));

        passport.unrevokePassport(player);
        assertTrue(passport.isPassportValid(player), "a mistaken revoke is now recoverable");
    }

    function test_UnrevokeOnActivePassportReverts() public {
        vm.expectRevert(abi.encodeWithSelector(TrustPassport.PassportNotRevoked.selector, player));
        passport.unrevokePassport(player);
    }

    function test_UnrevokeOnlyOwner() public {
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, player));
        passport.unrevokePassport(player);
    }

    // -------------------------------------------------------- season & badges

    function test_RecordSeasonAppendsHistory() public {
        address[] memory players = new address[](2);
        uint8[] memory divisions = new uint8[](2);
        players[0] = player;
        players[1] = otherPlayer;
        divisions[0] = 1;
        divisions[1] = 4;

        passport.recordSeason(players, 1, divisions);

        uint8[] memory nextDivisions = new uint8[](2);
        nextDivisions[0] = 2;
        nextDivisions[1] = 5;
        passport.recordSeason(players, 2, nextDivisions);

        uint8[] memory history = passport.getSeasonHistory(player);
        assertEq(history.length, 2);
        assertEq(history[0], 1);
        assertEq(history[1], 2);

        uint8[] memory otherHistory = passport.getSeasonHistory(otherPlayer);
        assertEq(otherHistory[1], 5, "Oracle in season 2 is permanent");
    }

    function test_RecordSeasonLengthMismatchReverts() public {
        address[] memory players = new address[](2);
        uint8[] memory divisions = new uint8[](1);
        players[0] = player;
        players[1] = otherPlayer;
        divisions[0] = 1;

        vm.expectRevert(abi.encodeWithSelector(TrustPassport.LengthMismatch.selector, uint256(2), uint256(1)));
        passport.recordSeason(players, 1, divisions);
    }

    function test_GrantBadgeSetsBitIndependently() public {
        passport.grantBadge(player, 0);
        passport.grantBadge(player, 7);

        assertTrue(passport.hasBadge(player, 0));
        assertTrue(passport.hasBadge(player, 7));
        assertFalse(passport.hasBadge(player, 1));
        assertFalse(passport.hasBadge(otherPlayer, 0));
    }

    function test_GrantBadgeIsIdempotent() public {
        passport.grantBadge(player, 3);
        uint256 maskAfterFirst = passport.badges(player);
        passport.grantBadge(player, 3);

        assertEq(passport.badges(player), maskAfterFirst);
    }

    function test_GrantBadgeOnlyOwner() public {
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, player));
        passport.grantBadge(player, 1);
    }

    // --------------------------------------------------------------- helpers

    function _verifyClaim(address subject, uint256 nonce)
        internal
        view
        returns (TrustPassport.VerifyClaim memory)
    {
        return TrustPassport.VerifyClaim({
            player: subject,
            issuedAt: uint64(block.timestamp),
            expiry: uint64(block.timestamp + 1 hours),
            nonce: nonce
        });
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256("ChickenTrustPassport"),
                keccak256("1"),
                block.chainid,
                address(passport)
            )
        );
    }

    function _signVerify(TrustPassport.VerifyClaim memory claim, uint256 signerPk)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash =
            keccak256(abi.encode(VERIFY_CLAIM_TYPEHASH, claim.player, claim.issuedAt, claim.expiry, claim.nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signPassport(TrustPassport.PassportClaim memory claim, uint256 signerPk)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                PASSPORT_CLAIM_TYPEHASH, claim.player, claim.tier, claim.issuedAt, claim.expiry, claim.nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }
}
