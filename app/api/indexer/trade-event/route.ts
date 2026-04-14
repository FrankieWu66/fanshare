/**
 * POST /api/indexer/trade-event
 *
 * Receives trade event data (from Helius webhook or parser middleware)
 * and updates Vercel KV stores for the leaderboard system.
 *
 * Idempotent: uses tx signature as a dedup key so replayed webhooks
 * don't double-count trades.
 *
 * Updates two leaderboards:
 *   - Top Traders: realized PnL (sol_received - sol_spent)
 *   - Sharp Calls: reward for buying undervalued players and selling at profit
 *
 * Env vars required:
 *   KV_REST_API_URL   — Vercel KV / Upstash Redis
 *   KV_REST_API_TOKEN — read-write token
 *   CRON_SECRET       — Authorization: Bearer <secret>
 *
 * Request body:
 *   { signature, mint, player_id, trader, token_amount, sol_amount,
 *     is_buy, fee_lamports, spread_at_buy }
 */

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

interface TradeEventPayload {
  signature: string;
  mint: string;
  player_id: string;
  trader: string;
  token_amount: number;
  sol_amount: number;
  is_buy: boolean;
  fee_lamports: number;
  spread_at_buy: number;
}

interface TraderData {
  sol_spent: number;
  sol_received: number;
  trade_count: number;
}

interface BuyEntry {
  player_id: string;
  token_amount: number;
  sol_amount: number;
  spread_at_buy: number;
  signature: string;
  matched: boolean;
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

function isValidPayload(body: unknown): body is TradeEventPayload {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.signature === "string" &&
    typeof b.mint === "string" &&
    typeof b.player_id === "string" &&
    typeof b.trader === "string" &&
    typeof b.token_amount === "number" &&
    typeof b.sol_amount === "number" &&
    typeof b.is_buy === "boolean" &&
    typeof b.fee_lamports === "number" &&
    typeof b.spread_at_buy === "number"
  );
}

export async function POST(request: Request) {
  // Auth check
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse and validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isValidPayload(body)) {
    return NextResponse.json(
      { error: "Missing or invalid fields: signature, mint, player_id, trader, token_amount, sol_amount, is_buy, fee_lamports, spread_at_buy" },
      { status: 400 }
    );
  }

  // Graceful fallback when KV is not configured
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    console.warn("[trade-event] KV not configured, skipping");
    return NextResponse.json({ ok: true, skipped: true, reason: "KV not configured" });
  }

  // Idempotency check — skip if we already processed this tx
  const dedupKey = `trade-event:seen:${body.signature}`;
  const alreadySeen = await kv.get(dedupKey);
  if (alreadySeen) {
    return NextResponse.json({ ok: true, duplicate: true, signature: body.signature });
  }

  // Mark as seen (expire after 7 days to avoid unbounded growth)
  await kv.set(dedupKey, 1, { ex: 7 * 24 * 60 * 60 });

  const { trader, sol_amount, is_buy, spread_at_buy, player_id, token_amount, signature } = body;

  // ── Update Top Traders data ──────────────────────────────────
  const traderKey = `trader:${trader}`;
  const existing: TraderData | null = await kv.get(traderKey);
  const traderData: TraderData = existing ?? { sol_spent: 0, sol_received: 0, trade_count: 0 };

  if (is_buy) {
    traderData.sol_spent += sol_amount;
  } else {
    traderData.sol_received += sol_amount;
  }
  traderData.trade_count += 1;

  await kv.set(traderKey, traderData);

  // ── Update Sharp Calls data ──────────────────────────────────
  const buysKey = `sharp:buys:${trader}:${player_id}`;
  const sharpKey = `sharp:${trader}`;

  let sharpUpdated = false;

  if (is_buy) {
    // Record the buy entry for potential future matching
    const buyEntry: BuyEntry = {
      player_id,
      token_amount,
      sol_amount,
      spread_at_buy,
      signature,
      matched: false,
    };
    const existingBuys: BuyEntry[] = (await kv.get(buysKey)) ?? [];
    existingBuys.push(buyEntry);
    await kv.set(buysKey, existingBuys);
  } else {
    // Sell — try to match against oldest unmatched buy (FIFO)
    const existingBuys: BuyEntry[] = (await kv.get(buysKey)) ?? [];
    const unmatchedBuy = existingBuys.find((b) => !b.matched);

    if (unmatchedBuy) {
      unmatchedBuy.matched = true;
      await kv.set(buysKey, existingBuys);

      // Check if this is a qualifying sharp call:
      // bought when undervalued (spread_at_buy < 0) AND sold at profit
      if (unmatchedBuy.spread_at_buy < 0 && sol_amount > unmatchedBuy.sol_amount) {
        const profitPct = (sol_amount - unmatchedBuy.sol_amount) / unmatchedBuy.sol_amount;
        const callScore = profitPct * Math.abs(unmatchedBuy.spread_at_buy);

        const sharpData: SharpData = (await kv.get(sharpKey)) ?? { total_score: 0, qualifying_calls: 0 };
        sharpData.total_score += callScore;
        sharpData.qualifying_calls += 1;
        await kv.set(sharpKey, sharpData);
        sharpUpdated = true;
      }
    }
  }

  // ── Rebuild leaderboards ─────────────────────────────────────
  // Rebuild top traders leaderboard
  await rebuildTopTradersLeaderboard(trader, traderData);

  // Rebuild sharp calls leaderboard if updated
  if (sharpUpdated) {
    const sharpData: SharpData = (await kv.get(sharpKey)) ?? { total_score: 0, qualifying_calls: 0 };
    await rebuildSharpCallsLeaderboard(trader, sharpData);
  }

  return NextResponse.json({
    ok: true,
    signature: body.signature,
    trader,
    is_buy,
    sol_amount,
    sharp_updated: sharpUpdated,
  });
}

/**
 * Updates the sorted top traders leaderboard in KV.
 * Upserts the trader's entry and re-sorts.
 */
async function rebuildTopTradersLeaderboard(wallet: string, data: TraderData) {
  const lbKey = "leaderboard:top_traders";
  const existing: LeaderboardEntry[] = (await kv.get(lbKey)) ?? [];

  const score = data.sol_received - data.sol_spent;
  const idx = existing.findIndex((e) => e.wallet === wallet);

  if (idx >= 0) {
    existing[idx] = { wallet, score, trade_count: data.trade_count };
  } else {
    existing.push({ wallet, score, trade_count: data.trade_count });
  }

  existing.sort((a, b) => b.score - a.score);
  const top50 = existing.slice(0, 50);

  await kv.set(lbKey, top50);
}

/**
 * Updates the sorted sharp calls leaderboard in KV.
 * Upserts the trader's entry and re-sorts.
 */
async function rebuildSharpCallsLeaderboard(wallet: string, data: SharpData) {
  const lbKey = "leaderboard:sharp_calls";
  const existing: LeaderboardEntry[] = (await kv.get(lbKey)) ?? [];

  const idx = existing.findIndex((e) => e.wallet === wallet);

  if (idx >= 0) {
    existing[idx] = { wallet, score: data.total_score, qualifying_calls: data.qualifying_calls };
  } else {
    existing.push({ wallet, score: data.total_score, qualifying_calls: data.qualifying_calls });
  }

  existing.sort((a, b) => b.score - a.score);
  const top50 = existing.slice(0, 50);

  await kv.set(lbKey, top50);
}
