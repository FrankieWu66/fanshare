/**
 * GET /api/leaderboard/sharp-calls
 *
 * Returns the top 50 traders ranked by sharp call score.
 * A sharp call = buying when spread_at_buy < 0 (undervalued) AND selling at profit.
 * Score per call = profit_pct * abs(spread_at_buy). Total = sum of all.
 *
 * Response: { leaderboard: [{ rank, wallet, score, qualifying_calls }] }
 *
 * Returns an empty leaderboard when KV is not configured (local dev).
 */

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

interface LeaderboardEntry {
  wallet: string;
  score: number;
  qualifying_calls: number;
}

export async function GET() {
  // Graceful fallback when KV is not configured
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return NextResponse.json({ leaderboard: [] }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const entries: LeaderboardEntry[] = (await kv.get("leaderboard:sharp_calls")) ?? [];

    const leaderboard = entries.map((entry, i) => ({
      rank: i + 1,
      wallet: entry.wallet,
      score: entry.score,
      qualifying_calls: entry.qualifying_calls,
    }));

    return NextResponse.json({ leaderboard }, {
      headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" },
    });
  } catch (err) {
    console.error("[leaderboard/sharp-calls] KV error:", err);
    return NextResponse.json({ leaderboard: [] }, { status: 503 });
  }
}
