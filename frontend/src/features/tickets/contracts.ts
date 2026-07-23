import { parseAbi } from "viem";
import {
  CELO_MAINNET_CHAIN_ID,
  CELO_SEPOLIA_CHAIN_ID,
  type EvmAddress,
  type SupportedCeloChainId,
} from "./domain.ts";

export const TICKET_VAULT_ABI = parseAbi([
  "function DAILY_CLAIM_TYPEHASH() view returns (bytes32)",
  "function TICKETS_PER_USD() view returns (uint256)",
  "function MAX_TICKETS_PER_CLAIM() view returns (uint16)",
  "function backendSigner() view returns (address)",
  "function treasury() view returns (address)",
  "function claimSignatureTtl() view returns (uint64)",
  "function totalTicketsIssued() view returns (uint256)",
  "function totalTicketsSpent() view returns (uint256)",
  "function ticketBalance(address user) view returns (uint256)",
  "function lastClaimDay(address user) view returns (uint32)",
  "function usedNonces(uint256 nonce) view returns (bool)",
  "function tokens(address token) view returns (bool enabled, uint8 decimals)",
  "function claimDaily((address user, uint32 dayIndex, uint16 amount, uint64 issuedAt, uint256 nonce) claim, bytes signature)",
  "function hashDailyClaim((address user, uint32 dayIndex, uint16 amount, uint64 issuedAt, uint256 nonce) claim) view returns (bytes32)",
  "function buyTickets(address token, uint256 usdAmount)",
  "event BackendSignerUpdated(address indexed signer)",
  "event TreasuryUpdated(address indexed treasury)",
  "event ClaimSignatureTtlUpdated(uint64 ttl)",
  "event TokenConfigured(address indexed token, uint8 decimals, bool enabled)",
  "event TokenRescued(address indexed token, address indexed recipient, uint256 amount)",
  "event TicketClaimed(address indexed user, uint32 indexed dayIndex, uint16 amount, uint256 nonce)",
  "event TicketPurchased(address indexed user, address indexed token, uint256 usdAmount, uint256 cost, uint256 tickets)",
  "event TicketCredited(address indexed user, uint256 amount)",
  "event TicketSpent(address indexed user, uint256 amount)",
  "error InvalidSigner(address signer)",
  "error InvalidTreasury(address treasury)",
  "error InvalidUser(address user)",
  "error InvalidToken(address token)",
  "error InvalidRecipient(address recipient)",
  "error DecimalsMismatch(uint8 declared, uint8 actual)",
  "error InvalidSignatureTtl(uint64 ttl)",
  "error TokenNotEnabled(address token)",
  "error ZeroAmount()",
  "error ZeroTicketAmount()",
  "error TicketAmountTooLarge(uint16 amount, uint16 maxAmount)",
  "error DailyClaimExpired(uint64 issuedAt, uint64 ttl)",
  "error DailyClaimInFuture(uint64 issuedAt)",
  "error DayAlreadyClaimed(uint32 lastClaimDay, uint32 dayIndex)",
  "error NonceAlreadyUsed(uint256 nonce)",
  "error InvalidSignatureSigner(address recovered, address expected)",
  "error LengthMismatch(uint256 usersLength, uint256 amountsLength)",
  "error InsufficientTickets(uint256 balance, uint256 requested)",
  "error EnforcedPause()",
  "error ReentrancyGuardReentrantCall()",
]);

export const GAME_VAULT_READ_ABI = parseAbi([
  "function availableBalanceOf(address account) view returns (uint256)",
]);

type TicketVaultDeployment = {
  proxyAddress: EvmAddress;
  implementationAddress: EvmAddress;
  deploymentVersion: string;
  shopEnabled: boolean;
};

export const TICKET_VAULT_DEPLOYMENTS = {
  [CELO_MAINNET_CHAIN_ID]: {
    proxyAddress: "0x8a1bd73ddfb4e06779d9c578a6447ae9b48199d5",
    implementationAddress: "0xac5574ec54baf71a855f9fc5989f51f555965f71",
    deploymentVersion: "ticket-vault-v1-impl-0xac5574ec",
    shopEnabled: false,
  },
  [CELO_SEPOLIA_CHAIN_ID]: {
    proxyAddress: "0x1490e6b836f552e8504fe6404c30953b15f899c8",
    implementationAddress: "0x6c131a955d24aac1e978558e94d733c5dd967137",
    deploymentVersion: "ticket-vault-v1-impl-0x6c131a95",
    shopEnabled: true,
  },
} as const satisfies Record<SupportedCeloChainId, TicketVaultDeployment>;

export const LEGACY_GAME_VAULT_ADDRESSES = {
  [CELO_MAINNET_CHAIN_ID]: "0x8fb74c2a678811aecc6ed98bd5bc70e1119b7b61",
  [CELO_SEPOLIA_CHAIN_ID]: "0x4bf6d3c0dbbc14ef0c7f2a4daed7d97418fc5adf",
} as const satisfies Record<SupportedCeloChainId, EvmAddress>;
