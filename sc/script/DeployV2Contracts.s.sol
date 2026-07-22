// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {TicketVault} from "../src/TicketVault.sol";
import {TrustPassport} from "../src/TrustPassport.sol";

/// @notice Deploys TicketVault and upgrades the live TrustPassport proxy to V2.
/// @dev Two independent steps on purpose:
///        forge script DeployV2Contracts --sig "run()"              -> deploy TicketVault only
///        forge script DeployV2Contracts --sig "upgradePassport()"  -> upgrade TrustPassport only
///      The TicketVault deployment is a fresh proxy and carries no risk. The passport
///      upgrade touches a proxy that already holds live player data, so it is kept
///      separate and can be run (and reverted) on its own.
contract DeployV2Contracts is Script {
    uint64 internal constant DEFAULT_CLAIM_SIGNATURE_TTL = 10 minutes;

    struct TokenConfig {
        address token;
        uint8 decimals;
    }

    function run() external returns (TicketVault ticketVault) {
        address backendSigner = vm.envAddress("BACKEND_SIGNER");
        address treasury = vm.envAddress("TICKET_TREASURY");
        uint64 signatureTtl = uint64(vm.envOr("DAILY_CLAIM_SIGNATURE_TTL", uint256(DEFAULT_CLAIM_SIGNATURE_TTL)));

        vm.startBroadcast();
        address initialOwner = _resolveInitialOwner(vm.envOr("INITIAL_OWNER", address(0)));

        TicketVault implementation = new TicketVault();
        ticketVault = TicketVault(
            address(
                new ERC1967Proxy(
                    address(implementation),
                    abi.encodeCall(TicketVault.initialize, (initialOwner, backendSigner, treasury, signatureTtl))
                )
            )
        );

        _configureTokens(ticketVault);

        vm.stopBroadcast();

        console2.log("TicketVault implementation:", address(implementation));
        console2.log("TicketVault proxy:", address(ticketVault));
        console2.log("Owner:", initialOwner);
        console2.log("Backend signer:", backendSigner);
        console2.log("Treasury:", treasury);
        console2.log("Claim signature TTL:", signatureTtl);
    }

    /// @notice Point the existing TicketVault proxy at a new implementation.
    /// @dev Storage additions are append-only (operators took slot 8 out of __gap), so
    ///      no reinitializer call is needed. Set TICKET_VAULT_ADDRESS to the proxy for
    ///      the network being targeted - mainnet and Sepolia differ.
    function upgradeTicketVault() external returns (address implementation) {
        address vaultProxy = vm.envAddress("TICKET_VAULT_ADDRESS");

        vm.startBroadcast();

        TicketVault newImplementation = new TicketVault();
        TicketVault(vaultProxy).upgradeToAndCall(address(newImplementation), "");

        vm.stopBroadcast();

        implementation = address(newImplementation);
        console2.log("TicketVault proxy:", vaultProxy);
        console2.log("TicketVault new implementation:", implementation);
    }

    /// @notice Point the existing TrustPassport proxy at the V2 implementation.
    /// @dev Storage additions are append-only, so no reinitializer call is needed.
    function upgradePassport() external returns (address implementation) {
        address passportProxy = vm.envAddress("TRUST_PASSPORT_ADDRESS");

        vm.startBroadcast();

        TrustPassport newImplementation = new TrustPassport();
        TrustPassport(passportProxy).upgradeToAndCall(address(newImplementation), "");

        vm.stopBroadcast();

        implementation = address(newImplementation);
        console2.log("TrustPassport proxy:", passportProxy);
        console2.log("TrustPassport new implementation:", implementation);
    }

    /// @dev Whitelists the stablecoins from spec 4.2. Addresses come from env so the
    ///      same script serves mainnet and Celo Sepolia; unset entries are skipped.
    function _configureTokens(TicketVault ticketVault) internal {
        TokenConfig[3] memory configs = [
            TokenConfig({token: vm.envOr("USDC_ADDRESS", address(0)), decimals: 6}),
            TokenConfig({token: vm.envOr("USDT_ADDRESS", address(0)), decimals: 6}),
            TokenConfig({token: vm.envOr("CUSD_ADDRESS", address(0)), decimals: 18})
        ];

        for (uint256 i = 0; i < configs.length; i++) {
            if (configs[i].token == address(0)) {
                continue;
            }

            ticketVault.setToken(configs[i].token, configs[i].decimals, true);
            console2.log("Whitelisted token:", configs[i].token, configs[i].decimals);
        }
    }

    /// @dev The broadcasting wallet comes from the CLI only (`--account` / `--private-key`
    ///      / `--ledger`), never from a PRIVATE_KEY env var. Reading the env here used to
    ///      silently override `--account`, so an `--account passchick-owner` upgrade was
    ///      signed by whatever stale key sat in .env instead.
    function _resolveInitialOwner(address initialOwner) internal view returns (address) {
        if (initialOwner != address(0)) {
            return initialOwner;
        }

        (, address broadcaster,) = vm.readCallers();
        return broadcaster;
    }
}
