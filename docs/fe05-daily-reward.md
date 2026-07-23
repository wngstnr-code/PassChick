# FE-05 Daily Reward

**Frontend status:** Complete behind a fail-closed backend boundary
**Updated:** 2026-07-22

## Delivered

- `/rewards` seven-day punch card with fixed and mystery reward days.
- Streak reset copy, next-claim countdown, ticket balance, and backend-authoritative passport perk indicator.
- Dashboard entry point and a dedicated 360×640 layout.
- Strict signed-claim validation before the wallet is opened.
- Legacy Celo transaction with USDm `feeCurrency` and hostname-derived ERC-8021 attribution.
- Receipt confirmation followed by ticket balance and daily-status invalidation.
- Recoverable UI states for rejected wallet requests, stale signatures, duplicate claims, backend failure, and reverted transactions.

The frontend does not invent eligibility or rewards. Until the backend endpoints below are deployed, the status query reports an unavailable state and no claim transaction can be produced.

## Backend contract required

### `GET /api/tickets/daily/status`

Query parameters:

- `chainId`: active supported Celo chain ID.
- `account`: normalized connected wallet address.

Response:

```json
{
  "success": true,
  "status": {
    "claimable": true,
    "streakDay": 3,
    "nextClaimAtMs": null,
    "expectedTickets": "7",
    "passportPerkApplied": true,
    "passportBonusTickets": "2"
  }
}
```

`streakDay` must be 1–7. Ticket amounts must be integer strings in the contract range 0–100. Passport fields are optional and must come from the backend's authoritative eligibility calculation.

### `POST /api/tickets/daily/claim`

Request:

```json
{
  "chainId": 42220,
  "account": "0x..."
}
```

Response:

```json
{
  "success": true,
  "claim": {
    "user": "0x...",
    "dayIndex": 19675,
    "amount": 7,
    "issuedAt": 1700000000,
    "nonce": "42"
  },
  "signature": "0x..."
}
```

The signature must use the reviewed TicketVault EIP-712 domain and exact `DailyClaim(address user,uint32 dayIndex,uint16 amount,uint64 issuedAt,uint256 nonce)` struct. The frontend requires the user to match the connected wallet, amount to be 1–100, nonce to fit `uint256`, and the signature to remain inside the 600-second contract TTL.

## Transaction policy

- `claimDaily(claim, signature)` is encoded locally from the reviewed ABI.
- Mainnet TicketVault: `0x8a1bd73ddfb4e06779d9c578a6447ae9b48199d5`.
- Sepolia TicketVault: `0x1490e6b836f552e8504fe6404c30953b15f899c8`.
- Transactions remain legacy Celo transactions; EIP-1559 fee fields are not sent.
- The hostname-derived ERC-8021 suffix is appended after contract calldata in the browser.
- The UI says “Network fee” and does not expose CELO as a user-facing balance or payment requirement.

## Verification

- Daily reward tests: 13 passing.
- Coverage: 86.87% lines across the exercised dependency graph.
- TypeScript: passing.
- ESLint: 0 errors; 9 pre-existing image optimization warnings.
- Next.js production build: passing; `/rewards` is statically generated.
- Viewport metrics at 360×640: document width 360 px, reward shell width 344 px, no horizontal overflow, and the page owns vertical scrolling.

## Remaining integration evidence

- Deploy both backend endpoints with the schema above.
- Confirm one Sepolia claim using a real backend signature and capture the transaction link.
- Verify the ERC-8021 suffix survives wallet submission and any production relayer path.
- Repeat the claim on an Android device inside MiniPay.
