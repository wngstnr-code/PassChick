const DEFAULT_APP_URL = "https://passchick.xyz";

function normalizeAppUrl(value: string | undefined) {
  const candidate = value?.trim() || DEFAULT_APP_URL;

  try {
    return new URL(candidate).origin;
  } catch {
    return DEFAULT_APP_URL;
  }
}

export const APP_URL = normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
export const APP_NAME = "PASSCHICK";
export const APP_DESCRIPTION =
  'A high-performance, skill-based survival arena on Celo. Verifiable arcade gameplay featuring "Proof of Survival" and real-time on-chain reputation.';
