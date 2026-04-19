/**
 * FanShare — Telemetry Export (Demo 1)
 *
 * Dumps every TradeEvent captured by the Helius webhook into a CSV file.
 * Ops uses this post-demo to derive funnel, TTF-trade, spread distribution,
 * hold duration, and realized PnL.
 *
 * Reads:  KV list `trade-events:{cluster}` (written by /api/webhook/helius)
 *         KV list `price-history:{cluster}:{player_id}` (oracle updates — joined in)
 *
 * Writes: telemetry-{cluster}-{YYYY-MM-DD}.csv
 *
 * Run:    bun run scripts/export-telemetry.ts
 *         bun run scripts/export-telemetry.ts --cluster mainnet
 *         bun run scripts/export-telemetry.ts --since 2026-04-18T00:00:00Z
 *
 * Env:    KV_REST_API_URL, KV_REST_API_TOKEN
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env.local") });

// ── Args ───────────────────────────────────────────────────────────────────
function arg(name: string, fallback?: string): string | undefined {
  const ix = process.argv.indexOf(name);
  if (ix >= 0 && ix + 1 < process.argv.length) return process.argv[ix + 1];
  return fallback;
}

const cluster = arg("--cluster", "devnet")!;
const sinceIso = arg("--since");
const sinceTs = sinceIso ? Math.floor(new Date(sinceIso).getTime() / 1000) : 0;

// ── Types ──────────────────────────────────────────────────────────────────
interface TradeRow {
  t: number;
  sig: string;
  player: string;
  trader: string;
  side: "buy" | "sell";
  tokens: number;
  sol: number;
  price_after: number;
  spread: number;
  fee: number;
}

interface PriceTick {
  t: number;
  p: number;
}

// ── KV reader ──────────────────────────────────────────────────────────────
async function kvLRange(key: string): Promise<string[]> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error("KV_REST_API_URL and KV_REST_API_TOKEN must be set in .env.local");
  }
  const res = await fetch(`${url}/lrange/${encodeURIComponent(key)}/0/-1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`KV LRANGE ${key} failed: ${res.status}`);
  const json = await res.json();
  // Upstash returns { result: string[] }
  return json.result ?? [];
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n📊 FanShare Telemetry Export`);
  console.log(`Cluster: ${cluster}`);
  if (sinceTs > 0) console.log(`Since:   ${new Date(sinceTs * 1000).toISOString()}`);

  // 1. Load trade events
  const tradeKey = `trade-events:${cluster}`;
  const rawEvents = await kvLRange(tradeKey);
  console.log(`\nLoaded ${rawEvents.length} trade events from ${tradeKey}`);

  const trades: TradeRow[] = rawEvents
    .map((raw) => {
      try {
        return JSON.parse(raw) as TradeRow;
      } catch {
        return null;
      }
    })
    .filter((t): t is TradeRow => t !== null && t.t >= sinceTs)
    .sort((a, b) => a.t - b.t);

  if (trades.length === 0) {
    console.log(`No trades to export. Exiting.`);
    return;
  }

  // 2. Load oracle price history for each player that appears, for join
  const playerIds = Array.from(new Set(trades.map((t) => t.player)));
  const oracleHistory: Record<string, PriceTick[]> = {};
  for (const pid of playerIds) {
    try {
      const raw = await kvLRange(`price-history:${cluster}:${pid}`);
      const ticks = raw
        .map((r) => {
          try {
            return JSON.parse(r) as PriceTick;
          } catch {
            return null;
          }
        })
        .filter((t): t is PriceTick => t !== null)
        .sort((a, b) => a.t - b.t);
      oracleHistory[pid] = ticks;
    } catch (err) {
      console.warn(`  ⚠ price-history load failed for ${pid}:`, err);
      oracleHistory[pid] = [];
    }
  }

  /**
   * Find the oracle price at or before a trade timestamp.
   * Linear scan is fine — 500 ticks × ~500 trades = 250k ops max.
   */
  function oracleAt(player: string, ts: number): number {
    const ticks = oracleHistory[player] ?? [];
    let match = 0;
    for (const tick of ticks) {
      if (tick.t <= ts) match = tick.p;
      else break;
    }
    return match;
  }

  // 3. Emit CSV
  const header = [
    "timestamp_iso",
    "timestamp_unix",
    "user_wallet",
    "player",
    "side",
    "tokens",
    "sol_amount_lamports",
    "sol_amount",
    "spread_at_execution_bps",
    "market_price_after_lamports",
    "oracle_price_at_execution_lamports",
    "fee_lamports",
    "signature",
  ].join(",");

  const rows = trades.map((t) => {
    const iso = new Date(t.t * 1000).toISOString();
    const solAmount = t.sol / 1_000_000_000;
    const oraclePrice = oracleAt(t.player, t.t);
    // Spread is bps × 100 signed on-chain; convert to plain bps for readability.
    const spreadBps = (t.spread / 100).toFixed(2);
    return [
      iso,
      t.t,
      t.trader,
      t.player,
      t.side,
      t.tokens,
      t.sol,
      solAmount.toFixed(9),
      spreadBps,
      t.price_after,
      oraclePrice,
      t.fee,
      t.sig,
    ].join(",");
  });

  const today = new Date().toISOString().slice(0, 10);
  const outPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    `../telemetry-${cluster}-${today}.csv`,
  );
  fs.writeFileSync(outPath, [header, ...rows].join("\n") + "\n");

  console.log(`\n✅ Wrote ${rows.length} rows to ${outPath}`);
  console.log(`\nQuick summary:`);
  const buys = trades.filter((t) => t.side === "buy").length;
  const sells = trades.filter((t) => t.side === "sell").length;
  const uniqueTraders = new Set(trades.map((t) => t.trader)).size;
  console.log(`  Buys:           ${buys}`);
  console.log(`  Sells:          ${sells}`);
  console.log(`  Unique traders: ${uniqueTraders}`);
  console.log(`  Players traded: ${playerIds.length}`);
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message ?? err);
  process.exit(1);
});
