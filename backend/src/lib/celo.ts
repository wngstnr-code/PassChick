import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  maxUint256,
  parseAbi,
  zeroHash,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../config/env.js";

export const celoChain = {
  id: env.CHAIN_ID,
  name: env.NETWORK_NAME,
  nativeCurrency: {
    name: env.NATIVE_TOKEN_SYMBOL,
    symbol: env.NATIVE_TOKEN_SYMBOL,
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [env.RPC_URL] },
    public: { http: [env.RPC_URL] },
  },
} as const;

export const publicClient = createPublicClient({
  chain: celoChain,
  transport: http(env.RPC_URL),
});

function normalizePrivateKey(value: string): Hex {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("BACKEND_PRIVATE_KEY is required to sign Celo transactions");
  }
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
    throw new Error("BACKEND_PRIVATE_KEY must be a 32-byte EVM private key hex string");
  }
  return withPrefix as Hex;
}

export const backendAccount = privateKeyToAccount(normalizePrivateKey(env.BACKEND_PRIVATE_KEY));

export const walletClient = createWalletClient({
  account: backendAccount,
  chain: celoChain,
  transport: http(env.RPC_URL),
});

export const USDC_ADDRESS = getAddress(env.USDC_ADDRESS);
export const GAME_VAULT_ADDRESS = getAddress(env.GAME_VAULT_ADDRESS);
export const GAME_SETTLEMENT_ADDRESS = getAddress(env.GAME_SETTLEMENT_ADDRESS);
export const TRUST_PASSPORT_ADDRESS = env.TRUST_PASSPORT_ADDRESS
  ? getAddress(env.TRUST_PASSPORT_ADDRESS)
  : ("0x0000000000000000000000000000000000000000" as Address);
export const FAUCET_CONTRACT_ADDRESS = env.FAUCET_CONTRACT_ADDRESS
  ? getAddress(env.FAUCET_CONTRACT_ADDRESS)
  : ("0x0000000000000000000000000000000000000000" as Address);

export const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
]);

export const GAME_VAULT_ABI = parseAbi([
  "function availableBalanceOf(address account) view returns (uint256)",
  "function lockedBalanceOf(address account) view returns (uint256)",
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "event Deposited(address indexed account, uint256 amount)",
  "event Withdrawn(address indexed account, uint256 amount)",
  "event TreasuryFunded(address indexed funder, uint256 amount)",
  "event StakeLocked(address indexed player, bytes32 indexed sessionId, uint256 amount)",
  "event CashoutSettled(address indexed player, bytes32 indexed sessionId, uint256 stakeAmount, uint256 payoutAmount)",
  "event CrashSettled(address indexed player, bytes32 indexed sessionId, uint256 stakeAmount)",
]);

export const GAME_SETTLEMENT_ABI = parseAbi([
  "function activeSessionOf(address player) view returns (bytes32)",
  "function getSession(bytes32 sessionId) view returns ((address player,uint256 stakeAmount,uint64 startedAt,bool active,bool settled))",
  "function startSession(bytes32 onchainSessionId, uint256 stakeAmount)",
  "function settleWithSignature((bytes32 sessionId,address player,uint256 stakeAmount,uint256 payoutAmount,uint256 finalMultiplierBp,uint8 outcome,uint64 deadline) resolution, bytes signature)",
  "event SessionStarted(address indexed player, bytes32 indexed sessionId, uint256 stakeAmount)",
  "event SessionExpired(address indexed player, bytes32 indexed sessionId, uint256 stakeAmount)",
  "event SessionSettled(address indexed player, bytes32 indexed sessionId, uint8 outcome, uint256 stakeAmount, uint256 payoutAmount, uint256 finalMultiplierBp)",
]);

export const TRUST_PASSPORT_ABI = parseAbi([
  "function backendSigner() view returns (address)",
  "function paused() view returns (bool)",
  "function getPassport(address player) view returns ((uint8 tier,uint64 issuedAt,uint64 expiry,bool revoked))",
  "function isPassportValid(address player) view returns (bool)",
  "function usedNonces(uint256 nonce) view returns (bool)",
  "function claimWithSignature((address player,uint8 tier,uint64 issuedAt,uint64 expiry,uint256 nonce) claim, bytes signature)",
]);

