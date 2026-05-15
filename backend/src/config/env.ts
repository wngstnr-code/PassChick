import "dotenv/config";

function requireEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value) {
    console.error(`❌ Missing required environment variable: ${key}`);
    console.error(`   → Copy .env.example to .env and fill in the values.`);
    process.exit(1);
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function optionalAlias(primaryKey: string, fallback: string, ...aliasKeys: string[]): string {
  for (const key of [primaryKey, ...aliasKeys]) {
    const value = process.env[key];
    if (value) return value;
  }
  return fallback;
}

const CELO_CHAIN_ID = parseInt(optionalAlias("CELO_CHAIN_ID", "11142220", "CHAIN_ID"), 10);
const RPC_URL = optionalAlias(
  "CELO_RPC_URL",
  CELO_CHAIN_ID === 42220
    ? "https://forno.celo.org"
    : "https://forno.celo-sepolia.celo-testnet.org",
  "RPC_URL",
);

export const env = {
  PORT: parseInt(optionalEnv("PORT", "3001"), 10),
  FRONTEND_URL: optionalEnv("FRONTEND_URL", "http://localhost:3000"),
  NODE_ENV: optionalEnv("NODE_ENV", "development"),

  SESSION_SECRET: requireEnv("SESSION_SECRET", "dev-secret-change-me-in-production-please-32chars"),

  SUPABASE_URL: requireEnv("SUPABASE_URL", "https://placeholder.supabase.co"),
  SUPABASE_SERVICE_ROLE_KEY: requireEnv("SUPABASE_SERVICE_ROLE_KEY", "placeholder-key"),

  NETWORK_NAME: optionalEnv(
    "NETWORK_NAME",
    CELO_CHAIN_ID === 42220 ? "celo-mainnet" : "celo-sepolia",
  ),
  RPC_URL,
  CHAIN_ID: CELO_CHAIN_ID,
  NATIVE_TOKEN_SYMBOL: optionalEnv("NATIVE_TOKEN_SYMBOL", "CELO"),
  MIN_RECOMMENDED_NATIVE_BALANCE: Number.parseFloat(optionalEnv("MIN_RECOMMENDED_NATIVE_BALANCE", "0.05")),

  USDC_ADDRESS: optionalEnv("USDC_ADDRESS", ""),
  TOKEN_DECIMALS: parseInt(optionalEnv("TOKEN_DECIMALS", "6"), 10),

  GAME_VAULT_ADDRESS: optionalEnv("GAME_VAULT_ADDRESS", ""),
  GAME_SETTLEMENT_ADDRESS: optionalEnv("GAME_SETTLEMENT_ADDRESS", ""),
  TRUST_PASSPORT_ADDRESS: optionalEnv("TRUST_PASSPORT_ADDRESS", ""),
  FAUCET_CONTRACT_ADDRESS: optionalAlias("FAUCET_CONTRACT_ADDRESS", "", "GAME_FAUCET_ADDRESS"),
  FAUCET_MODE: optionalEnv("FAUCET_MODE", "claim"),
  FAUCET_AMOUNT_UNITS: optionalEnv("FAUCET_AMOUNT_UNITS", "100000000"),
  FAUCET_COOLDOWN_SECONDS: parseInt(optionalEnv("FAUCET_COOLDOWN_SECONDS", "300"), 10),

  BACKEND_PRIVATE_KEY: optionalEnv("BACKEND_PRIVATE_KEY", ""),
  ADMIN_ADDRESS: optionalAlias("ADMIN_ADDRESS", "", "ADMIN_PUBKEY"),
  BACKEND_SIGNER_ADDRESS: optionalAlias("BACKEND_SIGNER_ADDRESS", "", "BACKEND_SIGNER_PUBKEY"),

  SETTLEMENT_SIGNATURE_TTL_SECONDS: parseInt(optionalEnv("SETTLEMENT_SIGNATURE_TTL_SECONDS", "86400"), 10),
  PASSPORT_SIGNATURE_TTL_SECONDS: parseInt(optionalEnv("PASSPORT_SIGNATURE_TTL_SECONDS", "900"), 10),
  PASSPORT_VALIDITY_SECONDS: parseInt(optionalEnv("PASSPORT_VALIDITY_SECONDS", "2592000"), 10),

  SOCIAL_AUTH_ENABLED:
    optionalEnv("SOCIAL_AUTH_ENABLED", "true").toLowerCase() === "true",
} as const;

console.log(`🔧 Config loaded:`);
console.log(`   Port: ${env.PORT}`);
console.log(`   Frontend: ${env.FRONTEND_URL}`);
console.log(`   Supabase: ${env.SUPABASE_URL.replace(/https?:\/\//, "").substring(0, 20)}...`);
console.log(`   Network: ${env.NETWORK_NAME} (chainId ${env.CHAIN_ID})`);
console.log(`   RPC: ${env.RPC_URL}`);
console.log(`   USDC: ${env.USDC_ADDRESS || "(unset)"}`);
console.log(`   Vault: ${env.GAME_VAULT_ADDRESS || "(unset)"}`);
console.log(`   Settlement: ${env.GAME_SETTLEMENT_ADDRESS || "(unset)"}`);
console.log(`   Faucet: ${env.FAUCET_AMOUNT_UNITS} (${env.FAUCET_MODE})`);
