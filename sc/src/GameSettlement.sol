// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {GameVault} from "./GameVault.sol";

contract GameSettlement is Initializable, OwnableUpgradeable, UUPSUpgradeable, EIP712Upgradeable, PausableUpgradeable {
    using ECDSA for bytes32;
    using SafeCast for uint256;

    uint8 public constant OUTCOME_CASHED_OUT = 1;
    uint8 public constant OUTCOME_CRASHED = 2;
    uint256 public constant MULTIPLIER_SCALE = 10_000;
    uint64 public constant DEFAULT_SESSION_EXPIRY_DELAY = 1 days;

    bytes32 public constant RESOLUTION_TYPEHASH = keccak256(
        "Resolution(bytes32 sessionId,address player,uint256 stakeAmount,uint256 payoutAmount,uint256 finalMultiplierBp,uint8 outcome,uint64 deadline)"
    );

    error InvalidVault(address vault);
    error InvalidSigner(address signer);
    error InvalidSessionId();
    error InvalidStakeAmount();
    error InvalidSessionExpiryDelay(uint64 delay);
    error SessionAlreadyExists(bytes32 sessionId);
    error SessionAlreadyActive(address player, bytes32 sessionId);
    error SessionNotFound(bytes32 sessionId);
    error SessionAlreadySettled(bytes32 sessionId);
    error SessionNotActive(bytes32 sessionId);
    error SessionNotExpired(uint64 expiresAt);
    error ResolutionExpired(uint64 deadline);
    error InvalidSignatureSigner(address recovered, address expected);
    error InvalidOutcome(uint8 outcome);
    error ResolutionPlayerMismatch(address expected, address actual);
    error ResolutionStakeMismatch(uint256 expected, uint256 actual);
    error ResolutionPayoutMismatch(uint256 expected, uint256 actual);
    error CrashResolutionMustHaveZeroPayout(uint256 payoutAmount);

    struct Session {
        address player;
        uint256 stakeAmount;
        uint64 startedAt;
        bool active;
        bool settled;
    }

    struct Resolution {
        bytes32 sessionId;
        address player;
        uint256 stakeAmount;
        uint256 payoutAmount;
        uint256 finalMultiplierBp;
        uint8 outcome;
        uint64 deadline;
    }

    event BackendSignerUpdated(address indexed signer);
    event VaultUpdated(address indexed vault);
    event SessionExpiryDelayUpdated(uint64 delay);
    event SessionStarted(address indexed player, bytes32 indexed sessionId, uint256 stakeAmount);
    event SessionExpired(address indexed player, bytes32 indexed sessionId, uint256 stakeAmount);
    event SessionSettled(
        address indexed player,
        bytes32 indexed sessionId,
        uint8 outcome,
        uint256 stakeAmount,
        uint256 payoutAmount,
        uint256 finalMultiplierBp
    );

    address public backendSigner;
    GameVault public vault;
    uint64 public sessionExpiryDelay;

    mapping(bytes32 sessionId => Session sessionData) private sessions;
    mapping(address player => bytes32 sessionId) public activeSessionOf;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner, address vaultAddress, address signer, uint64 expiryDelay)
        external
        initializer
    {
        __Ownable_init(initialOwner);
        __EIP712_init("ChickenCrossingSettlement", "1");
        __Pausable_init();

        _setVault(vaultAddress);
        _setBackendSigner(signer);
        _setSessionExpiryDelay(expiryDelay == 0 ? DEFAULT_SESSION_EXPIRY_DELAY : expiryDelay);
    }

    function setBackendSigner(address signer) external onlyOwner {
        _setBackendSigner(signer);
    }

    function setVault(address vaultAddress) external onlyOwner {
        _setVault(vaultAddress);
    }

    function setSessionExpiryDelay(uint64 expiryDelay) external onlyOwner {
        _setSessionExpiryDelay(expiryDelay);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function startSession(bytes32 onchainSessionId, uint256 stakeAmount) external whenNotPaused {
        if (onchainSessionId == bytes32(0)) {
            revert InvalidSessionId();
        }
        if (stakeAmount == 0) {
            revert InvalidStakeAmount();
        }

        bytes32 currentSessionId = activeSessionOf[msg.sender];
        if (currentSessionId != bytes32(0)) {
            Session storage currentSession = sessions[currentSessionId];
            if (currentSession.active) {
                revert SessionAlreadyActive(msg.sender, currentSessionId);
            }
        }

        Session storage existingSession = sessions[onchainSessionId];
        if (existingSession.player != address(0)) {
            revert SessionAlreadyExists(onchainSessionId);
        }

        sessions[onchainSessionId] = Session({
            player: msg.sender,
            stakeAmount: stakeAmount,
            startedAt: block.timestamp.toUint64(),
            active: true,
            settled: false
        });
        activeSessionOf[msg.sender] = onchainSessionId;

        vault.lockStake(msg.sender, onchainSessionId, stakeAmount);

        emit SessionStarted(msg.sender, onchainSessionId, stakeAmount);
    }

    function settleWithSignature(Resolution calldata resolution, bytes calldata signature) external whenNotPaused {
        if (block.timestamp > resolution.deadline) {
            revert ResolutionExpired(resolution.deadline);
        }
        if (resolution.outcome != OUTCOME_CASHED_OUT && resolution.outcome != OUTCOME_CRASHED) {
            revert InvalidOutcome(resolution.outcome);
        }

        Session storage session = sessions[resolution.sessionId];
        if (session.player == address(0)) {
            revert SessionNotFound(resolution.sessionId);
        }
        if (session.settled) {
            revert SessionAlreadySettled(resolution.sessionId);
        }
        if (!session.active) {
            revert SessionNotActive(resolution.sessionId);
        }
        if (session.player != resolution.player) {
            revert ResolutionPlayerMismatch(session.player, resolution.player);
        }
        if (session.stakeAmount != resolution.stakeAmount) {
            revert ResolutionStakeMismatch(session.stakeAmount, resolution.stakeAmount);
        }

        if (resolution.outcome == OUTCOME_CASHED_OUT) {
            uint256 expectedPayout = (resolution.stakeAmount * resolution.finalMultiplierBp) / MULTIPLIER_SCALE;
            if (expectedPayout != resolution.payoutAmount) {
                revert ResolutionPayoutMismatch(expectedPayout, resolution.payoutAmount);
            }
        } else if (resolution.payoutAmount != 0) {
            revert CrashResolutionMustHaveZeroPayout(resolution.payoutAmount);
        }

        bytes32 digest = hashResolution(resolution);
        address recoveredSigner = ECDSA.recover(digest, signature);
        if (recoveredSigner != backendSigner) {
            revert InvalidSignatureSigner(recoveredSigner, backendSigner);
        }

        _closeSession(session, resolution.player);

        if (resolution.outcome == OUTCOME_CASHED_OUT) {
            vault.settleCashout(
                resolution.player, resolution.sessionId, resolution.stakeAmount, resolution.payoutAmount
            );
        } else {
            vault.settleCrash(resolution.player, resolution.sessionId, resolution.stakeAmount);
        }

        emit SessionSettled(
            resolution.player,
            resolution.sessionId,
            resolution.outcome,
            resolution.stakeAmount,
            resolution.payoutAmount,
            resolution.finalMultiplierBp
        );
    }

    function expireSession(bytes32 sessionId) external whenNotPaused {
        Session storage session = sessions[sessionId];
        if (session.player == address(0)) {
            revert SessionNotFound(sessionId);
        }
        if (session.settled) {
            revert SessionAlreadySettled(sessionId);
        }
        if (!session.active) {
            revert SessionNotActive(sessionId);
        }

        uint64 expiresAt = session.startedAt + sessionExpiryDelay;
        if (block.timestamp <= expiresAt) {
            revert SessionNotExpired(expiresAt);
        }

        _closeSession(session, session.player);
        vault.settleCrash(session.player, sessionId, session.stakeAmount);

        emit SessionExpired(session.player, sessionId, session.stakeAmount);
        emit SessionSettled(session.player, sessionId, OUTCOME_CRASHED, session.stakeAmount, 0, 0);
    }

    function getSession(bytes32 sessionId) external view returns (Session memory) {
        return sessions[sessionId];
    }

    function hashResolution(Resolution calldata resolution) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RESOLUTION_TYPEHASH,
                    resolution.sessionId,
                    resolution.player,
                    resolution.stakeAmount,
                    resolution.payoutAmount,
                    resolution.finalMultiplierBp,
                    resolution.outcome,
                    resolution.deadline
                )
            )
        );
    }

    function _setBackendSigner(address signer) internal {
        if (signer == address(0)) {
            revert InvalidSigner(signer);
        }

        backendSigner = signer;
        emit BackendSignerUpdated(signer);
    }

    function _setVault(address vaultAddress) internal {
        if (vaultAddress == address(0)) {
            revert InvalidVault(vaultAddress);
        }

        vault = GameVault(vaultAddress);
        emit VaultUpdated(vaultAddress);
    }

    function _setSessionExpiryDelay(uint64 expiryDelay) internal {
        if (expiryDelay == 0) {
            revert InvalidSessionExpiryDelay(expiryDelay);
        }

        sessionExpiryDelay = expiryDelay;
        emit SessionExpiryDelayUpdated(expiryDelay);
    }

    function _closeSession(Session storage session, address player) internal {
        session.active = false;
        session.settled = true;
        delete activeSessionOf[player];
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
