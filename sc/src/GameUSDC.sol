// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract GameUSDC is Initializable, ERC20Upgradeable, OwnableUpgradeable, UUPSUpgradeable {
    error InvalidMinter(address minter);
    error UnauthorizedMinter(address account);

    event MinterUpdated(address indexed minter, bool allowed);

    mapping(address => bool) public minters;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    modifier onlyMinter() {
        _checkMinter();
        _;
    }

    function initialize(address initialOwner) external initializer {
        __ERC20_init("Mock USD Coin", "USDC");
        __Ownable_init(initialOwner);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function setMinter(address minter, bool allowed) external onlyOwner {
        if (minter == address(0)) {
            revert InvalidMinter(minter);
        }

        minters[minter] = allowed;
        emit MinterUpdated(minter, allowed);
    }

    function mint(address to, uint256 amount) external onlyMinter {
        _mint(to, amount);
    }

    function _checkMinter() internal view {
        if (!minters[msg.sender]) {
            revert UnauthorizedMinter(msg.sender);
        }
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
