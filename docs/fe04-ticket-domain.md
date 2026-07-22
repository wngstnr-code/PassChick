# FE-04 ticket domain handoff

**Status:** frontend domain and query boundary implemented; production integration intentionally fail-closed.

## Delivered

- Shared bigint-first models for ticket balance, daily-claim state, supported payment tokens, purchase quotes, legacy balance, and transaction lifecycle.
- Exact quote math at 20 tickets per digital dollar for both 6-decimal and 18-decimal tokens.
- One `TicketAdapter` interface implemented by both the in-memory mock and injected production adapter.
- React Query hooks for ticket balance, daily-claim status, supported tokens, and legacy GameVault balance.
- Query keys scoped by chain and normalized wallet account, so switching either selects a different cache entry.
- Celo Mainnet and Celo Sepolia configuration slots for `TicketVault`, deployment version, ABI, token metadata, and legacy GameVault.

## Fail-closed production boundary

`TicketVault` is only reported as `ready` when all three inputs are present:

1. a valid address for the active chain;
2. the reviewed ABI supplied by application code;
3. a deployment version supplied through the public environment.

An address alone is not enough. Until sign-off, no contract function name, argument shape, event, revert code, or confirmation policy is assumed by the frontend.

The production adapter accepts a `ProductionTicketDataSource` with these reads:

- `getTicketBalance(scope)`
- `getDailyClaimStatus(scope)`
- `getSupportedPaymentTokens(scope)`
- `getLegacyGameVaultBalance(scope)`
- `quotePurchase(scope, request)`

Backend/viem implementation stays behind that port; presentation components only consume queries and typed results.

## Celo configuration evidence

Mainnet USDC, USDT, USDm, their decimals, and the USDC/USDT fee-currency adapters were checked against the official [Celo token contracts](https://docs.celo.org/tooling/contracts/token-contracts) and [fee abstraction](https://docs.celo.org/build-on-celo/fee-abstraction/using-fee-abstraction) documentation.

The live Celo docs currently disagree about Celo Sepolia USDC and USDm addresses. Consequently:

- Sepolia USDT remains enabled because its address is consistent across the checked official pages.
- Sepolia USDC and USDm are disabled with `configurationStatus: "needs-review"`.
- Neither address should be enabled until the deployment owner verifies the intended token contracts and fee-currency behavior.

## Required sign-off before FE-05

- Verified `TicketVault` ABI, address, chain, and deployment version.
- Whether `TicketShop` is merged into `TicketVault`.
- Exact `claimDaily` and `buyTickets` payloads, events, revert codes, and confirmation rules.
- Backend schemas for authoritative balance and daily-claim status.
- Stablecoin allowance rules and the approved Celo Sepolia token set.
- ERC-8021 app attribution code and verification that the final transaction path preserves the suffix.
