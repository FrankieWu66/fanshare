/**
 * FanShare — Oracle Update Script (4-Pillar Formula)
 *
 * Fetches NBA player stats from balldontlie.io and updates the on-chain
 * StatsOracle for each player. Uses the 4-pillar formula (eng-brief §2).
 *
 * Flow:
 *   1. Load player-mints.json (output of init-players.ts)
 *   2. Resolve stats via app/lib/shared/stats.ts (live balldontlie or mock)
 *   3. Calculate 4-pillar index price in USD, convert to lamports at $150/SOL
 *   4. Call update_oracle for each player (with pillar deltas for OracleUpdateEvent)
 *
 * Run:     npm run oracle          (live API, requires BALLDONTLIE_API_KEY)
 *          npm run oracle:mock     (hardcoded stats, no API needed)
 * Cron:    daily at 06:00 UTC
 * Wallet:  ~/.config/solana/id.json (same authority used in init-players)
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { fileURLToPath } from "url";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import dotenv from "dotenv";
import {
  calculatePillarBreakdown,
  usdToLamports,
} from "../app/lib/oracle-weights";
import { pushPriceHistoryEntry } from "../app/lib/kv-history";
import { PLAYER_API_MAP, resolveStatsWithContext } from "../app/lib/shared/stats";
import { getMarketStatusPda, getStatsOraclePda, PROGRAM_ID } from "../app/lib/shared/pdas";
import {
  buildUpdateOracleInstruction,
  pillarLamportDeltas,
} from "../app/lib/shared/oracle-instruction";
import {
  applyInjuryPolicy,
  defaultPlayerOracleState,
  loadPlayerStateFromKv,
  savePlayerStateToKv,
  type PlayerOracleState,
} from "../app/lib/shared/injury-policy";

// Load .env.local for KV credentials (Next.js convention)
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env.local") });

// ── Local state store (script fallback when KV is not configured) ─────────

const LOCAL_STATE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.oracle-player-state.json",
);

function loadLocalState(): Record<string, PlayerOracleState> {
  try {
    if (fs.existsSync(LOCAL_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(LOCAL_STATE_PATH, "utf-8")) as Record<string, PlayerOracleState>;
    }
  } catch { /* ignore */ }
  return {};
}

function saveLocalState(state: Record<string, PlayerOracleState>): void {
  try {
    fs.writeFileSync(LOCAL_STATE_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn("  ⚠ Could not write local oracle state file:", err);
  }
}

/**
 * Load player state: try KV first, fall back to local JSON file.
 * In mock mode, always returns a default state (treats all players as full-sample).
 */
async function loadState(cluster: string, playerId: string, useMock: boolean): Promise<PlayerOracleState> {
  if (useMock) return defaultPlayerOracleState();
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (kvUrl && kvToken) {
    return loadPlayerStateFromKv(cluster, playerId);
  }
  const all = loadLocalState();
  return all[`${cluster}:${playerId}`] ?? defaultPlayerOracleState();
}

async function persistState(
  cluster: string, playerId: string, state: PlayerOracleState, useMock: boolean,
): Promise<void> {
  if (useMock) return;
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (kvUrl && kvToken) {
    await savePlayerStateToKv(cluster, playerId, state);
    return;
  }
  const all = loadLocalState();
  all[`${cluster}:${playerId}`] = state;
  saveLocalState(all);
}

// Anchor discriminator helper: first 8 bytes of sha256("global:<method_name>")
function anchorDiscriminator(methodName: string): Buffer {
  const hash = crypto.createHash("sha256").update(`global:${methodName}`).digest();
  return hash.subarray(0, 8);
}

// freeze_market discriminator for inactive player detection
const FREEZE_MARKET_DISCRIMINATOR = anchorDiscriminator("freeze_market");

const API_HEADERS: Record<string, string> = process.env.BALLDONTLIE_API_KEY
  ? { Authorization: process.env.BALLDONTLIE_API_KEY }
  : {};

function buildFreezeMarketInstruction(
  authority: PublicKey,
  marketStatusPda: PublicKey,
): TransactionInstruction {
  const data = Buffer.from(FREEZE_MARKET_DISCRIMINATOR);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority,       isSigner: true,  isWritable: false },
      { pubkey: marketStatusPda, isSigner: false, isWritable: true  },
    ],
    data,
  });
}

