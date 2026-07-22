# PassChick V2 — Frontend Roadmap

**Status:** Working plan
**Updated:** 2026-07-22
**Source of truth:** `update_v2.md`

## Objective

Migrate the frontend from a per-match USDC stake flow to a ticket-based seasonal game, while keeping legacy user withdrawals available and preparing the Mini App for MiniPay review.

The frontend must never become the source of truth for ticket balances, reward eligibility, season rank, or wallet authorization. It renders verified backend/on-chain state and submits user-approved transactions.

## Delivery rules

- Ship the work as small, reviewable PRs except for the gameplay bridge cutover, which must change all three stake-dependent layers together.
- Keep the legacy GameVault withdraw integration until every user balance is zero. Do not remove its address, ABI, hook, or transaction path.
- Do not expose a legacy deposit action after the V2 cutover.
- Do not implement contract or API behavior from assumptions. ABI, address, payload, error codes, and state ownership must be agreed first.
- Every user-facing async flow must cover loading, success, empty, rejected-wallet, expired-signature, insufficient-balance, wrong-network, and retry states.
- Primary release viewport is MiniPay at 360×640; standard mobile and desktop browsers remain supported.

## Current frontend map

| Area | Current implementation | V2 direction |
|---|---|---|
| Wallet/MiniPay | `src/features/wallet/WalletProvider.tsx` | Preserve silent MiniPay connect; add an explicit detection state |
| Home/login | `src/features/home/HomePage.tsx` | Replace transient LOGIN CTA with loading UI during MiniPay detection |
| Vault money flow | `src/features/deposit/ManageMoneyPage.tsx` and `useBackendDepositFlow.ts` | Deposit becomes ticket top-up; withdraw remains conditional for legacy balances |
| Game bridge | `src/features/game/components/GameBridgeClient.tsx` | Replace stake/session settlement contract with ticket/session contract |
| Game engine | `public/script.js` | Remove stake, payout, and cash-out money assumptions; emit checkpoint result for points |
| Leaderboard | `public/script.js` and bridge leaderboard API | Render season, division, points, rank, and promotion/degradation state |
| Passport | Home modal and `GameBridgeClient.tsx` | Extend into career passport, badges, history, and verified-human status |
| Metadata | `src/app/layout.tsx`, `src/lib/web3/appKit.ts` | Use `passchick.xyz` consistently |
| Fonts/performance | `src/app/globals.css`, Three.js CDN in `public/script.js` | Self-host font with `next/font`; bundle Three.js through npm |

## Phase 0 — Baseline cleanup

### FE-00 Remove Remotion

**Status:** Done in working tree

- Remove Remotion scripts from `frontend/package.json`.
- Remove `@remotion/cli` and `remotion` dependencies.
- Remove `frontend/src/remotion`.
- Regenerate the npm lockfile.

**Acceptance:** no Remotion reference remains in the frontend dependency graph or source tree; lint and production build pass.

## Phase 1 — MiniPay and listing baseline

These PRs are independent of the V2 contract and can start immediately.

### FE-01 MiniPay connection UX

**Status:** Done in working tree

**Size:** S

- Add a `miniPayDetectionStatus` state such as `detecting | detected | unavailable` to `WalletProvider`.
- While detection/account synchronization is pending, show a skeleton or connecting label instead of LOGIN.
- Preserve `eth_accounts` first and call `eth_requestAccounts` only for MiniPay when required.
- Verify reconnect, rejected permission, account change, and wrong-network behavior.

**Acceptance:** LOGIN never flashes inside MiniPay before auto-connect completes; regular browsers can still connect manually.

### FE-02 Performance and production identity

**Status:** Done in working tree

**Size:** M

- Install and bundle `three`; remove the `https://esm.sh/three` runtime import.
- Replace Google Fonts CSS `@import` with `next/font`.
- Centralize the production app URL and set it to `https://passchick.xyz` in metadata and AppKit.
- Remove stale production comments and audit the 1.5-second vault polling interval.
- Record the remaining external domains for the MiniPay network manifest.

**Acceptance:** no runtime dependency on `esm.sh` or `fonts.googleapis.com`; metadata and wallet UI use the production domain; build passes.

### FE-03 Listing UX and legal copy

**Status:** Done in working tree

**Size:** M

