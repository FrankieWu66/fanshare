/**
 * GET /api/badge/[wallet]
 *
 * Returns the badge tier for a wallet based on qualifying Sharp Calls count.
 *
 * Tiers:
 *   - "sharp"  — 3+ qualifying calls
 *   - "elite"  — 10+ qualifying calls
 *   - "oracle" — 25+ qualifying calls
 *   - null     — not yet earned
 *
 * Response: { wallet, badge: { tier, qualifying_calls } | null }
 */

import { NextRequest, NextResponse } from "next/server";
import { kv } from "@vercel/kv";

interface SharpData {
  total_score: number;
  qualifying_calls: number;
}

type BadgeTier = "sharp" | "elite" | "oracle";

function getBadgeTier(qualifyingCalls: number): BadgeTier | null {
  if (qualifyingCalls >= 25) return "oracle";
  if (qualifyingCalls >= 10) return "elite";
  if (qualifyingCalls >= 3) return "sharp";
  return null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ wallet: string }> }
) {
  const { wallet } = await params;

  // Basic validation: Solana addresses are base58, 32-44 chars
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
    return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  }

  // Graceful fallback when KV is not configured
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return NextResponse.json({ wallet, badge: null }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const sharpData = await kv.get<SharpData>(`sharp:${wallet}`);

    if (!sharpData) {
      return NextResponse.json({ wallet, badge: null }, {
        headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
      });
    }

    const tier = getBadgeTier(sharpData.qualifying_calls);

    return NextResponse.json({
      wallet,
      badge: tier
        ? { tier, qualifying_calls: sharpData.qualifying_calls }
        : null,
    }, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
    });
  } catch (err) {
    console.error(`[badge] KV error for ${wallet}:`, err);
    return NextResponse.json({ wallet, badge: null }, { status: 503 });
  }
}
