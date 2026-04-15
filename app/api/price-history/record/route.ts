/**
 * POST /api/price-history/record
 *
 * Records a price point for a player after a trade.
 * Called by the frontend trade page after each successful buy/sell.
 * No auth required — these are market prices, not secrets.
 *
 * Also forwards trade data to the indexer for leaderboard updates.
 *
 * Request body: {
 *   playerId: string,
 *   price: number (lamports),
 *   cluster?: string,
 *   // Optional trade data for leaderboard indexing:
 *   tradeData?: { signature, mint, player_id, trader, token_amount,
 *                 sol_amount, is_buy, fee_lamports, spread_at_buy }
 * }
 */

import { NextResponse } from "next/server";

const MAX_HISTORY = 500; // Max price points to keep per player

export async function POST(req: Request) {
  let body: {
    playerId?: string;
    price?: number;
    cluster?: string;
    tradeData?: {
      signature: string;
      mint: string;
      player_id: string;
      trader: string;
      token_amount: number;
      sol_amount: number;
      is_buy: boolean;
      fee_lamports: number;
      spread_at_buy: number;
    };
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { playerId, price, cluster = "devnet", tradeData } = body;

  if (!playerId || typeof price !== "number" || price <= 0) {
    return NextResponse.json({ error: "playerId and price (>0) required" }, { status: 400 });
  }

  if (!/^Player_[A-Za-z0-9_]+$/.test(playerId)) {
    return NextResponse.json({ error: "Invalid playerId format" }, { status: 400 });
  }

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return NextResponse.json({ ok: true, skipped: true, reason: "KV not configured" });
  }

  const key = `price-history:${cluster}:${playerId}`;
  const entry = JSON.stringify({ t: Math.floor(Date.now() / 1000), p: price });

  try {
    // RPUSH to append, then LTRIM to keep only the last MAX_HISTORY entries
    const pushRes = await fetch(`${kvUrl}/rpush/${encodeURIComponent(key)}/${encodeURIComponent(entry)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${kvToken}` },
    });

    if (!pushRes.ok) {
      console.error(`[price-history/record] RPUSH failed: ${pushRes.status}`);
      return NextResponse.json({ error: "KV write failed" }, { status: 503 });
    }

    // Trim to last N entries
    await fetch(`${kvUrl}/ltrim/${encodeURIComponent(key)}/-${MAX_HISTORY}/-1`, {
      method: "POST",
      headers: { Authorization: `Bearer ${kvToken}` },
    });
  } catch (err) {
    console.error("[price-history/record] error:", err);
    return NextResponse.json({ error: "KV write failed" }, { status: 503 });
  }

  // ── Forward trade data to indexer for leaderboard ──────────────
  if (tradeData && process.env.CRON_SECRET) {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";

      await fetch(`${baseUrl}/api/indexer/trade-event`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.CRON_SECRET}`,
        },
        body: JSON.stringify(tradeData),
      });
    } catch (err) {
      // Non-fatal — price was recorded, leaderboard update can be retried
      console.warn("[price-history/record] indexer forward failed:", err);
    }
  }

  return NextResponse.json({ ok: true, playerId, price });
}