- Update Terms and Privacy from stake-USDC language to ticket, seasonal reward, non-transferability, and verified-human language.
- Audit interactive targets at 360×640 and enforce a minimum 44×44 target.
- Review zoom-lock behavior and document any retained restriction.
- Prepare insufficient-balance entry points for the official MiniPay Add Cash flow.

**Acceptance:** legal copy matches V2; critical flows fit 360×640 without clipped actions; Add Cash behavior has a tested fallback when opened outside MiniPay.

**Implementation note:** the global zoom restriction was removed. Pinch-to-zoom remains available, while `viewport-fit=cover` is retained for MiniPay safe-area support. The Add Cash entry uses MiniPay's official `link.minipay.xyz` URL and opens a new tab with recovery guidance when the app is running outside MiniPay.

## Phase 2 — V2 integration foundation

Start only after the backend and smart-contract interface checklist below is signed off.

### FE-04 Ticket domain layer

**Status:** Complete; signed-off contracts and production read source integrated

**Size:** M

- Create a dedicated ticket domain under `src/features/tickets/`.
- Add shared types for ticket balance, daily claim, supported payment token, purchase quote, and transaction state.
- Add contract address/ABI configuration per supported chain.
- Add query hooks for ticket balance, daily-claim status, supported tokens, and legacy GameVault balance.
- Keep API/contract calls out of presentation components.

**Acceptance:** mock and real adapters expose the same typed interface; chain/account changes invalidate queries; amounts use bigint/token decimals without floating-point math.

**Implementation note:** the injected production adapter and mock adapter share one interface, and all query keys include chain/account scope. The reviewed ABI and verified deployments are configured for Mainnet and Sepolia. Mainnet purchase tokens remain disabled because the shop is closed; Sepolia enables only the deployed PassChick USDC mock. The production source reads authoritative ticket and legacy balances on-chain while daily policy remains behind an injected backend boundary. Purchase quotes enforce the contract's whole-dollar rule.

### Required interface sign-off

- `TicketVault` address, verified ABI, chain IDs, and deployment version.
- ERC-8021 attribution strategy for new Celo transactions (hostname-derived or registered app code), including on-chain verification that relayers preserve the suffix.
- Final decision that `TicketShop` is merged into `TicketVault`, reflected consistently in the V2 specification.
- Exact `claimDaily` and `buyTickets` arguments, events, revert reasons, and confirmation policy.
- Stablecoin whitelist, decimals, allowance behavior, and insufficient-balance handling.
- Authoritative ticket-balance semantics when matches debit tickets off-chain.
- Wallet-bound authorization for starting a match; a bearer session alone is not sufficient.
- API schemas and error codes for daily claim, start session, season, leaderboard, passport, and reward eligibility.

## Phase 3 — Ticket acquisition and balance UX

### FE-05 Daily reward

**Status:** Frontend complete behind fail-closed backend boundary; awaiting live endpoint and device evidence

**Size:** M

- Build the seven-day reward strip, mystery-box states, streak reset copy, next-claim countdown, and passport perk indicator.
- Request a claim payload from the backend, submit the wallet transaction, wait for confirmation, then refetch balance/status.
- Prevent repeat clicks locally while relying on the contract for actual replay protection.

**Acceptance:** confirmed claims update the displayed balance; rejected, expired, already-claimed, and failed transactions recover without a page reload.

**Implementation note:** `/rewards` now provides the seven-day punch card, mystery states, reset guidance, countdown, ticket balance, and backend-authoritative passport perk indicator. Signed payloads are wallet-bound and validated against the TicketVault limits and 600-second TTL before wallet submission. The write uses a legacy Celo transaction, USDm fee abstraction, and a browser-only hostname-derived ERC-8021 suffix; successful receipts invalidate all ticket queries. The flow intentionally remains unavailable until the documented daily status and signed-claim endpoints are deployed. See `docs/fe05-daily-reward.md`.

### FE-06 Ticket top-up and legacy withdraw

**Size:** L

- Rename the primary money mode from DEPOSIT to TOP UP.
- Add USDC, USDT, and cUSD selection with balance display and ticket quote.
- Default to the supported token with the largest usable balance.
- Implement approval/purchase flow and Add Cash for insufficient balance.
- Render WITHDRAW only when `availableBalanceOf(user) > 0`.
- Keep the existing legacy withdraw transaction path unchanged behind the conditional UI.

