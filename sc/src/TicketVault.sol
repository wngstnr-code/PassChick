// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title TicketVault
/// @notice Non-transferable ticket balances for PassChick V2. Combines the ticket
///         ledger and the multi-stablecoin ticket shop in one contract.
/// @dev Tickets deliberately have no transfer/approve surface: they are an internal
///      balance, not an ERC-20. This blocks ticket markets and bot trading (spec 2.1).
///      Purchase funds move buyer -> treasury directly; this contract never custodies
///      stablecoins, so there is no pooled balance to drain or rescue.
/// @dev `ReentrancyGuard` is the non-upgradeable import on purpose: as of
///      openzeppelin-contracts-upgradeable v5.6 there is no `ReentrancyGuardUpgradeable`,
///      because the guard now lives in a fixed namespaced slot rather than sequential
///      storage. It needs no initializer - an unset slot reads as "not entered" - and
///      this mirrors OpenZeppelin's own upgradeable mocks.
contract TicketVault is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable,
    ReentrancyGuard,
    EIP712Upgradeable
{
    using SafeERC20 for IERC20;

    bytes32 public constant DAILY_CLAIM_TYPEHASH =
        keccak256("DailyClaim(address user,uint32 dayIndex,uint16 amount,uint64 issuedAt,uint256 nonce)");

    /// @notice $1 buys 20 tickets ($0.05 per ticket), identical across every accepted stablecoin.
    uint256 public constant TICKETS_PER_USD = 20;

    /// @notice Hard ceiling on a single signed daily claim.
    /// @dev The richest legitimate day is 10 tickets plus a 1-ticket passport perk, so
    ///      100 leaves generous headroom. Its real job is bounding the damage if the
    ///      backend signing key leaks: without it a single signature could mint 65,535
    ///      tickets (~$3,276 at the shop price).
    uint16 public constant MAX_TICKETS_PER_CLAIM = 100;

    error InvalidSigner(address signer);
    error InvalidTreasury(address treasury);
    error InvalidUser(address user);
    error InvalidToken(address token);
    error InvalidRecipient(address recipient);
    error DecimalsMismatch(uint8 declared, uint8 actual);
    error InvalidSignatureTtl(uint64 ttl);
    error TokenNotEnabled(address token);
    error ZeroAmount();
    error ZeroTicketAmount();
    error TicketAmountTooLarge(uint16 amount, uint16 maxAmount);
    error DailyClaimExpired(uint64 issuedAt, uint64 ttl);
    error DailyClaimInFuture(uint64 issuedAt);
    error DayAlreadyClaimed(uint32 lastClaimDay, uint32 dayIndex);
    error NonceAlreadyUsed(uint256 nonce);
    error InvalidSignatureSigner(address recovered, address expected);
    error LengthMismatch(uint256 usersLength, uint256 amountsLength);
    error InsufficientTickets(uint256 balance, uint256 requested);
    error UnauthorizedOperator(address account);

    event BackendSignerUpdated(address indexed signer);
    event TreasuryUpdated(address indexed treasury);
    event ClaimSignatureTtlUpdated(uint64 ttl);
    event TokenConfigured(address indexed token, uint8 decimals, bool enabled);
    event TokenRescued(address indexed token, address indexed recipient, uint256 amount);
    event OperatorUpdated(address indexed account, bool allowed);
    event TicketClaimed(address indexed user, uint32 indexed dayIndex, uint16 amount, uint256 nonce);
    event TicketPurchased(address indexed user, address indexed token, uint256 usdAmount, uint256 cost, uint256 tickets);
    event TicketCredited(address indexed user, uint256 amount);
    event TicketSpent(address indexed user, uint256 amount);

    struct DailyClaim {
        address user;
        uint32 dayIndex;
        uint16 amount;
        uint64 issuedAt;
        uint256 nonce;
    }

    struct TokenConfig {
        bool enabled;
        uint8 decimals;
    }

    address public backendSigner;
    address public treasury;
    uint64 public claimSignatureTtl;

    uint256 public totalTicketsIssued;
    uint256 public totalTicketsSpent;

    mapping(address user => uint256 balance) public ticketBalance;
    mapping(address user => uint32 day) public lastClaimDay;
    mapping(uint256 nonce => bool used) public usedNonces;
    mapping(address token => TokenConfig config) public tokens;

    // ---------------------------------------------------------------------
    // V1.1 storage. Appended here and taken out of __gap (50 -> 49) so every
    // slot above keeps its position: this contract is already live at
    // 0x8a1bd73D (mainnet) and 0x1490e6B8 (Sepolia).
    // ---------------------------------------------------------------------

    /// @notice Addresses allowed to run batch ticket accounting on the owner's behalf.
    /// @dev The backend has to settle ticket spend and season rewards automatically, but
    ///      the owner key lives in an interactive keystore and cannot sign unattended.
    ///      An operator can only move ticket balances - never upgrade, re-point the
    ///      treasury, or touch the shop - so a leaked server key costs tickets, not control.
    mapping(address account => bool allowed) public operators;

    uint256[49] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @dev Owner is always allowed; operators are an addition, not a replacement.
    modifier onlyOperator() {
        if (msg.sender != owner() && !operators[msg.sender]) {
            revert UnauthorizedOperator(msg.sender);
        }
        _;
    }

    function initialize(address initialOwner, address signer, address treasuryAddress, uint64 signatureTtl)
        external
        initializer
    {
        __Ownable_init(initialOwner);
        __Pausable_init();
        __EIP712_init("PassChickTicketVault", "1");

        _setBackendSigner(signer);
        _setTreasury(treasuryAddress);
        _setClaimSignatureTtl(signatureTtl);
    }

    // ---------------------------------------------------------------- admin

    function setBackendSigner(address signer) external onlyOwner {
        _setBackendSigner(signer);
    }

    function setTreasury(address treasuryAddress) external onlyOwner {
        _setTreasury(treasuryAddress);
    }

    function setClaimSignatureTtl(uint64 signatureTtl) external onlyOwner {
        _setClaimSignatureTtl(signatureTtl);
    }

    /// @notice Whitelist (or disable) a stablecoin for ticket purchases.
    /// @dev Owner can add tokens such as USDm later without an upgrade (spec 4.2).
    ///      `decimals` is checked against the token's own `decimals()` rather than
    ///      trusted: a typo here (18 instead of 6) would silently overcharge buyers by
    ///      a factor of a trillion. A token that does not expose `decimals()` is
    ///      rejected outright - it has no business in the shop.
    function setToken(address token, uint8 decimals, bool enabled) external onlyOwner {
        if (token == address(0)) {
            revert InvalidToken(token);
        }

        uint8 actualDecimals = IERC20Metadata(token).decimals();
        if (actualDecimals != decimals) {
            revert DecimalsMismatch(decimals, actualDecimals);
        }

        tokens[token] = TokenConfig({enabled: enabled, decimals: decimals});
        emit TokenConfigured(token, decimals, enabled);
    }

    /// @notice Recover tokens sent here by mistake.
    /// @dev Purchases forward straight to the treasury, so this contract holds no
    ///      stablecoins as part of normal operation and every balance here is an
    ///      accident. Ticket balances are internal accounting, not tokens, so nothing
    ///      a player owns can be swept by this.
    function rescueToken(address token, address recipient, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            revert InvalidToken(token);
        }
        if (recipient == address(0)) {
            revert InvalidRecipient(recipient);
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        IERC20(token).safeTransfer(recipient, amount);
        emit TokenRescued(token, recipient, amount);
    }

    /// @notice Grant or revoke batch-accounting rights for a backend key.
    /// @dev Deliberately narrow: an operator can call creditBatch and spendBatch and
    ///      nothing else. Upgrades, treasury, shop config, and pausing stay with the owner.
    function setOperator(address account, bool allowed) external onlyOwner {
        if (account == address(0)) {
            revert InvalidUser(account);
        }

        operators[account] = allowed;
        emit OperatorUpdated(account, allowed);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------- daily claim

    /// @notice Credit the signed daily-login reward for `dayIndex`.
    /// @dev The backend rolls mystery-box amounts and folds passport perks into
    ///      `amount` before signing, so one transaction covers the whole reward.
    function claimDaily(DailyClaim calldata claim, bytes calldata signature) external whenNotPaused {
        if (claim.user != msg.sender) {
            revert InvalidUser(claim.user);
        }
        if (claim.amount == 0) {
            revert ZeroTicketAmount();
        }
        if (claim.amount > MAX_TICKETS_PER_CLAIM) {
            revert TicketAmountTooLarge(claim.amount, MAX_TICKETS_PER_CLAIM);
        }
        if (claim.issuedAt > block.timestamp) {
            revert DailyClaimInFuture(claim.issuedAt);
        }
        if (block.timestamp > claim.issuedAt + claimSignatureTtl) {
            revert DailyClaimExpired(claim.issuedAt, claimSignatureTtl);
        }
        if (usedNonces[claim.nonce]) {
            revert NonceAlreadyUsed(claim.nonce);
        }

        // dayIndex is strictly increasing, so a replayed or same-day claim is rejected
        // even if the backend were tricked into signing twice.
        uint32 claimedDay = lastClaimDay[claim.user];
        if (claimedDay >= claim.dayIndex) {
            revert DayAlreadyClaimed(claimedDay, claim.dayIndex);
        }

        bytes32 digest = hashDailyClaim(claim);
        address recoveredSigner = ECDSA.recover(digest, signature);
        if (recoveredSigner != backendSigner) {
            revert InvalidSignatureSigner(recoveredSigner, backendSigner);
        }

        usedNonces[claim.nonce] = true;
        lastClaimDay[claim.user] = claim.dayIndex;
        _credit(claim.user, claim.amount);

        emit TicketClaimed(claim.user, claim.dayIndex, claim.amount, claim.nonce);
    }

    function hashDailyClaim(DailyClaim calldata claim) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    DAILY_CLAIM_TYPEHASH, claim.user, claim.dayIndex, claim.amount, claim.issuedAt, claim.nonce
                )
            )
        );
    }

    // ---------------------------------------------------------------- shop

    /// @notice Buy tickets with a whitelisted stablecoin at $1 = 20 tickets.
    /// @param usdAmount Whole US dollars to spend. Whole dollars only, so the ticket
    ///        count is always exact and no rounding dust can accumulate.
    function buyTickets(address token, uint256 usdAmount) external whenNotPaused nonReentrant {
        if (usdAmount == 0) {
            revert ZeroAmount();
        }

        TokenConfig memory config = tokens[token];
        if (!config.enabled) {
            revert TokenNotEnabled(token);
        }

        uint256 cost = usdAmount * (10 ** config.decimals);
        uint256 tickets = usdAmount * TICKETS_PER_USD;

        // Straight to treasury: the contract never holds stablecoins.
        IERC20(token).safeTransferFrom(msg.sender, treasury, cost);
        _credit(msg.sender, tickets);

        emit TicketPurchased(msg.sender, token, usdAmount, cost, tickets);
    }

    // --------------------------------------------------------------- batch

    /// @notice Credit season rewards (spec 6) or migration grants in one transaction.
    function creditBatch(address[] calldata users, uint256[] calldata amounts) external onlyOperator {
        if (users.length != amounts.length) {
            revert LengthMismatch(users.length, amounts.length);
        }

        for (uint256 i = 0; i < users.length; i++) {
            if (users[i] == address(0)) {
                revert InvalidUser(users[i]);
            }
            if (amounts[i] == 0) {
                revert ZeroTicketAmount();
            }

            _credit(users[i], amounts[i]);
            emit TicketCredited(users[i], amounts[i]);
        }
    }

    /// @notice Settle tickets consumed off-chain during matches (spec 9.2).
    function spendBatch(address[] calldata users, uint256[] calldata amounts) external onlyOperator {
        if (users.length != amounts.length) {
            revert LengthMismatch(users.length, amounts.length);
        }

        for (uint256 i = 0; i < users.length; i++) {
            uint256 amount = amounts[i];
            if (amount == 0) {
                revert ZeroTicketAmount();
            }

            uint256 balance = ticketBalance[users[i]];
            if (amount > balance) {
                revert InsufficientTickets(balance, amount);
            }

            ticketBalance[users[i]] = balance - amount;
            totalTicketsSpent += amount;

            emit TicketSpent(users[i], amount);
        }
    }

    // -------------------------------------------------------------- internal

    function _credit(address user, uint256 amount) internal {
        ticketBalance[user] += amount;
        totalTicketsIssued += amount;
    }

    function _setBackendSigner(address signer) internal {
        if (signer == address(0)) {
            revert InvalidSigner(signer);
        }

        backendSigner = signer;
        emit BackendSignerUpdated(signer);
    }

    function _setTreasury(address treasuryAddress) internal {
        if (treasuryAddress == address(0)) {
            revert InvalidTreasury(treasuryAddress);
        }

        treasury = treasuryAddress;
        emit TreasuryUpdated(treasuryAddress);
    }

    function _setClaimSignatureTtl(uint64 signatureTtl) internal {
        if (signatureTtl == 0) {
            revert InvalidSignatureTtl(signatureTtl);
        }

        claimSignatureTtl = signatureTtl;
        emit ClaimSignatureTtlUpdated(signatureTtl);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
