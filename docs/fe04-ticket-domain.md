# FE-04 ticket domain handoff

**Status:** complete; production reads are connected to the signed-off TicketVault deployments.

## Delivered

- Shared bigint-first models for ticket balance, daily-claim state, supported payment tokens, purchase quotes, legacy balance, and transaction lifecycle.
- Exact quote math at 20 tickets per digital dollar for both 6-decimal and 18-decimal tokens.
- One `TicketAdapter` interface implemented by both the in-memory mock and injected production adapter.
- React Query hooks for ticket balance, daily-claim status, supported tokens, and legacy GameVault balance.
- Query keys scoped by chain and normalized wallet account, so switching either selects a different cache entry.
- Celo Mainnet and Celo Sepolia configuration slots for `TicketVault`, deployment version, ABI, token metadata, and legacy GameVault.
- Reviewed `TicketVault` ABI including `claimDaily`, `buyTickets`, read methods, events, and custom errors.
- Concrete `createOnchainTicketDataSource()` implementation for authoritative on-chain ticket balance and legacy GameVault balance reads.
- Signed-off proxy and implementation identifiers for Mainnet and Sepolia, with environment overrides that still fail closed when invalid.

## Production boundary

`TicketVault` is only reported as `ready` when all three inputs are present:

1. a valid address for the active chain;
2. the reviewed ABI supplied by application code;
3. a deployment version supplied through the public environment.

An address alone is not enough. Invalid environment overrides or a missing reviewed ABI still make the deployment unavailable instead of guessing a contract interface.

The production adapter accepts a `ProductionTicketDataSource` with these reads:

- `getTicketBalance(scope)`
- `getDailyClaimStatus(scope)`
- `getSupportedPaymentTokens(scope)`
- `getLegacyGameVaultBalance(scope)`
- `quotePurchase(scope, request)`

The on-chain production source now implements that port. `getDailyClaimStatus` remains an injected backend dependency because streak state, mystery-box output, passport perks, and the signed reward amount are backend policy rather than facts derivable from `TicketVault` alone. Presentation components only consume queries and typed results.

`buyTickets(address token, uint256 usdAmount)` accepts whole US dollars. Quotes therefore reject ticket counts that are not multiples of 20; the previous `$0.05` per-ticket display math was accurate but could produce calldata the contract cannot execute.

## Celo configuration evidence

Mainnet USDC, USDT, USDm, their decimals, and the USDC/USDT fee-currency adapters were checked against the installed Celopedia references sourced from official Celo documentation. PassChick deployment addresses and shop state come from `HANDOFF_V2.md` and the verified contract source.

The contract deployment handoff resolves the shop configuration:

- Mainnet USDC, USDT, and USDm metadata is verified, but all three remain disabled for purchases because `setToken` has not been called.
- Sepolia enables only the PassChick mock USDC at `0x8FB74c2a678811aECC6Ed98Bd5Bc70E1119b7B61`.
- Sepolia USDT and USDm metadata remains available but disabled because neither token is whitelisted in TicketVault.
- The mock USDC is a purchase token, not a Celo fee-currency adapter.

## Sign-off status before FE-05

- Done: verified `TicketVault` ABI, proxy, implementation identifier, and chain mapping.
- Done: `TicketShop` is merged into `TicketVault`.
- Done: exact `claimDaily` and `buyTickets` arguments, events, and contract errors.
- Done: approved shop state and Sepolia mock USDC token.
- Decided: new Celo write paths should use the hostname-derived ERC-8021 attribution suffix; actual on-chain verification belongs to FE-05/FE-06 when those transaction paths exist.
- Pending backend: daily-status/claim endpoint schema and wallet-bound authorization.
- Pending integration policy: final receipt-confirmation count and normalized backend error codes.
