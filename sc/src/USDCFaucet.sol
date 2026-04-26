// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {GameUSDC} from "./GameUSDC.sol";

contract USDCFaucet is Initializable, OwnableUpgradeable, PausableUpgradeable, UUPSUpgradeable {
    error InvalidToken(address token);
    error InvalidClaimAmount();

    event Claimed(address indexed account, uint256 amount);
    event ClaimAmountUpdated(uint256 newClaimAmount);

    GameUSDC public token;
    uint256 public claimAmount;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner, address tokenAddress, uint256 initialClaimAmount) external initializer {
        __Ownable_init(initialOwner);
        __Pausable_init();

        if (tokenAddress == address(0)) {
            revert InvalidToken(tokenAddress);
        }
        if (initialClaimAmount == 0) {
            revert InvalidClaimAmount();
        }

        token = GameUSDC(tokenAddress);
        claimAmount = initialClaimAmount;
    }

    function claim() external whenNotPaused {
        token.mint(msg.sender, claimAmount);
        emit Claimed(msg.sender, claimAmount);
    }

    function setClaimAmount(uint256 newClaimAmount) external onlyOwner {
        if (newClaimAmount == 0) {
            revert InvalidClaimAmount();
        }

        claimAmount = newClaimAmount;
        emit ClaimAmountUpdated(newClaimAmount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
