import type { Request, Response, NextFunction } from "express";
import { getSession } from "../services/sessionStore.js";
import cookie from "cookie";

declare global {
  namespace Express {
    interface Request {
      walletAddress?: string;
    }
  }
}

export const SESSION_COOKIE = "chicken_session";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE];

  if (!token) {
    res.status(401).json({ error: "Not authenticated. Please connect your wallet." });
    return;
  }

  const walletAddress = getSession(token);
  if (!walletAddress) {
    res.status(401).json({ error: "Session expired. Please reconnect your wallet." });
    return;
  }

  req.walletAddress = walletAddress;
  next();
}

export function getWalletFromSocketCookies(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;

  const cookies = cookie.parse(cookieHeader);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  return getSession(token);
}
