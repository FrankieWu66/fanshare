/**
 * GET /api/leaderboard/wallet/[address]
 *
 * Returns both leaderboard scores and ranks for a specific wallet.
 *
 * Response:
 *   {
 *     wallet: string,
 *     top_traders: { score, rank } | null,
 *     sharp_calls: { score, rank, qualifying_calls } | null
 *   }
 *
 * Returns nulls for each leaderboard if the wallet has no data.
 * Returns nulls when KV is not configured (local dev).
 */

import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";

interface TraderData {
  sol_spent: number;
  sol_received: number;
  trade_count: number;
}

interface SharpData {
  total_score: number;
  qualifying_calls: number;
}

interface LeaderboardEntry {
  wallet: string;
  score: number;
  trade_count?: number;
  qualifying_calls?: number;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;

  // Basic validation: Solana addresses are base58, 32-44 chars
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  // Graceful fallback when KV is not configured
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return NextResponse.json({
      wallet: address,
      top_traders: null,
      sharp_calls: null,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    // Fetch per-wallet data and leaderboards in parallel
    const [traderData, sharpData, topTradersLb, sharpCallsLb] = await Promise.all([
      kv.get<TraderData>(`trader:${address}`),
      kv.get<SharpData>(`sharp:${address}`),
      kv.get<LeaderboardEntry[]>("leaderboard:top_traders"),
      kv.get<LeaderboardEntry[]>("leaderboard:sharp_calls"),
    ]);

    // Compute top traders rank
    let topTradersResult: { score: number; rank: number } | null = null;
    if (traderData) {
      const score = traderData.sol_received - traderData.sol_spent;
      const lb = topTradersLb ?? [];
      const idx = lb.findIndex((e) => e.wallet === address);
      topTradersResult = { score, rank: idx >= 0 ? idx + 1 : lb.length + 1 };
    }

    // Compute sharp calls rank
    let sharpCallsResult: { score: number; rank: number; qualifying_calls: number } | null = null;
    if (sharpData) {
      const lb = sharpCallsLb ?? [];
      const idx = lb.findIndex((e) => e.wallet === address);
      sharpCallsResult = {
        score: sharpData.total_score,
        rank: idx >= 0 ? idx + 1 : lb.length + 1,
        qualifying_calls: sharpData.qualifying_calls,
      };
    }

    return NextResponse.json({
      wallet: address,
      top_traders: topTradersResult,
      sharp_calls: sharpCallsResult,
    }, {
      headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" },
    });
  } catch (err) {
    console.error(`[leaderboard/wallet] KV error for ${address}:`, err);
    return NextResponse.json({
      wallet: address,
      top_traders: null,
      sharp_calls: null,
    }, { status: 503 });
  }
}
