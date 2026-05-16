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
- **Three.js**: 3D engine for high-performance gameplay.
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