// ── Inactive Player Detection ─────────────────────────────────────────────

async function checkInactivePlayers(
  connection: Connection,
  authority: Keypair,
  mints: Record<string, string>,
): Promise<void> {
  console.log(`\n── Inactive Player Detection ──`);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const startDate = thirtyDaysAgo.toISOString().split("T")[0];
  const endDate = new Date().toISOString().split("T")[0];

  let frozen = 0;
  let skipped = 0;

  for (const [playerId, mintAddress] of Object.entries(mints)) {
    const apiInfo = PLAYER_API_MAP[playerId];
    if (!apiInfo) {
      console.log(`  ${playerId}: no API mapping — skipping`);
      skipped++;
      continue;
    }

    try {
      const searchRes = await fetch(
        `https://api.balldontlie.io/v1/players?search=${encodeURIComponent(apiInfo.name)}`,
        { headers: API_HEADERS }
      );
      if (!searchRes.ok) { skipped++; continue; }

      const searchData = await searchRes.json();
      const player = searchData.data?.[0];
      if (!player) { skipped++; continue; }

      const gamesUrl =
        `https://api.balldontlie.io/v1/stats?player_ids[]=${player.id}` +
        `&start_date=${startDate}&end_date=${endDate}&per_page=1`;
      const gamesRes = await fetch(gamesUrl, { headers: API_HEADERS });
      if (!gamesRes.ok) { skipped++; continue; }

      const gamesData = await gamesRes.json();
      const gamesPlayed = gamesData.meta?.total_count ?? gamesData.data?.length ?? 0;

      if (gamesPlayed > 0) continue;

      // Player has 0 games in last 30 days — freeze market
      const mintPubkey = new PublicKey(mintAddress);
      const [marketStatusPda] = getMarketStatusPda(mintPubkey);
      const marketInfo = await connection.getAccountInfo(marketStatusPda);
      if (!marketInfo) { skipped++; continue; }

      console.log(`  ${playerId} inactive for 30+ days — freezing market`);
      try {
        const ix = buildFreezeMarketInstruction(authority.publicKey, marketStatusPda);
        const tx = new Transaction().add(ix);
        const sig = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
        console.log(`  ✓ ${playerId} market frozen (tx: ${sig})`);
        frozen++;
      } catch (freezeErr: unknown) {
        const msg = freezeErr instanceof Error ? freezeErr.message : String(freezeErr);
        if (msg.includes("already") || msg.includes("frozen")) {
          console.log(`  ${playerId}: market already frozen — skipping`);
        } else {
          console.error(`  ✗ ${playerId}: freeze failed — ${msg}`);
        }
        skipped++;
      }
    } catch (err) {
      console.warn(`  ${playerId}: error checking inactivity — skipping`, err);
      skipped++;
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n  Inactive check done: ${frozen} frozen, ${skipped} skipped`);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const connection = new Connection(
    process.env.SOLANA_RPC_URL || "http://localhost:8899",
    "confirmed"
  );

  const __scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const oracleKeypairPath = path.join(__scriptDir, "../oracle-keypair.json");
  const defaultWalletPath = path.join(process.env.HOME!, ".config/solana/id.json");
  const walletPath =
    process.env.ORACLE_KEYPAIR_PATH ??
    (fs.existsSync(oracleKeypairPath) ? oracleKeypairPath : defaultWalletPath);
  if (!fs.existsSync(walletPath)) {
    throw new Error(`No keypair found. Expected oracle-keypair.json or ${defaultWalletPath}`);
  }
  console.log(`Using keypair: ${walletPath}`);
  const walletData: number[] = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  const authority = Keypair.fromSecretKey(new Uint8Array(walletData));

  const mintsPath = path.join(__scriptDir, "../app/lib/player-mints.json");
  if (!fs.existsSync(mintsPath)) {
    throw new Error(`No player-mints.json found. Run 'npm run init-players' first.`);
  }
  const mints: Record<string, string> = JSON.parse(fs.readFileSync(mintsPath, "utf-8"));

  const useMock = process.argv.includes("--mock");
  console.log(`\n🏀 FanShare Oracle Update (4-Pillar Formula)`);
  console.log(`Authority: ${authority.publicKey.toString()}`);
  console.log(`Mode:      ${useMock ? "MOCK (hardcoded stats)" : "LIVE (balldontlie.io API)"}`);
  console.log(`Players:   ${Object.keys(mints).length}\n`);

  const statsSourceDate = BigInt(Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000));
  const rpcUrl = process.env.SOLANA_RPC_URL ?? "";
  const cluster =
    process.env.SOLANA_CLUSTER ??
    (rpcUrl.includes("devnet") ? "devnet" :
     rpcUrl.includes("mainnet") ? "mainnet" :
     rpcUrl.includes("testnet") ? "testnet" : "localnet");

  let updated = 0;
  let frozen = 0;
  let skipped = 0;

  for (const [playerId, mintAddress] of Object.entries(mints)) {
    const mintPubkey = new PublicKey(mintAddress);
    const [statsOraclePda] = getStatsOraclePda(mintPubkey);

    // Load per-player oracle state for injury-policy (Phase C).
    const playerState = await loadState(cluster, playerId, useMock);

    // Resolve stats with context (gamesThisSeason + mostRecentGameDate for policy).
    const ctx = await resolveStatsWithContext(playerId, {
      mock: useMock,
      windowResetAfterDate: playerState.windowResetAfterDate,
    });
    if (!ctx) {
      console.log(`  ✗ No stats for ${playerId}, skipping`);
      skipped++;
      continue;
    }

    // Calculate 4-pillar breakdown
    const pillars = calculatePillarBreakdown(ctx.stats);

    // Apply injury policy (Rules 1–5).
    const policy = applyInjuryPolicy(
      playerId,
      pillars.usdPrice,
      playerState,
      ctx.mostRecentGameDate,
      ctx.gamesThisSeason,
      pillars.usdPrice,
    );

    // Persist updated state.
    await persistState(cluster, playerId, policy.updatedState, useMock);

    // Rule 1/2/4: frozen — skip on-chain update.
    if (policy.freeze) {
      console.log(`${playerId.padEnd(12)} → FROZEN (${policy.reason})`);
      frozen++;
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }

    const finalUsdPrice = policy.finalUsdPrice;
    const indexLamports = usdToLamports(finalUsdPrice);

    // Pillar lamport deltas (for OracleUpdateEvent)
    const deltas = pillarLamportDeltas(pillars);

    console.log(
      `${playerId.padEnd(12)} → $${finalUsdPrice.toFixed(2)} ` +
      `(S:$${(pillars.scoring * 0.12).toFixed(2)} P:$${(pillars.playmaking * 0.12).toFixed(2)} ` +
      `D:$${(pillars.defense * 0.12).toFixed(2)} W:$${(pillars.winning * 0.12).toFixed(2)}) ` +
      `= ${indexLamports} lamports [${policy.reason}]`
    );

    // Build and send the transaction
    try {
      const ix = buildUpdateOracleInstruction(
        authority.publicKey,
        statsOraclePda,
        indexLamports,
        statsSourceDate,
        deltas.scoring,
        deltas.playmaking,
        deltas.defense,
        deltas.winning,
      );
      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [authority], {
        commitment: "confirmed",
      });
      console.log(`  ✓ Updated (tx: ${sig})`);
      updated++;

      // Write price history to Vercel KV (non-blocking, atomic pipeline)
      if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        try {
          const entry = JSON.stringify({
            t: Math.floor(Date.now() / 1000),
            p: Number(indexLamports),
            usd: finalUsdPrice,
            scoring: pillars.scoring * 0.12,
            playmaking: pillars.playmaking * 0.12,
            defense: pillars.defense * 0.12,
            winning: pillars.winning * 0.12,
          });
          const key = `price-history:${cluster}:${playerId}`;
          await pushPriceHistoryEntry(key, entry);
          console.log(`  ✓ KV price history recorded (with pillar breakdown)`);
        } catch (kvErr) {
          console.warn(`  ⚠ KV write failed (non-fatal):`, kvErr);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Failed: ${msg}`);
      skipped++;
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n✅ Oracle update done: ${updated} updated, ${frozen} frozen, ${skipped} skipped`);

  if (!useMock) {
    await checkInactivePlayers(connection, authority, mints);
  } else {
    console.log("\n⚠ Mock mode — skipping inactive player detection");
  }
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message ?? err);
  process.exit(1);
});