export const FAUCET_ABI = parseAbi([
  "function claim()",
  "event Claimed(address indexed account, uint256 amount)",
]);

export type PreparedEvmTransaction = {
  chainId: number;
  from: Address;
  to: Address;
  data: Hex;
  value: "0x0";
};

function prepareContractTransaction(params: {
  from: Address;
  to: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}): PreparedEvmTransaction {
  return {
    chainId: env.CHAIN_ID,
    from: params.from,
    to: params.to,
    data: encodeFunctionData({
      abi: params.abi,
      functionName: params.functionName,
      args: params.args ?? [],
    }),
    value: "0x0",
  };
}

export function normalizeSessionId(value: string): Hex {
  const trimmed = String(value || "").trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed as Hex;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return `0x${trimmed}` as Hex;
  throw new Error(`sessionId must be bytes32 hex, got "${value}"`);
}

export function normalizePlayerAddress(value: string): Address {
  if (!isAddress(String(value || "").trim())) {
    throw new Error(`Invalid EVM address: ${value}`);
  }
  return getAddress(value);
}

export async function buildDepositTransaction(
  player: string,
  amount: bigint,
): Promise<PreparedEvmTransaction> {
  return prepareContractTransaction({
    from: normalizePlayerAddress(player),
    to: GAME_VAULT_ADDRESS,
    abi: GAME_VAULT_ABI,
    functionName: "deposit",
    args: [amount],
  });
}

export async function buildWithdrawTransaction(
  player: string,
  amount: bigint,
): Promise<PreparedEvmTransaction> {
  return prepareContractTransaction({
    from: normalizePlayerAddress(player),
    to: GAME_VAULT_ADDRESS,
    abi: GAME_VAULT_ABI,
    functionName: "withdraw",
    args: [amount],
  });
}

export async function buildStartSessionTransaction(
  player: string,
  sessionIdHex: string,
  stakeAmountUnits: bigint,
): Promise<PreparedEvmTransaction> {
  return prepareContractTransaction({
    from: normalizePlayerAddress(player),
    to: GAME_SETTLEMENT_ADDRESS,
    abi: GAME_SETTLEMENT_ABI,
    functionName: "startSession",
    args: [normalizeSessionId(sessionIdHex), stakeAmountUnits],
  });
}

export async function buildClaimFaucetTransaction(
  player: string,
): Promise<PreparedEvmTransaction> {
  if (FAUCET_CONTRACT_ADDRESS === "0x0000000000000000000000000000000000000000") {
    throw new Error("FAUCET_CONTRACT_ADDRESS is not configured.");
  }
  return prepareContractTransaction({
    from: normalizePlayerAddress(player),
    to: FAUCET_CONTRACT_ADDRESS,
    abi: FAUCET_ABI,
    functionName: "claim",
  });
}

export interface PlayerBalanceState {
  owner: string;
  availableBalance: bigint;
  lockedBalance: bigint;
  activeSession: string;
  bump: number;
}

export async function readPlayerBalance(player: string): Promise<PlayerBalanceState | null> {
  const address = normalizePlayerAddress(player);
  const [availableBalance, lockedBalance, activeSession] = await Promise.all([
    publicClient.readContract({
      address: GAME_VAULT_ADDRESS,
      abi: GAME_VAULT_ABI,
      functionName: "availableBalanceOf",
      args: [address],
    }),
    publicClient.readContract({
      address: GAME_VAULT_ADDRESS,
      abi: GAME_VAULT_ABI,
      functionName: "lockedBalanceOf",
      args: [address],
    }),
    publicClient.readContract({
      address: GAME_SETTLEMENT_ADDRESS,
      abi: GAME_SETTLEMENT_ABI,
      functionName: "activeSessionOf",
      args: [address],
    }),
  ]);

  return {
    owner: address,
    availableBalance,
    lockedBalance,
    activeSession,
    bump: 0,
  };
}

