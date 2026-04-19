/**
 * Wipe all demo-state KV keys to reset the website to a blank slate.
 *
 * Deletes (cluster-agnostic — hits every cluster variant):
 *   - demo:wallets               (SET of all custodial demo wallet addresses)
 *   - demo:wallet:*              (per-wallet keypair records)
 *   - demo:name:*                (displayName → address lookup)
 *   - price-history:*            (per-player price series, all clusters)
 *   - trade-events:*             (webhook-recorded trade stream, all clusters)
 *   - trade-event:seen:*         (webhook dedupe set)
 *   - trader:*                   (per-wallet stats)
 *   - sharp:*                    (sharp-call scores + buy records)
 *   - leaderboard:top_traders    (sorted set)
 *   - leaderboard:sharp_calls    (sorted set)
 *
 * Run BEFORE on-chain re-init (which creates new mints). Running after still
 * works — the ATAs are recreated fresh — but mint addresses in old
 * price-history records won't match new mints.
 *
 * Usage:
 *   npx tsx scripts/reset-kv.ts --yes        # confirmation required
 *
 * Requires .env.local with KV_REST_API_URL and KV_REST_API_TOKEN.
 */

import * as path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env.local") });

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

if (!KV_URL || !KV_TOKEN) {
  console.error("✗ KV_REST_API_URL and KV_REST_API_TOKEN required in .env.local");
  process.exit(1);
}

if (!process.argv.includes("--yes")) {
  console.error("✗ This wipes ALL demo state from KV. Re-run with --yes to confirm.");
  console.error("  Intended use: before a fresh QA round or before the invite blast.");
  process.exit(1);
}

async function kvFetch(cmd: string[]): Promise<unknown> {
  const res = await fetch(`${KV_URL}/${cmd.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!res.ok) throw new Error(`KV ${cmd[0]} failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { result: unknown };
  return json.result;
}

async function scanKeys(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const result = (await kvFetch(["scan", cursor, "match", pattern, "count", "500"])) as [
      string,
      string[],
    ];
    cursor = result[0];
    keys.push(...result[1]);
  } while (cursor !== "0");
  return [...new Set(keys)]; // SCAN can return duplicates across iterations
}

async function deleteKeys(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  // Upstash DEL accepts many keys in one call — batch in chunks of 100 to keep URL size sane
  let total = 0;
  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100);
    const result = (await kvFetch(["del", ...batch])) as number;
    total += result ?? 0;
  }
  return total;
}

async function wipePattern(label: string, pattern: string): Promise<void> {
  const keys = await scanKeys(pattern);
  const deleted = await deleteKeys(keys);
  console.log(`  ${label.padEnd(22)} pattern=${pattern.padEnd(28)} scanned=${keys.length} deleted=${deleted}`);
}

async function wipeExact(label: string, key: string): Promise<void> {
  const deleted = (await kvFetch(["del", key])) as number;
  console.log(`  ${label.padEnd(22)} key=${key.padEnd(36)} deleted=${deleted}`);
}

async function main() {
  console.log("══════════════════════════════════════════════════════");
  console.log(" KV RESET — wiping all demo state");
  console.log("══════════════════════════════════════════════════════");
  console.log(`  KV URL: ${KV_URL}`);
  console.log();

  console.log("── Demo wallets ──");
  await wipePattern("demo wallet records", "demo:wallet:*");
  await wipePattern("demo name lookups", "demo:name:*");
  await wipeExact("demo wallets index", "demo:wallets");

  console.log("\n── Trading history + price series ──");
  await wipePattern("price history", "price-history:*");
  await wipePattern("trade events stream", "trade-events:*");
  await wipePattern("webhook dedupe", "trade-event:seen:*");

  console.log("\n── Leaderboard + sharp calls ──");
  await wipePattern("trader stats", "trader:*");
  await wipePattern("sharp call scores", "sharp:*");
  await wipeExact("top traders board", "leaderboard:top_traders");
  await wipeExact("sharp calls board", "leaderboard:sharp_calls");

  console.log("\n✅ KV reset complete.");
  console.log("\nNext steps:");
  console.log("  1. Reclaim any remaining SOL:   npm run reclaim-demo");
  console.log("  2. Re-init bonding curves:      rm app/lib/player-mints.json && npm run init-players");
  console.log("  3. Seed fresh oracle:           npm run oracle:mock");
  console.log("  4. Verify spread = 0 on /trade/Player_LBJ");
}

main().catch((e) => {
  console.error("✗ Reset failed:", e);
  process.exit(1);
});
