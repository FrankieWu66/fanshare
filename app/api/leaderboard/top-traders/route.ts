/**
 * GET /api/leaderboard/top-traders
 *
 * Returns the top 50 traders ranked by realized PnL (sol_received - sol_spent).
 *
 * Response: { leaderboard: [{ rank, wallet, score, trade_count }] }
 *
 * Returns an empty leaderboard when KV is not configured (local dev).
 */

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

interface LeaderboardEntry {
  wallet: string;
  score: number;
  trade_count: number;
}

export async function GET() {
  // Graceful fallback when KV is not configured
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return NextResponse.json({ leaderboard: [] }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const entries: LeaderboardEntry[] = (await kv.get("leaderboard:top_traders")) ?? [];

    const leaderboard = entries.map((entry, i) => ({
      rank: i + 1,
      wallet: entry.wallet,
      score: entry.score,
      trade_count: entry.trade_count,
    }));

    return NextResponse.json({ leaderboard }, {
      headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" },
    });
  } catch (err) {
    console.error("[leaderboard/top-traders] KV error:", err);
    return NextResponse.json({ leaderboard: [] }, { status: 503 });
  }
}
