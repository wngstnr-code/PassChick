# Eggsistential Backend

The Eggsistential backend powers the server-authoritative game flow and authentication.

Main responsibilities:

- **SIWE Authentication**: Sign-In With Ethereum-compatible wallets for Celo sessions.
- **Social Login**: Easy onboarding for non-crypto users via Reown/AppKit-style embedded wallets.
- **Real-time Gameplay**: Low-latency game state synchronization over Socket.io.
- **Secure Settlements**: Signs EIP-712 game outcomes and relays them to Celo `GameSettlement`.
- **Player APIs**: Manages leaderboards, player profiles, vault status, and on-chain trust signatures.

## Stack

- **Express**: Web framework.
- **Socket.io**: Real-time communication.
- **Viem**: Celo/EVM RPC, transaction preparation, event ingestion, and EIP-712 signing.
- **Supabase**: Database and storage.

## Commands

```bash
npm install
npm run dev
npm run build
npm run start
```

## Runtime

Default local setup:

- Backend URL: `http://localhost:8000`
- Expected frontend origin: `http://localhost:3000`

## Required Environment

The backend reads values from `backend/.env`.

```bash
PORT=8000
FRONTEND_URL=http://localhost:3000
SESSION_SECRET=your_session_secret
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_key

# Celo network
NETWORK_NAME=celo-sepolia
CELO_RPC_URL=https://forno.celo-sepolia.celo-testnet.org
CELO_CHAIN_ID=11142220
NATIVE_TOKEN_SYMBOL=CELO

# Contract addresses
USDC_ADDRESS=
GAME_VAULT_ADDRESS=
GAME_SETTLEMENT_ADDRESS=
TRUST_PASSPORT_ADDRESS=
FAUCET_CONTRACT_ADDRESS=

# Backend EVM signer, hex with or without 0x
BACKEND_PRIVATE_KEY=
SOCIAL_AUTH_ENABLED=true
```

Celo chain IDs: `42220` for mainnet, `11142220` for Sepolia testnet.

## Database

The project uses Supabase for storing player history and session states.
The schema is defined in [database/schema.sql](./database/schema.sql).
