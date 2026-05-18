# PassChick

PassChick is a skill-based Web3 arcade game built in the Celo ecosystem.  
It combines wallet login, real-time gameplay, leaderboard progression, Trust Passport verification, and secure on-chain settlement.

## About The Project

This project is designed to deliver a gameplay experience that is:
- fast and fun
- competitive but still fair
- easy for new users to try

PassChick combines casual gameplay with a modern reward system, making it suitable for both everyday gamers and Web3 communities.

## Why PassChick

- Focuses on player skill, not just luck
- Lightweight gameplay that is easy to understand
- Trust Passport verification helps improve fair access and player trust
- Built on a foundation that can grow into community and competitive features

## Demo Video

Click the image below to watch the demo:

[![Watch the demo](https://img.youtube.com/vi/wxIVB1u7iPY/maxresdefault.jpg)](https://youtu.be/wxIVB1u7iPY)

## Live App

Try it here: https://passchick.vercel.app

## MiniPay Production Deployment

PassChick supports [MiniPay](https://www.opera.com/products/minipay) (Opera mobile dApp browser) with auto-connect and cUSD gas fee abstraction.

### Requirements

| Requirement | Detail |
|---|---|
| Backend URL | **HTTPS required.** Opera WebView blocks mixed content; plain `http://` will fail. |
| Cookie settings | Set `NODE_ENV=production` on backend so cookies get `SameSite=None; Secure`. Without this, cross-origin cookies are blocked in WebView. |
| Chain | Celo **mainnet** (chainId 42220). MiniPay does not support testnets. |
| cUSD token address | `0x765DE816845861e75A25fCA122bb6898B8B1282a` — set as `NEXT_PUBLIC_CUSD_TOKEN_ADDRESS` in frontend env. Enables gas payment without CELO balance. |

### Key frontend env vars for MiniPay

```env
NEXT_PUBLIC_CELO_CHAIN_MODE=mainnet
NEXT_PUBLIC_CELO_CHAIN_ID=42220
NEXT_PUBLIC_CELO_RPC_URL=https://forno.celo.org
NEXT_PUBLIC_CELO_EXPLORER_URL=https://celoscan.io
NEXT_PUBLIC_CUSD_TOKEN_ADDRESS=0x765DE816845861e75A25fCA122bb6898B8B1282a
NEXT_PUBLIC_BACKEND_API_URL=https://your-backend.example.com
```

### Testing inside MiniPay

1. Open MiniPay app on Android.
2. Tap **Discover** → paste frontend HTTPS URL or add as custom dApp.
3. Page should auto-connect wallet (no modal shown).
4. Tap **PLAY NOW** — should navigate to `/play` immediately.
5. After a game transaction, verify on [Celoscan](https://celoscan.io) that the tx shows `Fee Currency: cUSD`.

## Status

This project is still in active development.  
Feedback, ideas, and collaboration are very welcome.