export interface SessionState {
  sessionId: string;
  player: string;
  stakeAmount: bigint;
  startedAt: number;
  active: boolean;
  settled: boolean;
}

export async function readSession(sessionId: string): Promise<SessionState | null> {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const session = await publicClient.readContract({
    address: GAME_SETTLEMENT_ADDRESS,
    abi: GAME_SETTLEMENT_ABI,
    functionName: "getSession",
    args: [normalizedSessionId],
  });

  if (session.player === "0x0000000000000000000000000000000000000000") return null;
  return {
    sessionId: normalizedSessionId,
    player: getAddress(session.player),
    stakeAmount: session.stakeAmount,
    startedAt: Number(session.startedAt),
    active: session.active,
    settled: session.settled,
  };
}

export async function readActiveOnchainSession(walletAddress: string): Promise<{
  sessionId: string;
  player: string;
  stakeAmountUnits: bigint;
} | null> {
  let player: Address;
  try {
    player = normalizePlayerAddress(walletAddress);
  } catch {
    return null;
  }

  const activeSession = await publicClient.readContract({
    address: GAME_SETTLEMENT_ADDRESS,
    abi: GAME_SETTLEMENT_ABI,
    functionName: "activeSessionOf",
    args: [player],
  });
  if (activeSession === zeroHash) return null;

  const session = await readSession(activeSession);
  if (!session) return null;
  if (!session.active || session.settled) return null;
  if (session.player.toLowerCase() !== player.toLowerCase()) return null;

  return {
    sessionId: activeSession,
    player: session.player,
    stakeAmountUnits: session.stakeAmount,
  };
}

export async function readTransactionStatus(hash: string): Promise<{
  found: boolean;
  success: boolean | null;
}> {
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: hash as Hex });
    return { found: true, success: receipt.status === "success" };
  } catch (error) {
    const message = String((error as { message?: string })?.message || "").toLowerCase();
    if (message.includes("not found") || message.includes("could not find")) {
      return { found: false, success: null };
    }
    throw error;
  }
}

export function isZeroSessionId(value: string): boolean {
  return /^0x0{64}$/i.test(value);
}

export async function readWalletTokenBalance(player: string): Promise<bigint> {
  return publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [normalizePlayerAddress(player)],
  });
}

export async function readTokenAllowance(player: string, spender: string): Promise<bigint> {
  return publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [normalizePlayerAddress(player), normalizePlayerAddress(spender)],
  });
}

export async function buildApproveTransaction(
  player: string,
  spender: string,
  amount: bigint = maxUint256,
): Promise<PreparedEvmTransaction> {
  return prepareContractTransaction({
    from: normalizePlayerAddress(player),
    to: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [normalizePlayerAddress(spender), amount],
  });
}

export async function readVaultTokenBalance(): Promise<bigint> {
  return publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [GAME_VAULT_ADDRESS],
  });
}

export interface EggPassClaim {
  tier: number;
  highestCheckpoint?: number;
  cp2Cashouts?: number;
  cp4Cashouts?: number;
  cp6Cashouts?: number;
  cp8Cashouts?: number;
  reputationScore?: number;
  issuedAt: bigint;
  expiry: bigint;
  nonce: Buffer;
}

export interface EggPassAccount {
  player: string;
  tier: number;
  highestCheckpoint: number;
  cp2Cashouts: number;
  cp4Cashouts: number;
  cp6Cashouts: number;
  cp8Cashouts: number;
  reputationScore: number;
  issuedAt: number;
  expiry: number;
  revoked: boolean;
}

function nonceBufferToUint256(nonce: Buffer): bigint {
  if (nonce.length !== 32) {
    throw new Error(`EggPass nonce must be 32 bytes, got ${nonce.length}`);
  }
  return BigInt(`0x${nonce.toString("hex")}`);
}