**Acceptance:** new users never see GameVault concepts; legacy users can always withdraw; withdrawing the final balance removes the tab after refetch; purchase math is correct for 6- and 18-decimal tokens.

## Phase 4 — Gameplay cutover

### FE-07 Replace stake with one-ticket play

**Size:** XL; one coordinated PR/feature branch

Change these layers together:

1. `public/script.js`
   - Remove stake input, USD payout, profit/loss, cash-out settlement, and V1 balance assumptions.
   - Replace the start action with a fixed one-ticket cost.
   - Keep checkpoint progression and return the final checkpoint/result needed by the backend.
2. `src/features/game/components/GameBridgeClient.tsx`
   - Replace `startBet(stake)` with the final V2 start-session contract.
   - Remove on-chain GameSettlement submission and pending-settlement recovery from the V2 path.
   - Refresh ticket balance and season progress after a completed/failed run as defined by the API.
3. `src/features/deposit/ManageMoneyPage.tsx`
   - Ensure the game routes users to TOP UP rather than legacy deposit.

Use a feature flag until backend, contract, and frontend are deployable together.

**Acceptance:** one successful start consumes exactly one authoritative ticket; concurrent/retried starts cannot double-start or double-debit; no V1 deposit or cash-settlement call is made; interrupted sessions recover to a consistent state.

## Phase 5 — Seasonal competition and career identity

### FE-08 Season leaderboard

**Size:** L

- Display active season, countdown, division, points, rank, and last-updated state.
- Replace the cumulative hops ranking with the season leaderboard contract.
- Show promotion/degradation zones, small-division Top 3 rules, passive-player state, and tie-break messaging.
- Handle reset/freeze windows without showing stale ranks as final.

**Acceptance:** rank and movement indicators come from backend-calculated results; the client does not recalculate promotion percentages or tie-breaks.

### FE-09 Trust Passport career UI

**Size:** L

- Separate passport career tier names from division names in copy and visual treatment.
- Show verified-human status, current division, permanent titles, badges, skins, and season history.
- Explain monetary-reward eligibility without blocking ordinary play.
- Provide empty and pending-verification states.

**Acceptance:** passport status is consistent across home, game, profile, and leaderboard; verification data displayed is minimal and privacy-safe.

### FE-10 Season rewards

**Size:** M; blocked until reward policy is final

- Support non-monetary Season 1 rewards first.
- Add monetary claim UI only when funding, verified-human gating, and claim contracts are live.
- Clearly distinguish claimable, claimed, ineligible, pending, and expired states.

**Acceptance:** the frontend never promises an unfunded reward and never treats client-side verification as eligibility proof.

## Phase 6 — Release hardening

### FE-11 Automated coverage

**Size:** L

- Add component tests for amount conversion, conditional withdraw, and async transaction states.
- Add Playwright coverage for MiniPay-like auto-connect, daily claim, top-up, one full match, leaderboard, and legacy withdraw visibility.
- Add regression coverage for 360×640 and one standard mobile viewport.

### FE-12 MiniPay release verification

**Size:** M

- Test Celo Sepolia and Mainnet configurations.
- Test on an Android device inside the real MiniPay container.
- Measure PageSpeed after CDN/font removal.
- Capture sample transaction links for every user-facing contract method.
- Finalize network manifest from actual production traffic.

**Release gate:** lint, production build, automated tests, MiniPay device smoke test, PageSpeed evidence, legal copy, support URL, network manifest, and sample transactions are all complete.

## Recommended PR order

1. FE-00 — Remove Remotion.
2. FE-01 — MiniPay detection/loading state.
3. FE-02 — Three.js, font, metadata, and performance cleanup.
4. FE-03 — Legal, accessibility, and Add Cash entry behavior.
5. FE-04 — Ticket domain types and adapters, after interface sign-off.
6. FE-05 — Daily reward.
7. FE-06 — Top-up and conditional legacy withdraw.
8. FE-07 — Atomic gameplay cutover behind a feature flag.
9. FE-08 — Seasonal leaderboard.
10. FE-09 — Career passport.
11. FE-10 — Season rewards.
12. FE-11/FE-12 — Automated and real-device release verification.

## Immediate next action

FE-05 frontend work is complete and fail-closed while its backend endpoints are unavailable. Next, either deploy and smoke-test the documented FE-05 status/claim contract or begin FE-06 ticket top-up and conditional legacy withdraw without altering the preserved withdrawal path.
