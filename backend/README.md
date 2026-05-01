# Pass Chick Backend

The Pass Chick backend powers the server-authoritative game flow and authentication.

Main responsibilities:

- SIWE authentication
- MiniPay-compatible session bootstrap
- session cookie management
- real-time gameplay over Socket.io
- settlement signing
- onchain settlement relaying
- leaderboard and player APIs
- trust passport eligibility and signature issuance

## Stack

- Express
- Socket.io
- Viem
- SIWE
- Supabase

## Commands

```bash
npm install
npm run dev
npm run build
npm run start
```

## Live Development

- Server: passchick-production.up.railway.app 

## Runtime

Default local setup:

- backend URL: `http://localhost:8000`
- expected frontend origin: `http://localhost:3000`

## Required Environment

The backend reads values from `backend/.env`.

```bash
PORT=8000
FRONTEND_URL=http://localhost:3000

SESSION_SECRET=your_session_secret

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

CELO_RPC_URL=https://forno.celo.org
CELO_CHAIN_ID=42220

GAME_VAULT_ADDRESS=0x...
GAME_SETTLEMENT_ADDRESS=0x...
TRUST_PASSPORT_ADDRESS=0x...

BACKEND_PRIVATE_KEY=0x...

SETTLEMENT_SIGNATURE_TTL_SECONDS=86400
PASSPORT_SIGNATURE_TTL_SECONDS=900
PASSPORT_VALIDITY_SECONDS=2592000
MINIPAY_UNVERIFIED_AUTH_ENABLED=true
```

## Current Contract Wiring

- `GAME_VAULT_ADDRESS=` set this to your active Celo mainnet vault address
- `GAME_SETTLEMENT_ADDRESS=` set this to your active Celo mainnet settlement address
- `TRUST_PASSPORT_ADDRESS=` set this to your active Celo mainnet passport address

The backend signer must stay in sync with the onchain signer used by:

- settlement signatures
- passport signatures

## Important Routes

Auth:

- `GET /auth/nonce`
- `POST /auth/verify`
- `POST /auth/minipay`
- `POST /auth/logout`
- `GET /auth/me`

MiniPay note:

- `POST /auth/minipay` is a wallet-session bootstrap for MiniPay where message signing is unavailable.
- Keep `MINIPAY_UNVERIFIED_AUTH_ENABLED=true` only for the MiniPay-compatible flow you intend to support.

Game and player:

- `GET /api/game/active`
- `GET /api/game/pending-settlement`
- `POST /api/game/submit-settlement`
- `GET /api/leaderboard/...`
- `GET /api/player/...`

Passport:

- `GET /api/passport/status`
- `POST /api/passport/issue-signature`

Health:

- `GET /health`

## Common Issues

### Frontend cannot authenticate

Check:

- the backend is actually running on the same URL configured in `NEXT_PUBLIC_BACKEND_API_URL`
- `FRONTEND_URL` matches the deployed or local frontend origin
- the browser accepts cookies for the current environment

### Cashout fails

Common causes:

- the backend relayer ran out of `CELO` for gas
- Celo RPC failed or was rate-limited
- the backend signer does not match the onchain `backendSigner`
- the vault treasury is not large enough for the payout

The backend maps settlement failures into more specific messages to make debugging easier.

## Database

Supabase schema:

- [database/schema.sql](./database/schema.sql)
