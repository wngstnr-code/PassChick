# PassChick

**On-chain chicken-crash game on Celo — where surviving the crash earns you proof of humanity.**

> Live Demo: `<LIVE_DEMO_URL>` *(replace after deploy)*

---

## Problem

Crash games are trivially exploited by bots — automated scripts time exits perfectly, siphon rewards, and degrade the experience for real players. PassChick solves this with **Trust Passport**: a tiered, backend-signed, onchain credential that gates gameplay to verified humans. No passport, no play.

## What is PassChick?

PassChick is a high-stakes chicken-crossing game on the Celo blockchain. Players stake USDC, lock it on-chain, and must decide when to "cash out" before the crash. Every game session is settled with an EIP-712 backend signature — no server-side custody, fully verifiable on Celo.

**Core loop:**
1. Connect wallet (MiniPay or any EVM wallet via Reown AppKit)
2. Claim or hold your **Trust Passport** (tiered anti-bot credential)
3. Deposit USDC into the **GameVault**
4. Start a session — stake is locked on-chain via **GameSettlement**
5. Cash out before the crash, or lose the stake

## Key Features

- **Trust Passport** — EIP-712 backend-signed credential stored onchain; tiered (Runner, Veteran…); prevents bot farming
- **MiniPay** — native Celo mobile wallet integration; no browser extension needed
- **Backend-authoritative settlement** — EIP-712 signed results, onchain settlement, no server-side funds custody
- **GameVault** — transparent split between `available`, `locked`, and `treasury` balances; player-auditable anytime
- **Fully on Celo mainnet** — fast finality, near-zero gas, USDC as stake currency

## Architecture

```
┌─────────────────────────────┐
│  Frontend (Next.js)         │
│  Reown AppKit / MiniPay     │
│  wagmi + viem               │
└────────────┬────────────────┘
             │ HTTP + WebSocket (Socket.io)
┌────────────▼────────────────┐
│  Backend (Express + TS)     │
│  EIP-712 signer             │
│  Supabase session store     │
│  MiniPay auth               │
└────────────┬────────────────┘
             │ onchain calls
┌────────────▼────────────────┐
│  Celo Mainnet (chain 42220) │
│  GameVault                  │
│  GameSettlement             │
│  TrustPassport              │
└─────────────────────────────┘
```

## Deployed Contracts — Celo Mainnet (chain 42220)

All contracts verified on Celoscan.

| Contract | Address | Explorer |
|---|---|---|
| GameVault | `0x8FB74c2a678811aECC6Ed98Bd5Bc70E1119b7B61` | [celoscan.io](https://celoscan.io/address/0x8FB74c2a678811aECC6Ed98Bd5Bc70E1119b7B61) |
| GameSettlement | `0x29b5333E2fbd4de48BD5fe14b3972d6Af24aa01E` | [celoscan.io](https://celoscan.io/address/0x29b5333E2fbd4de48BD5fe14b3972d6Af24aa01E) |
| TrustPassport | `0x4Bf6D3C0dBbC14eF0C7f2a4daeD7D97418Fc5aDf` | [celoscan.io](https://celoscan.io/address/0x4Bf6D3C0dBbC14eF0C7f2a4daeD7D97418Fc5aDf) |
| USDC (Celo native) | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` | [celoscan.io](https://celoscan.io/address/0xcebA9300f2b948710d2653dD7B07f33A8B32118C) |

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js, React, Tailwind CSS, framer-motion |
| Wallet | Reown AppKit, MiniPay, wagmi, viem |
| Backend | Express, Socket.io, TypeScript, Supabase |
| Contracts | Solidity 0.8.20, Foundry, OpenZeppelin (UUPS) |
| Chain | Celo Mainnet (EVM, chain 42220) |

## Run Locally

Prerequisites: Node 20+, Python 3.11+, Foundry.

- **Frontend** — see [frontend/README.md](frontend/README.md)
- **Backend** — see [backend/README.md](backend/README.md)
- **Smart Contracts** — see [sc/README.md](sc/README.md)
- **Smoke tests / wallet scripts** — see [scripts/README.md](scripts/README.md)

## License

MIT — see [LICENSE](LICENSE)

---

*Built for the Celo ecosystem.*

<!-- celo: today docs index 2000 -->

<!-- celo: today docs index 2001 -->

<!-- celo: today docs index 2016 -->

<!-- celo: today docs index 2019 -->

<!-- celo: today docs index 2027 -->

<!-- celo: today docs index 2032 -->

<!-- celo: today docs index 2034 -->

<!-- celo: today docs index 2035 -->

<!-- celo: today docs index 2038 -->

<!-- celo: today docs index 2043 -->

<!-- celo: today docs index 2045 -->

<!-- celo: today docs index 2046 -->
