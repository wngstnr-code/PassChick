import crypto from "node:crypto";

interface SessionData {
  walletAddress: string;
  createdAt: number;
}

const sessions = new Map<string, SessionData>();
const nonces = new Map<string, number>(); 

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function generateNonce(): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  nonces.set(nonce, Date.now());
  return nonce;
}

export function consumeNonce(nonce: string): boolean {
  const timestamp = nonces.get(nonce);
  if (!timestamp) return false;

  nonces.delete(nonce);

  const NONCE_TTL_MS = 5 * 60 * 1000;
  if (Date.now() - timestamp > NONCE_TTL_MS) return false;

  return true;
}

export function createSession(token: string, walletAddress: string): void {
  sessions.set(token, {
    walletAddress,
    createdAt: Date.now(),
  });
}

export function getSession(token: string): string | null {
  const session = sessions.get(token);
  if (!session) return null;

  const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }

  return session.walletAddress;
}

export function deleteSession(token: string): void {
  sessions.delete(token);
}

function cleanupExpired(): void {
  const now = Date.now();
  const NONCE_TTL = 5 * 60 * 1000;
  const SESSION_TTL = 24 * 60 * 60 * 1000;

  for (const [nonce, timestamp] of nonces.entries()) {
    if (now - timestamp > NONCE_TTL) nonces.delete(nonce);
  }

  for (const [token, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_TTL) sessions.delete(token);
  }
}

setInterval(cleanupExpired, 10 * 60 * 1000).unref();
