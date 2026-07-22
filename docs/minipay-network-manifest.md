# PassChick MiniPay Network Manifest

**Status:** Draft — finalize from production traffic before submission
**Updated:** 2026-07-22

## Runtime connections

| Host/source | Protocol | Purpose | Configuration |
|---|---|---|---|
| `passchick.xyz` | HTTPS | Mini App, static assets, Next.js chunks | `NEXT_PUBLIC_APP_URL` |
| Backend production host | HTTPS, WSS | REST API, authentication, game session, Socket.IO | `NEXT_PUBLIC_BACKEND_API_URL` |
| `forno.celo.org` | HTTPS JSON-RPC | Celo Mainnet reads and transaction RPC | `NEXT_PUBLIC_CELO_RPC_URL` |
| Reown/WalletConnect hosts | HTTPS, WSS | External-wallet discovery and relay outside MiniPay | Derived from `NEXT_PUBLIC_REOWN_PROJECT_ID`; capture exact hosts from production traffic |

The current frontend README uses `passchick-production-6251.up.railway.app` as the backend example. Confirm the deployed production origin instead of copying this value blindly into the submission.

## User-initiated navigation

| Host | Purpose |
|---|---|
| `passchick.gitbook.io` | Documentation link |
| `t.me` | PassChick support channel |
| `celoscan.io` | Transaction explorer links |
| `link.minipay.xyz` | Official MiniPay Deposit flow for USDC, USDT, and USDm (cUSD) |

These links navigate away from the app and are not required to render the main game UI.

## Removed external resources

- `esm.sh` — removed; Three.js is now loaded from the npm dependency graph and emitted as a local Next.js chunk.
- `fonts.googleapis.com` — removed; Press Start 2P is loaded through `next/font`, while Reown AppKit uses a configured system font. The nested legacy AppKit dependency was deduplicated to prevent its unconditional Google Fonts import.

## Submission verification

Before MiniPay submission:

1. Open the production build inside the real MiniPay container.
2. Capture all requests during auto-connect, daily claim, top-up, a complete match, leaderboard load, and reward claim.
3. Record redirect hosts as well as final hosts.
4. Replace the configurable rows above with the actual production domains.
5. Confirm no request is made to `esm.sh` or `fonts.googleapis.com`.
