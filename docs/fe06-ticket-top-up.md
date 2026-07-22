# FE-06 Ticket top-up and legacy withdrawal

## Delivered frontend behavior

- `/managemoney` and the in-game money modal now open on **TOP UP**.
- The frontend reads TicketVault-supported tokens, wallet balances, allowances,
  ticket balance, and legacy GameVault balance from Celo.
- A purchase accepts whole digital dollars only. TicketVault receives that whole
  dollar amount and credits 20 tickets per dollar.
- USDC and USDT use 6 decimals; USDm uses 18 decimals. All conversion and
  comparison logic uses `bigint` rather than floating-point math.
- The default payment token is the enabled token with the largest normalized
  wallet balance.
- Approval is skipped when the current allowance covers the purchase. Otherwise,
  approval confirms before the TicketVault purchase is submitted.
- New Celo writes use legacy transaction fields, a supported stablecoin as the
  fee currency, and a hostname-derived ERC-8021 attribution suffix.
- Insufficient balance leads to MiniPay's official **Deposit** flow.

## Fail-closed network behavior

- Celo Mainnet TicketVault is signed off, but its shop is currently closed. The
  frontend displays the closed state and never asks the wallet for a payment.
- Celo Sepolia currently enables only the deployed PassChick mock USDC. The USDT
  and USDm entries remain visible as unavailable and are never force-enabled by
  the client.

## Legacy withdrawal boundary

The existing backend `/api/vault/withdraw` transaction path is unchanged. Its UI
is mounted only when the authoritative `availableBalanceOf(user)` read is greater
than zero. After a withdrawal the balance is refetched; once it reaches zero, the
WITHDRAW tab disappears. No legacy deposit action is exposed.

## Verification

- Ticket domain/top-up suite: 23 tests passing, 91.98% line coverage overall.
- Daily reward regression suite: 13 tests passing.
- TypeScript: passing.
- ESLint: passing with pre-existing image optimization warnings only.
- Production build: passing.
- Fresh-server browser validation at 360x640: no horizontal overflow; the card,
  primary state, and navigation fit without internal scrolling.
