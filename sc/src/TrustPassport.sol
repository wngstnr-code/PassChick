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

    event BackendSignerUpdated(address indexed signer);
    event PassportClaimed(address indexed player, uint8 tier, uint64 issuedAt, uint64 expiry, uint256 nonce);
    event PassportRevoked(address indexed player);

    address public backendSigner;
    mapping(address player => Passport passport) private passports;
    mapping(uint256 nonce => bool used) public usedNonces;

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
