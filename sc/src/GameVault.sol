// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract GameVault is Initializable, OwnableUpgradeable, UUPSUpgradeable, PausableUpgradeable {
    using SafeERC20 for IERC20;

    error InvalidToken(address token);
    error InvalidRecipient(address recipient);
    error InvalidSettlement(address settlement);
    error SettlementNotSet();
    error UnauthorizedSettlement(address account);
    error ZeroAmount();
    error InsufficientAvailableBalance(uint256 available, uint256 requested);
    error InsufficientLockedBalance(uint256 locked, uint256 requested);
    error InsufficientTreasury(uint256 available, uint256 requiredAmount);
    error InsufficientRescuableBalance(uint256 available, uint256 requested);

    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event TreasuryFunded(address indexed funder, uint256 amount);
    event TreasuryWithdrawn(address indexed recipient, uint256 amount);
    event TokenRescued(address indexed token, address indexed recipient, uint256 amount);
    event SettlementUpdated(address indexed settlement);
    event StakeLocked(address indexed player, bytes32 indexed sessionId, uint256 amount);
    event CashoutSettled(address indexed player, bytes32 indexed sessionId, uint256 stakeAmount, uint256 payoutAmount);
    event CrashSettled(address indexed player, bytes32 indexed sessionId, uint256 stakeAmount);

    IERC20 public usdc;
    address public settlement;
    uint256 public treasuryBalance;
    uint256 public totalAvailableBalance;
    uint256 public totalLockedBalance;

    mapping(address account => uint256 balance) private availableBalances;
    mapping(address account => uint256 balance) private lockedBalances;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    modifier onlySettlement() {
        _onlySettlement();
        _;
    }

    function initialize(address initialOwner, address usdcAddress) external initializer {
        __Ownable_init(initialOwner);
        __Pausable_init();

        if (usdcAddress == address(0)) {
            revert InvalidToken(usdcAddress);
        }

        usdc = IERC20(usdcAddress);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setSettlement(address settlementAddress) external onlyOwner {
        if (settlementAddress == address(0)) {
            revert InvalidSettlement(settlementAddress);
        }

        settlement = settlementAddress;
        emit SettlementUpdated(settlementAddress);
    }

    function deposit(uint256 amount) external whenNotPaused {
        if (amount == 0) {
            revert ZeroAmount();
        }

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        availableBalances[msg.sender] += amount;
        totalAvailableBalance += amount;

        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        if (amount == 0) {
            revert ZeroAmount();
        }

        uint256 currentBalance = availableBalances[msg.sender];
        if (amount > currentBalance) {
            revert InsufficientAvailableBalance(currentBalance, amount);
        }

        availableBalances[msg.sender] = currentBalance - amount;
        totalAvailableBalance -= amount;
        usdc.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    function fundTreasury(uint256 amount) external whenNotPaused {
        if (amount == 0) {
            revert ZeroAmount();
        }

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        treasuryBalance += amount;

        emit TreasuryFunded(msg.sender, amount);
    }

    function treasuryWithdraw(address recipient, uint256 amount) external onlyOwner {
        if (recipient == address(0)) {
            revert InvalidRecipient(recipient);
        }
        if (amount == 0) {
            revert ZeroAmount();
        }
        if (amount > treasuryBalance) {
            revert InsufficientTreasury(treasuryBalance, amount);
        }

        treasuryBalance -= amount;
        usdc.safeTransfer(recipient, amount);

        emit TreasuryWithdrawn(recipient, amount);
    }

    function rescueToken(address tokenAddress, address recipient, uint256 amount) external onlyOwner {
        if (tokenAddress == address(0)) {
            revert InvalidToken(tokenAddress);
        }
        if (recipient == address(0)) {
            revert InvalidRecipient(recipient);
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        IERC20 tokenToRescue = IERC20(tokenAddress);
        if (tokenAddress == address(usdc)) {
            uint256 reservedBalance = totalAvailableBalance + totalLockedBalance + treasuryBalance;
            uint256 actualBalance = tokenToRescue.balanceOf(address(this));
            uint256 rescuableBalance = actualBalance > reservedBalance ? actualBalance - reservedBalance : 0;

            if (amount > rescuableBalance) {
                revert InsufficientRescuableBalance(rescuableBalance, amount);
            }
        }

        tokenToRescue.safeTransfer(recipient, amount);

        emit TokenRescued(tokenAddress, recipient, amount);
    }

    function lockStake(address player, bytes32 sessionId, uint256 amount) external onlySettlement whenNotPaused {
        if (amount == 0) {
            revert ZeroAmount();
        }

        uint256 currentAvailable = availableBalances[player];
        if (amount > currentAvailable) {
            revert InsufficientAvailableBalance(currentAvailable, amount);
        }

        availableBalances[player] = currentAvailable - amount;
        totalAvailableBalance -= amount;
        lockedBalances[player] += amount;
        totalLockedBalance += amount;

        emit StakeLocked(player, sessionId, amount);
    }

    function settleCashout(address player, bytes32 sessionId, uint256 stakeAmount, uint256 payoutAmount)
        external
        onlySettlement
        whenNotPaused
    {
        uint256 currentLocked = lockedBalances[player];
        if (stakeAmount > currentLocked) {
            revert InsufficientLockedBalance(currentLocked, stakeAmount);
        }

        lockedBalances[player] = currentLocked - stakeAmount;
        totalLockedBalance -= stakeAmount;

        if (payoutAmount > stakeAmount) {
            uint256 treasuryNeeded = payoutAmount - stakeAmount;
            if (treasuryNeeded > treasuryBalance) {
                revert InsufficientTreasury(treasuryBalance, treasuryNeeded);
            }
            treasuryBalance -= treasuryNeeded;
        } else if (stakeAmount > payoutAmount) {
            treasuryBalance += stakeAmount - payoutAmount;
        }

        availableBalances[player] += payoutAmount;
        totalAvailableBalance += payoutAmount;

        emit CashoutSettled(player, sessionId, stakeAmount, payoutAmount);
    }

    function settleCrash(address player, bytes32 sessionId, uint256 stakeAmount) external onlySettlement whenNotPaused {
        uint256 currentLocked = lockedBalances[player];
        if (stakeAmount > currentLocked) {
            revert InsufficientLockedBalance(currentLocked, stakeAmount);
        }

        lockedBalances[player] = currentLocked - stakeAmount;
        totalLockedBalance -= stakeAmount;
        treasuryBalance += stakeAmount;

        emit CrashSettled(player, sessionId, stakeAmount);
    }

    function availableBalanceOf(address account) external view returns (uint256) {
        return availableBalances[account];
    }

    function lockedBalanceOf(address account) external view returns (uint256) {
        return lockedBalances[account];
    }

    function _onlySettlement() internal view {
        if (settlement == address(0)) {
            revert SettlementNotSet();
        }
        if (msg.sender != settlement) {
            revert UnauthorizedSettlement(msg.sender);
        }
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
