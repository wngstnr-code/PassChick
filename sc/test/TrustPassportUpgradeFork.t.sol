// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {TrustPassport} from "../src/TrustPassport.sol";

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

    string internal rpcUrl = vm.envOr("CELO_RPC_URL", string("https://forno.celo.org"));

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
}
