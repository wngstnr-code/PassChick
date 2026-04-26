import "dotenv/config";

/**
 * Validated environment configuration.
 * Fails fast at startup if required variables are missing.
 */

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

export const env = {
  // Server
  PORT: parseInt(optionalEnv("PORT", "3001"), 10),
  FRONTEND_URL: optionalEnv("FRONTEND_URL", "http://localhost:3000"),
  NODE_ENV: optionalEnv("NODE_ENV", "development"),

  // Session
  SESSION_SECRET: requireEnv("SESSION_SECRET", "dev-secret-change-me-in-production-please-32chars"),

  // Supabase
  SUPABASE_URL: requireEnv("SUPABASE_URL", "https://placeholder.supabase.co"),
  SUPABASE_SERVICE_ROLE_KEY: requireEnv("SUPABASE_SERVICE_ROLE_KEY", "placeholder-key"),

  // Blockchain (Celo first, Monad kept as temporary backward-compatible fallback)
  CELO_RPC_URL: optionalEnv("CELO_RPC_URL", process.env.MONAD_RPC_URL ?? "https://forno.celo-sepolia.celo-testnet.org"),
  CELO_CHAIN_ID: parseInt(optionalEnv("CELO_CHAIN_ID", process.env.MONAD_CHAIN_ID ?? "11142220"), 10),

  // Smart Contract
  GAME_VAULT_ADDRESS: optionalEnv("GAME_VAULT_ADDRESS", "0x0000000000000000000000000000000000000000"),
  GAME_SETTLEMENT_ADDRESS: optionalEnv("GAME_SETTLEMENT_ADDRESS", "0x0000000000000000000000000000000000000000"),
  TRUST_PASSPORT_ADDRESS: optionalEnv("TRUST_PASSPORT_ADDRESS", "0x0000000000000000000000000000000000000000"),

  // Backend Signer
  BACKEND_PRIVATE_KEY: optionalEnv(
    "BACKEND_PRIVATE_KEY",
    "0x0000000000000000000000000000000000000000000000000000000000000000"
  ),

  // Settlement
  SETTLEMENT_SIGNATURE_TTL_SECONDS: parseInt(optionalEnv("SETTLEMENT_SIGNATURE_TTL_SECONDS", "86400"), 10),
  PASSPORT_SIGNATURE_TTL_SECONDS: parseInt(optionalEnv("PASSPORT_SIGNATURE_TTL_SECONDS", "900"), 10),
  PASSPORT_VALIDITY_SECONDS: parseInt(optionalEnv("PASSPORT_VALIDITY_SECONDS", "2592000"), 10),
} as const;

// Log config status on import (non-sensitive)
console.log(`🔧 Config loaded:`);
console.log(`   Port: ${env.PORT}`);
console.log(`   Frontend: ${env.FRONTEND_URL}`);
console.log(`   Supabase: ${env.SUPABASE_URL.replace(/https?:\/\//, "").substring(0, 20)}...`);
console.log(`   Celo RPC: ${env.CELO_RPC_URL}`);
console.log(`   Chain ID: ${env.CELO_CHAIN_ID}`);
console.log(`   Vault: ${env.GAME_VAULT_ADDRESS.substring(0, 10)}...`);
console.log(`   Settlement: ${env.GAME_SETTLEMENT_ADDRESS.substring(0, 10)}...`);
console.log(`   Passport: ${env.TRUST_PASSPORT_ADDRESS.substring(0, 10)}...`);
