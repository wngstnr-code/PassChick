const SESSION_TOKEN_KEY = "chicken_session_token";

export function getSessionToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(SESSION_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setSessionToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    if (token) {
      window.localStorage.setItem(SESSION_TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(SESSION_TOKEN_KEY);
    }
  } catch {
    // localStorage unavailable — token falls back to cookie auth
  }
}

export function clearSessionToken(): void {
  setSessionToken("");
}