export async function readEggPass(player: string): Promise<EggPassAccount | null> {
  if (TRUST_PASSPORT_ADDRESS === "0x0000000000000000000000000000000000000000") {
    return null;
  }
  const address = normalizePlayerAddress(player);
  const passport = await publicClient.readContract({
    address: TRUST_PASSPORT_ADDRESS,
    abi: TRUST_PASSPORT_ABI,
    functionName: "getPassport",
    args: [address],
  });

  if (passport.tier === 0 && passport.issuedAt === 0n) return null;
  return {
    player: address,
    tier: passport.tier,
    highestCheckpoint: 0,
    cp2Cashouts: 0,
    cp4Cashouts: 0,
    cp6Cashouts: 0,
    cp8Cashouts: 0,
    reputationScore: 0,
    issuedAt: Number(passport.issuedAt),
    expiry: Number(passport.expiry),
    revoked: passport.revoked,
  };
}

export function eggPassId(player: string): string {
  return normalizePlayerAddress(player);
}

export async function signPassportClaim(player: string, claim: EggPassClaim): Promise<Hex> {
  const address = normalizePlayerAddress(player);
  const nonce = nonceBufferToUint256(claim.nonce);
  return walletClient.signTypedData({
    account: backendAccount,
    domain: {
      name: "ChickenTrustPassport",
      version: "1",
      chainId: env.CHAIN_ID,
      verifyingContract: TRUST_PASSPORT_ADDRESS,
    },
    types: {
      PassportClaim: [
        { name: "player", type: "address" },
        { name: "tier", type: "uint8" },
        { name: "issuedAt", type: "uint64" },
        { name: "expiry", type: "uint64" },
        { name: "nonce", type: "uint256" },
      ],
    },
    primaryType: "PassportClaim",
    message: {
      player: address,
      tier: claim.tier,
      issuedAt: claim.issuedAt,
      expiry: claim.expiry,
      nonce,
    },
  });
}

export async function buildClaimEggPassTransaction(
  player: string,
  claim: EggPassClaim,
): Promise<PreparedEvmTransaction> {
  const address = normalizePlayerAddress(player);
  const nonce = nonceBufferToUint256(claim.nonce);
  const signature = await signPassportClaim(address, claim);
  return prepareContractTransaction({
    from: address,
    to: TRUST_PASSPORT_ADDRESS,
    abi: TRUST_PASSPORT_ABI,
    functionName: "claimWithSignature",
    args: [
      {
        player: address,
        tier: claim.tier,
        issuedAt: claim.issuedAt,
        expiry: claim.expiry,
        nonce,
      },
      signature,
    ],
  });
}

export async function signSettlementResolution(resolution: {
  sessionId: string;
  player: string;
  stakeAmount: bigint;
  payoutAmount: bigint;
  finalMultiplierBp: bigint;
  outcome: number;
  deadline: bigint;
}): Promise<Hex> {
  return walletClient.signTypedData({
    account: backendAccount,
    domain: {
      name: "ChickenCrossingSettlement",
      version: "1",
      chainId: env.CHAIN_ID,
      verifyingContract: GAME_SETTLEMENT_ADDRESS,
    },
    types: {
      Resolution: [
        { name: "sessionId", type: "bytes32" },
        { name: "player", type: "address" },
        { name: "stakeAmount", type: "uint256" },
        { name: "payoutAmount", type: "uint256" },
        { name: "finalMultiplierBp", type: "uint256" },
        { name: "outcome", type: "uint8" },
        { name: "deadline", type: "uint64" },
      ],
    },
    primaryType: "Resolution",
    message: {
      sessionId: normalizeSessionId(resolution.sessionId),
      player: normalizePlayerAddress(resolution.player),
      stakeAmount: resolution.stakeAmount,
      payoutAmount: resolution.payoutAmount,
      finalMultiplierBp: resolution.finalMultiplierBp,
      outcome: resolution.outcome,
      deadline: resolution.deadline,
    },
  });
}
