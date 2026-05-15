import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { supabase } from "../config/supabase.js";

const router = Router();

function parsePaginationParam(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

router.get("/stats", requireAuth, async (req, res) => {
  const walletAddress = req.walletAddress!;

  const { data, error } = await supabase
    .from("players")
    .select("*")
    .eq("wallet_address", walletAddress)
    .single();

  if (error || !data) {
    res.json({
      wallet_address: walletAddress,
      total_games: 0,
      total_wins: 0,
      total_losses: 0,
      total_profit: 0,
      created_at: null,
    });
    return;
  }

  res.json(data);
});

router.get("/transactions", requireAuth, async (req, res) => {
  const walletAddress = req.walletAddress!;
  const limit = parsePaginationParam(req.query.limit, 20, 1, 100);
  const offset = parsePaginationParam(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);

  const { data, error, count } = await supabase
    .from("transactions")
    .select("*", { count: "exact" })
    .eq("wallet_address", walletAddress)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("❌ Error fetching transactions:", error);
    res.status(500).json({ error: "Failed to fetch transactions." });
    return;
  }

  res.json({
    transactions: data || [],
    total: count || 0,
    limit,
    offset,
  });
});

export default router;
