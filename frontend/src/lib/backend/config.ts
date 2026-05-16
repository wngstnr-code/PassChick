export const BACKEND_API_URL = process.env.NEXT_PUBLIC_BACKEND_API_URL || "";

export function hasBackendApiConfig() {
  return Boolean(BACKEND_API_URL);
}

