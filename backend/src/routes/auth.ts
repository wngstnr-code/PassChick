import { type Response, Router } from "express";
import { SiweMessage } from "siwe";
import {
  generateNonce,
  consumeNonce,
  generateSessionToken,
  createSession,
  deleteSession,
} from "../services/sessionStore.js";
import { SESSION_COOKIE, requireAuth } from "../middleware/auth.js";
import { env } from "../config/env.js";
import { supabase } from "../config/supabase.js";
import { isValidEvmAddress, normalizeEvmAddress } from "../utils/celo.js";

const router = Router();

function persistSessionCookie(res: Response) {
  return (token: string) => {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000,
      path: "/",
    });
  };
}

async function ensurePlayerRecord(walletAddress: string) {
  const { error: dbError } = await supabase
    .from("players")
    .upsert({ wallet_address: walletAddress }, { onConflict: "wallet_address" });

  if (dbError) {
    console.error("❌ Supabase Error (player-upsert):", {
      message: dbError.message,
      details: dbError.details,
      hint: dbError.hint,
      code: dbError.code,
    });
  }
}

function createAuthenticatedSession(
  res: Response,
  walletAddress: string,
) {
  const token = generateSessionToken();
  createSession(token, walletAddress);
  persistSessionCookie(res)(token);
}

router.get("/nonce", (_req, res) => {
  const nonce = generateNonce();
  res.json({ nonce });
});

router.post("/verify", async (req, res) => {
  try {
    const { message, signature } = req.body;

    if (!message || !signature) {
      res.status(400).json({ error: "Missing message or signature." });
      return;
    }

    const siweMessage = new SiweMessage(message);
    const result = await siweMessage.verify({ signature });

    if (!result.success) {
      res.status(401).json({ error: "Invalid signature." });
      return;
    }
    if (result.data.chainId !== env.CHAIN_ID) {
      res.status(401).json({ error: `Unsupported chainId. Expected ${env.CHAIN_ID}.` });
      return;
    }

    const nonceValid = consumeNonce(result.data.nonce);
    if (!nonceValid) {
      res.status(401).json({ error: "Invalid or expired nonce." });
      return;
    }

    const walletAddress = normalizeEvmAddress(result.data.address);

    await ensurePlayerRecord(walletAddress);
    createAuthenticatedSession(res, walletAddress);

    res.json({
      success: true,
      address: walletAddress,
      authMethod: "siwe",
    });
  } catch (err) {
    console.error("❌ Auth verify error:", err);
    res.status(500).json({ error: "Authentication failed." });
  }
});

router.post("/social", async (req, res) => {
  try {
    if (!env.SOCIAL_AUTH_ENABLED) {
      res.status(403).json({
        error: "Social auth is disabled on this backend.",
      });
      return;
    }

    const {
      address,
      chainId,
      walletProvider,
    }: {
      address?: string;
      chainId?: number;
      walletProvider?: string;
    } = req.body ?? {};

    if (!address || !isValidEvmAddress(address)) {
      res.status(400).json({ error: "Missing or invalid wallet address." });
      return;
    }

    if (chainId && Number(chainId) !== env.CHAIN_ID) {
      res.status(400).json({ error: `Unsupported chainId. Expected ${env.CHAIN_ID}.` });
      return;
    }

    
    
    const lowerProvider = (walletProvider || "").toLowerCase();
    const isSocialOrEmbedded =
      lowerProvider.includes("reown") ||
      lowerProvider.includes("appkit") ||
      lowerProvider === "google" ||
      lowerProvider === "apple" ||
      lowerProvider === "discord" ||
      lowerProvider === "x";

    if (!isSocialOrEmbedded) {
      
      
      
    }

    const walletAddress = normalizeEvmAddress(address);
    await ensurePlayerRecord(walletAddress);
    createAuthenticatedSession(res, walletAddress);

    res.json({
      success: true,
      address: walletAddress,
      authMethod: "social",
    });
  } catch (err) {
    console.error("❌ Social auth error:", err);
    res.status(500).json({ error: "Social authentication failed." });
  }
});

router.post("/logout", (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    deleteSession(token);
  }

  res.clearCookie(SESSION_COOKIE, {
    path: "/",
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: env.NODE_ENV === "production" ? "none" : "lax",
  });
  res.json({ success: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({
    authenticated: true,
    address: req.walletAddress,
  });
});

export default router;
