// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract TrustPassport is Initializable, OwnableUpgradeable, UUPSUpgradeable, PausableUpgradeable, EIP712Upgradeable {
    bytes32 public constant PASSPORT_CLAIM_TYPEHASH =
        keccak256("PassportClaim(address player,uint8 tier,uint64 issuedAt,uint64 expiry,uint256 nonce)");

    /// @notice V2: proof that the backend verified this player as a human via Self.xyz.
    bytes32 public constant VERIFY_CLAIM_TYPEHASH =
        keccak256("VerifyClaim(address player,uint64 issuedAt,uint64 expiry,uint256 nonce)");

    error InvalidSigner(address signer);
    error InvalidPlayer(address player);
    error InvalidTier(uint8 tier);
    error InvalidIssuedAt(uint64 issuedAt);
    error InvalidExpiry(uint64 expiry);
    error PassportClaimExpired(uint64 expiry);
    error NonceAlreadyUsed(uint256 nonce);
    error InvalidSignatureSigner(address recovered, address expected);
    error StalePassportClaim(uint64 issuedAt, uint64 currentIssuedAt);
    error PassportAlreadyRevoked(address player);
    error PassportNotRevoked(address player);
    error AlreadyVerified(address player);
    error LengthMismatch(uint256 playersLength, uint256 divisionsLength);

    struct PassportClaim {
        address player;
        uint8 tier;
        uint64 issuedAt;
        uint64 expiry;
        uint256 nonce;
    }

    struct Passport {
        uint8 tier;
        uint64 issuedAt;
        uint64 expiry;
        bool revoked;
    }

    /// @notice V2: EIP-712 payload proving backend-side Self.xyz verification.
    struct VerifyClaim {
        address player;
        uint64 issuedAt;
        uint64 expiry;
        uint256 nonce;
    }

    event BackendSignerUpdated(address indexed signer);
    event PassportClaimed(address indexed player, uint8 tier, uint64 issuedAt, uint64 expiry, uint256 nonce);
    event PassportRevoked(address indexed player);
    event PassportUnrevoked(address indexed player);
    event HumanVerified(address indexed player, uint256 nonce);
    event SeasonRecorded(address indexed player, uint16 indexed season, uint8 division);
    event BadgeGranted(address indexed player, uint8 indexed badgeId);

    address public backendSigner;
    mapping(address player => Passport passport) private passports;
    mapping(uint256 nonce => bool used) public usedNonces;

    // ---------------------------------------------------------------------
    // V2 storage. APPEND ONLY - never reorder or resize anything above this
    // line, and never touch the `Passport` struct: the proxy at
    // 0x4Bf6D3C0dBbC14eF0C7f2a4daeD7D97418Fc5aDf already holds live player data
    // laid out against it.
    // ---------------------------------------------------------------------

    /// @notice Gate for withdrawing money-valued rewards (spec 7.1).
    mapping(address player => bool verified) public verifiedHuman;

    /// @notice Division reached per season, appended once per season reset (spec 7.3).
    mapping(address player => uint8[] divisions) private seasonHistory;

    /// @notice Bitmask of earned badges; bit N set means badge N is held.
    mapping(address player => uint256 mask) public badges;

    uint256[50] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner, address signer) external initializer {
        __Ownable_init(initialOwner);
        __Pausable_init();
        __EIP712_init("ChickenTrustPassport", "1");
        _setBackendSigner(signer);
    }

    function setBackendSigner(address signer) external onlyOwner {
        _setBackendSigner(signer);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function claimWithSignature(PassportClaim calldata claim, bytes calldata signature) external whenNotPaused {
        if (claim.player == address(0)) {
            revert InvalidPlayer(claim.player);
        }
        if (claim.player != msg.sender) {
            revert InvalidPlayer(claim.player);
        }
        if (claim.tier == 0) {
            revert InvalidTier(claim.tier);
        }
        if (claim.issuedAt == 0) {
            revert InvalidIssuedAt(claim.issuedAt);
        }
        if (claim.expiry <= claim.issuedAt) {
            revert InvalidExpiry(claim.expiry);
        }
        if (block.timestamp > claim.expiry) {
            revert PassportClaimExpired(claim.expiry);
        }
        if (usedNonces[claim.nonce]) {
            revert NonceAlreadyUsed(claim.nonce);
        }

        bytes32 digest = hashPassportClaim(claim);
        address recoveredSigner = ECDSA.recover(digest, signature);
        if (recoveredSigner != backendSigner) {
            revert InvalidSignatureSigner(recoveredSigner, backendSigner);
        }

        Passport memory current = passports[claim.player];
        if (claim.issuedAt < current.issuedAt) {
            revert StalePassportClaim(claim.issuedAt, current.issuedAt);
        }

        usedNonces[claim.nonce] = true;
        passports[claim.player] =
            Passport({tier: claim.tier, issuedAt: claim.issuedAt, expiry: claim.expiry, revoked: false});

        emit PassportClaimed(claim.player, claim.tier, claim.issuedAt, claim.expiry, claim.nonce);
    }

    function revokePassport(address player) external onlyOwner {
        Passport storage passport = passports[player];
        if (passport.revoked) {
            revert PassportAlreadyRevoked(player);
        }

        passport.revoked = true;
        emit PassportRevoked(player);
    }

    /// @notice Undo a revocation. Without this a mistaken revoke erased a player forever.
    function unrevokePassport(address player) external onlyOwner {
        Passport storage passport = passports[player];
        if (!passport.revoked) {
            revert PassportNotRevoked(player);
        }

        passport.revoked = false;
        emit PassportUnrevoked(player);
    }

    /// @notice Mark the caller as a verified human, unlocking money-valued reward claims.
    /// @dev The backend performs the Self.xyz check off-chain and signs the result. It
    ///      shares the `usedNonces` space with passport claims, so a signature issued for
    ///      one flow can never be replayed into the other.
    function verifyHuman(VerifyClaim calldata claim, bytes calldata signature) external whenNotPaused {
        if (claim.player != msg.sender) {
            revert InvalidPlayer(claim.player);
        }
        if (claim.issuedAt == 0) {
            revert InvalidIssuedAt(claim.issuedAt);
        }
        if (claim.expiry <= claim.issuedAt) {
            revert InvalidExpiry(claim.expiry);
        }
        if (block.timestamp > claim.expiry) {
            revert PassportClaimExpired(claim.expiry);
        }
        if (usedNonces[claim.nonce]) {
            revert NonceAlreadyUsed(claim.nonce);
        }
        if (verifiedHuman[claim.player]) {
            revert AlreadyVerified(claim.player);
        }

        bytes32 digest = hashVerifyClaim(claim);
        address recoveredSigner = ECDSA.recover(digest, signature);
        if (recoveredSigner != backendSigner) {
            revert InvalidSignatureSigner(recoveredSigner, backendSigner);
        }

        usedNonces[claim.nonce] = true;
        verifiedHuman[claim.player] = true;

        emit HumanVerified(claim.player, claim.nonce);
    }

    function hashVerifyClaim(VerifyClaim calldata claim) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(VERIFY_CLAIM_TYPEHASH, claim.player, claim.issuedAt, claim.expiry, claim.nonce))
        );
    }

    /// @notice Append the division each player finished a season in (spec 7.3).
    function recordSeason(address[] calldata players, uint16 season, uint8[] calldata divisions) external onlyOwner {
        if (players.length != divisions.length) {
            revert LengthMismatch(players.length, divisions.length);
        }

        for (uint256 i = 0; i < players.length; i++) {
            if (players[i] == address(0)) {
                revert InvalidPlayer(players[i]);
            }

            seasonHistory[players[i]].push(divisions[i]);
            emit SeasonRecorded(players[i], season, divisions[i]);
        }
    }

    function grantBadge(address player, uint8 badgeId) external onlyOwner {
        if (player == address(0)) {
            revert InvalidPlayer(player);
        }

        badges[player] |= (uint256(1) << badgeId);
        emit BadgeGranted(player, badgeId);
    }

    function hasBadge(address player, uint8 badgeId) external view returns (bool) {
        return badges[player] & (uint256(1) << badgeId) != 0;
    }

    function getSeasonHistory(address player) external view returns (uint8[] memory) {
        return seasonHistory[player];
    }

    /// @notice Whether `player` may claim money-valued rewards: valid passport AND verified human.
    /// @notice Whether `player` may claim money-valued rewards.
    /// @dev Deliberately does NOT read `expiry` (S9, option b). A reward already earned in
    ///      a finished season should not evaporate because the player skipped a month, and
    ///      expiry adds no anti-sybil value here: `verifiedHuman` is the sybil gate and
    ///      `revoked` is the enforcement lever. `isPassportValid` still honours expiry -
    ///      that one answers "is this an active credential", which is a different question.
    function canClaimMonetaryReward(address player) external view returns (bool) {
        Passport memory passport = passports[player];
        return passport.tier > 0 && !passport.revoked && verifiedHuman[player];
    }

    function hashPassportClaim(PassportClaim calldata claim) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    PASSPORT_CLAIM_TYPEHASH, claim.player, claim.tier, claim.issuedAt, claim.expiry, claim.nonce
                )
            )
        );
    }

    function getPassport(address player) external view returns (Passport memory) {
        return passports[player];
    }

    function isPassportValid(address player) external view returns (bool) {
        Passport memory passport = passports[player];
        return passport.tier > 0 && !passport.revoked && passport.expiry >= block.timestamp;
    }

    function _setBackendSigner(address signer) internal {
        if (signer == address(0)) {
            revert InvalidSigner(signer);
        }

        backendSigner = signer;
        emit BackendSignerUpdated(signer);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
