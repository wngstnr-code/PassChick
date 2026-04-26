# Pass Chick Frontend

The Pass Chick frontend is a Next.js application that handles:

- wallet connection
- SIWE authentication against the backend
- vault deposit
- gameplay start and cashout
- trust passport UX

## Live Deployment

- App: https://pass-chick.vercel.app/

## Stack

- Next.js 14
- React 18
- Wagmi
- Viem
- Reown AppKit
- Socket.io client

## MiniPay Status

- The frontend now detects MiniPay and auto-reads the injected wallet in the browser.
- MiniPay users now create a backend session without SIWE message signing, because MiniPay does not support that flow.
- This build now targets Celo and supports both Sepolia demo wiring and mainnet-style no-faucet wiring.
- For local MiniPay testing, run `npm run dev`, expose port `3000` with `ngrok http 3000`, then load the HTTPS URL from MiniPay's Test Page.

## Commands

```bash
npm install
npm run dev
npm run build
npm run start
```

## Required Environment

Example values live in `frontend/.env.example`.

```bash
NEXT_PUBLIC_CELO_CHAIN_ID=0xa4ec
NEXT_PUBLIC_CELO_CHAIN_NAME=Celo Mainnet
NEXT_PUBLIC_CELO_RPC_URLS=https://forno.celo.org
NEXT_PUBLIC_CELO_EXPLORER_URLS=https://celoscan.io
NEXT_PUBLIC_CELO_NATIVE_NAME=CELO
NEXT_PUBLIC_CELO_NATIVE_SYMBOL=CELO
NEXT_PUBLIC_CELO_NATIVE_DECIMALS=18

NEXT_PUBLIC_USDC_ADDRESS=0xcebA9300f2b948710d2653dD7B07f33A8B32118C
NEXT_PUBLIC_USDC_FAUCET_ADDRESS=
NEXT_PUBLIC_GAME_VAULT_ADDRESS=0x...
NEXT_PUBLIC_GAME_SETTLEMENT_ADDRESS=0x...
NEXT_PUBLIC_TRUST_PASSPORT_ADDRESS=0x...

NEXT_PUBLIC_DEPOSIT_DATA_SOURCE=onchain
NEXT_PUBLIC_BACKEND_API_URL=http://localhost:8000
NEXT_PUBLIC_REOWN_PROJECT_ID=your_reown_project_id
```

## Current Local Defaults

- frontend app: `http://localhost:3000`
- backend API: `http://localhost:8000`

## Current Contract Wiring

- `NEXT_PUBLIC_USDC_ADDRESS=` set this to your active Celo USDC address
- `NEXT_PUBLIC_USDC_FAUCET_ADDRESS=` optional, only fill this for Sepolia/demo builds
- `NEXT_PUBLIC_GAME_VAULT_ADDRESS=` set this to your active Celo vault address
- `NEXT_PUBLIC_GAME_SETTLEMENT_ADDRESS=` set this to your active Celo settlement address
- `NEXT_PUBLIC_TRUST_PASSPORT_ADDRESS=` set this to your active Celo passport address

## Common Issues

### Wallet connection fails

Check:

- `NEXT_PUBLIC_REOWN_PROJECT_ID` is valid
- the wallet is switched to the expected Celo network
- the frontend was restarted after `.env` changes

### Backend auth fails

Check:

- the backend is running on `http://localhost:8000`
- `NEXT_PUBLIC_BACKEND_API_URL` matches the actual backend URL
- `FRONTEND_URL` in the backend matches the frontend origin

### RPC rate limits

If you see RPC instability, the issue can come from the public Celo RPC.
The best fix is to use a stronger RPC provider for both frontend and backend.

## Build

```bash
npm run build
```

Reown warnings can still appear during build in restricted environments, but they do not necessarily mean the frontend failed to compile.
