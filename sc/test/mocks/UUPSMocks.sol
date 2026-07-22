// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {GameUSDC} from "../../src/GameUSDC.sol";
import {USDCFaucet} from "../../src/USDCFaucet.sol";
import {GameVault} from "../../src/GameVault.sol";
import {GameSettlement} from "../../src/GameSettlement.sol";
import {TrustPassport} from "../../src/TrustPassport.sol";
import {TicketVault} from "../../src/TicketVault.sol";

contract GameUSDCV2 is GameUSDC {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract USDCFaucetV2 is USDCFaucet {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract GameVaultV2 is GameVault {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract GameSettlementV2 is GameSettlement {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract TrustPassportV2 is TrustPassport {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract TicketVaultV2 is TicketVault {
    function version() external pure returns (uint256) {
        return 2;
    }
}
