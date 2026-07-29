import type { Eip1193Provider } from "~/lib/web3/celo";

type BackendAuthRoute =
  | { method: "minipay" }
  | { method: "social"; walletProvider: string }
  | { method: "siwe" };

type SelectBackendAuthRouteInput = {
  isMiniPay: boolean;
  embeddedAuthProvider?: string;
  walletProviderName?: string;
};

type BuildSiweMessageInput = {
  address: string;
  chainId: number;
  nonce: string;
  origin: string;
  issuedAt?: string;
};

type BackendAuthRecoveryInput = {
  isAuthenticated: boolean;
  isLoading: boolean;
  error?: string;
};

export type BackendAuthRecoveryMode = "none" | "waiting" | "manual";

export function getBackendAuthRecoveryCopy() {
  return {
    message: "COULDN'T LOAD GAME DATA",
    actionLabel: "TRY AGAIN",
  } as const;
}

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const SIWE_NONCE_PATTERN = /^[a-zA-Z0-9]{8,}$/;
const BACKEND_SOCIAL_PROVIDERS = new Set(["google", "apple", "discord", "x"]);

export function createSingleFlight<T>() {
  let inFlight: Promise<T> | null = null;

  return (task: () => Promise<T>) => {
    if (inFlight) {
      return inFlight;
    }

    const current = task();
    inFlight = current;
    void current.then(
      () => {
        if (inFlight === current) {
          inFlight = null;
        }
      },
      () => {
        if (inFlight === current) {
          inFlight = null;
        }
      },
    );
    return current;
  };
}

export function getBackendAuthRecoveryMode({
  isAuthenticated,
  isLoading,
  error,
}: BackendAuthRecoveryInput): BackendAuthRecoveryMode {
  if (isAuthenticated) return "none";
  if (isLoading || !String(error || "").trim()) return "waiting";
  return "manual";
}

export function selectBackendAuthRoute({
  isMiniPay,
  embeddedAuthProvider,
}: SelectBackendAuthRouteInput): BackendAuthRoute {
  if (isMiniPay) {
    return { method: "minipay" };
  }

  const normalizedEmbeddedProvider = String(embeddedAuthProvider || "")
    .trim()
    .toLowerCase();
  if (normalizedEmbeddedProvider) {
    return {
      method: "social",
      walletProvider: BACKEND_SOCIAL_PROVIDERS.has(normalizedEmbeddedProvider)
        ? normalizedEmbeddedProvider
        : "appkit",
    };
  }

  // Wallet labels are deliberately ignored here. Only AppKit's explicit
  // embeddedWalletInfo signal may enter the trust-on-claim social endpoint.
  return { method: "siwe" };
}

export function buildSiweMessage({
  address,
  chainId,
  nonce,
  origin,
  issuedAt = new Date().toISOString(),
}: BuildSiweMessageInput) {
  const normalizedAddress = String(address || "").trim();
  if (!EVM_ADDRESS_PATTERN.test(normalizedAddress)) {
    throw new Error("A valid wallet address is required for SIWE.");
  }
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("A valid chain ID is required for SIWE.");
  }
  if (!SIWE_NONCE_PATTERN.test(String(nonce || ""))) {
    throw new Error("A valid SIWE nonce is required.");
  }

  let appOrigin: URL;
  try {
    appOrigin = new URL(origin);
  } catch {
    throw new Error("A valid application origin is required for SIWE.");
  }
  if (appOrigin.protocol !== "https:" && appOrigin.protocol !== "http:") {
    throw new Error("A valid HTTP application origin is required for SIWE.");
  }

  const issuedAtDate = new Date(issuedAt);
  if (Number.isNaN(issuedAtDate.valueOf())) {
    throw new Error("A valid issued-at timestamp is required for SIWE.");
  }

  return [
    `${appOrigin.host} wants you to sign in with your Ethereum account:`,
    normalizedAddress,
    "",
    "Sign in to Pass Chick.",
    "",
    `URI: ${appOrigin.origin}`,
    "Version: 1",
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAtDate.toISOString()}`,
  ].join("\n");
}

export async function signSiweMessage(
  provider: Eip1193Provider,
  message: string,
  address: string,
) {
  const signature = await provider.request<string>({
    method: "personal_sign",
    params: [message, address],
  });
  const normalizedSignature = String(signature || "").trim();
  if (!normalizedSignature) {
    throw new Error("Wallet did not return a SIWE signature.");
  }
  return normalizedSignature;
}
