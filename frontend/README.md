# PASSCHICK Frontend

The PASSCHICK frontend is a modern web application built with Next.js, serving as the interface for the high-stakes chicken-crossing game.

## Core Responsibilities

- **Wallet UX**: Seamless connection using Reown AppKit, EVM wallets, and MiniPay.
- **Game Engine**: Interactive, high-performance canvas-based gameplay.
- **On-Chain Dashboard**: Manage vault balances, claim faucets, and track your Trust Passport reputation.
- **Backend Bridge**: Real-time communication with the game engine via Socket.io.

## Stack

- **Next.js**: Framework for the web app.
- **React**: Component library.
- **framer-motion**: Animation engine for canvas-based gameplay interactions.
- **Reown AppKit**: Multi-wallet and social login solution.
- **Socket.io Client**: Real-time bridge.
- **Tailwind CSS**: Modern styling.

## Commands

```bash
npm install
npm run dev
npm run build
npm run start
```

## Required Environment

```bash
NEXT_PUBLIC_REOWN_PROJECT_ID=
NEXT_PUBLIC_CELO_CHAIN_MODE=testnet
NEXT_PUBLIC_CELO_CHAIN_ID=11142220
NEXT_PUBLIC_CELO_CHAIN_NAME=Celo Sepolia
NEXT_PUBLIC_CELO_RPC_URL=https://forno.celo-sepolia.celo-testnet.org
NEXT_PUBLIC_CELO_EXPLORER_URL=https://celo-sepolia.blockscout.com

NEXT_PUBLIC_USDC_TOKEN_ADDRESS=
NEXT_PUBLIC_VAULT_ADDRESS=
NEXT_PUBLIC_BACKEND_API_URL=http://localhost:8000
```

## Build

```bash
npm run build
```

## Frontend UI Notes

- Keep page routes thin. Put real screen logic under `src/features/*` and let `src/app/*/page.tsx` act as route shells.
- Keep the Celo wallet path visible and simple: connect wallet, manage vault, play, then review Trust Passport state.
- Prioritize mobile readability for play, wallet, and vault screens. Important buttons should stay compact but easy to tap.
- Home page polish should preserve the arcade feel while keeping text legible, especially in leaderboard and Trust Passport sections.
- For UI commit slicing, prefer one focused change per commit: home, wallet, manage money, play HUD, responsive CSS, or docs.
- Validate meaningful frontend changes with `npm run build` before opening a PR.
