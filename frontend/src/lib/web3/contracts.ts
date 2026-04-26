import { isAddress } from "viem";

export const USDC_DECIMALS = 6;
export const FIXED_GAME_STAKE_UNITS = 100n;
export const FIXED_GAME_STAKE_NUMBER = 0.0001;
export const FIXED_GAME_STAKE_DISPLAY = "0.0001";

export const USDC_ADDRESS: string = process.env.NEXT_PUBLIC_USDC_ADDRESS || "";
export const USDC_FAUCET_ADDRESS: string =
  process.env.NEXT_PUBLIC_USDC_FAUCET_ADDRESS || "";
export const GAME_VAULT_ADDRESS: string = process.env.NEXT_PUBLIC_GAME_VAULT_ADDRESS || "";
export const GAME_SETTLEMENT_ADDRESS: string =
  process.env.NEXT_PUBLIC_GAME_SETTLEMENT_ADDRESS || "";
export const TRUST_PASSPORT_ADDRESS: string =
  process.env.NEXT_PUBLIC_TRUST_PASSPORT_ADDRESS || "";

export const ERC20_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const GAME_VAULT_ABI = [
  {
    type: "function",
    name: "availableBalanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "lockedBalanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

export const GAME_SETTLEMENT_ABI = [
  {
    type: "function",
    name: "activeSessionOf",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "startSession",
    stateMutability: "nonpayable",
    inputs: [
      { name: "onchainSessionId", type: "bytes32" },
      { name: "stakeAmount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "settleWithSignature",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "resolution",
        type: "tuple",
        components: [
          { name: "sessionId", type: "bytes32" },
          { name: "player", type: "address" },
          { name: "stakeAmount", type: "uint256" },
          { name: "payoutAmount", type: "uint256" },
          { name: "finalMultiplierBp", type: "uint256" },
          { name: "outcome", type: "uint8" },
          { name: "deadline", type: "uint64" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export const USDC_FAUCET_ABI = [
  {
    type: "function",
    name: "claimAmount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;

export const TRUST_PASSPORT_ABI = [
  {
    type: "error",
    name: "InvalidSigner",
    inputs: [{ name: "signer", type: "address" }],
  },
  {
    type: "error",
    name: "InvalidPlayer",
    inputs: [{ name: "player", type: "address" }],
  },
  {
    type: "error",
    name: "InvalidTier",
    inputs: [{ name: "tier", type: "uint8" }],
  },
  {
    type: "error",
    name: "InvalidIssuedAt",
    inputs: [{ name: "issuedAt", type: "uint64" }],
  },
  {
    type: "error",
    name: "InvalidExpiry",
    inputs: [{ name: "expiry", type: "uint64" }],
  },
  {
    type: "error",
    name: "PassportClaimExpired",
    inputs: [{ name: "expiry", type: "uint64" }],
  },
  {
    type: "error",
    name: "NonceAlreadyUsed",
    inputs: [{ name: "nonce", type: "uint256" }],
  },
  {
    type: "error",
    name: "InvalidSignatureSigner",
    inputs: [
      { name: "recovered", type: "address" },
      { name: "expected", type: "address" },
    ],
  },
  {
    type: "error",
    name: "StalePassportClaim",
    inputs: [
      { name: "issuedAt", type: "uint64" },
      { name: "currentIssuedAt", type: "uint64" },
    ],
  },
  {
    type: "error",
    name: "PassportAlreadyRevoked",
    inputs: [{ name: "player", type: "address" }],
  },
  {
    type: "function",
    name: "backendSigner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "paused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "getPassport",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [
      { name: "tier", type: "uint8" },
      { name: "issuedAt", type: "uint64" },
      { name: "expiry", type: "uint64" },
      { name: "revoked", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "isPassportValid",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "usedNonces",
    stateMutability: "view",
    inputs: [{ name: "nonce", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "claimWithSignature",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "claim",
        type: "tuple",
        components: [
          { name: "player", type: "address" },
          { name: "tier", type: "uint8" },
          { name: "issuedAt", type: "uint64" },
          { name: "expiry", type: "uint64" },
          { name: "nonce", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export function hasDepositContractConfig() {
  return Boolean(
    isAddress(USDC_ADDRESS) &&
      isAddress(GAME_VAULT_ADDRESS)
  );
}

export function hasGameContractConfig() {
  return Boolean(
    isAddress(USDC_ADDRESS) &&
      isAddress(GAME_VAULT_ADDRESS) &&
      isAddress(GAME_SETTLEMENT_ADDRESS)
  );
}

export function hasPassportContractConfig() {
  return Boolean(isAddress(TRUST_PASSPORT_ADDRESS));
}
