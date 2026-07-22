export const MINIPAY_ADD_CASH_TOKENS = ["CUSD", "USDT", "USDC"] as const;

export type MiniPayAddCashToken = (typeof MINIPAY_ADD_CASH_TOKENS)[number];

export function buildMiniPayAddCashUrl(
  tokens: readonly MiniPayAddCashToken[] = MINIPAY_ADD_CASH_TOKENS,
) {
  const url = new URL("https://link.minipay.xyz/add_cash");

  if (tokens.length > 0) {
    url.searchParams.set("tokens", tokens.join(","));
  }

  return url.toString();
}

export const MINIPAY_ADD_CASH_URL = buildMiniPayAddCashUrl();

export function readMiniPayDepositLinkProps(isMiniPay: boolean) {
  if (isMiniPay) return {};

  return {
    target: "_blank" as const,
    rel: "noreferrer" as const,
  };
}
