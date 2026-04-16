/**
 * FanShare — Oracle Update Script (4-Pillar Formula)
 *
 * Fetches NBA player stats from balldontlie.io and updates the on-chain
 * StatsOracle for each player. Uses the 4-pillar formula (eng-brief §2).
 *
 * Flow:
 *   1. Load player-mints.json (output of init-players.ts)
 *   2. Fetch basic + advanced NBA stats from balldontlie API
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
  type AdvancedPlayerStats,
  calculatePillarBreakdown,
  usdToLamports,
} from "../app/lib/oracle-weights.js";

// Load .env.local for KV credentials (Next.js convention)
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env.local") });

// ── Constants ──────────────────────────────────────────────────────────────
const PROGRAM_ID = new PublicKey("FLnVTYYPDShw4nmGz6oZKsBHVSdWB1vJxLmcycFo1T7F");

// Anchor discriminator helper: first 8 bytes of sha256("global:<method_name>")
function anchorDiscriminator(methodName: string): Buffer {
  const hash = crypto.createHash("sha256").update(`global:${methodName}`).digest();
  return hash.subarray(0, 8);
}

// update_oracle discriminator from IDL
const UPDATE_ORACLE_DISCRIMINATOR = Buffer.from([112, 41, 209, 18, 248, 226, 252, 188]);

// freeze_market discriminator for inactive player detection
const FREEZE_MARKET_DISCRIMINATOR = anchorDiscriminator("freeze_market");

// Player ID → real NBA player mapping (for balldontlie.io search)
const PLAYER_API_MAP: Record<string, { name: string; team: string }> = {
  Player_LBJ: { name: "LeBron James",           team: "LAL" },
  Player_SC:  { name: "Stephen Curry",           team: "GSW" },
  Player_LD:  { name: "Luka Doncic",             team: "DAL" },
  Player_NJ:  { name: "Nikola Jokic",            team: "DEN" },
  Player_JT:  { name: "Jayson Tatum",            team: "BOS" },
  Player_SGA: { name: "Shai Gilgeous-Alexander", team: "OKC" },
  Player_GA:  { name: "Giannis Antetokounmpo",   team: "MIL" },
  Player_JE:  { name: "Joel Embiid",             team: "PHI" },
  Player_KD:  { name: "Kevin Durant",            team: "PHX" },
  Player_JB:  { name: "Jaylen Brown",            team: "BOS" },
  Player_DB:  { name: "Devin Booker",            team: "PHX" },
  Player_AD:  { name: "Anthony Davis",           team: "LAL" },
  Player_VW:  { name: "Victor Wembanyama",       team: "SAS" },
  Player_CC:  { name: "Cade Cunningham",         team: "DET" },
  Player_TH:  { name: "Tyrese Haliburton",       team: "IND" },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function encodeU64LE(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n);
  return buf;
}

function encodeI64LE(n: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(n);
  return buf;
}

function getStatsOraclePda(mintPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stats-oracle"), mintPubkey.toBuffer()],
    PROGRAM_ID
  );
}

function getMarketStatusPda(mintPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market-status"), mintPubkey.toBuffer()],
    PROGRAM_ID
  );
}

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

// ── Stats Fetching ────────────────────────────────────────────────────────

const API_HEADERS: Record<string, string> = process.env.BALLDONTLIE_API_KEY
  ? { Authorization: process.env.BALLDONTLIE_API_KEY }
  : {};

/**
 * Fetch advanced player stats from balldontlie.io.
 * Uses /v1/season_averages for basic stats (PPG, RPG, APG, SPG, BPG, TOV)
 * and /v1/stats/advanced for advanced (ORTG, DRTG, USG%, TS%, NetRtg).
 * Requires GOAT tier API key for advanced endpoint.
 */
async function fetchPlayerStats(playerName: string): Promise<AdvancedPlayerStats | null> {
  try {
    // 1. Search for player by name
    const searchUrl = `https://api.balldontlie.io/v1/players?search=${encodeURIComponent(playerName)}`;
    const searchRes = await fetch(searchUrl, { headers: API_HEADERS });
    if (!searchRes.ok) {
      console.warn(`  API search failed for ${playerName}: ${searchRes.status}`);
      return null;
    }

    const searchData = await searchRes.json();
    const player = searchData.data?.[0];
    if (!player) {
      console.warn(`  Player not found: ${playerName}`);
      return null;
    }

    // 2. Fetch basic season averages
    const basicUrl = `https://api.balldontlie.io/v1/season_averages?player_ids[]=${player.id}`;
    const basicRes = await fetch(basicUrl, { headers: API_HEADERS });
    if (!basicRes.ok) {
      console.warn(`  Basic stats fetch failed for ${playerName}: ${basicRes.status}`);
      return null;
    }

    const basicData = await basicRes.json();
    const basic = basicData.data?.[0];
    if (!basic) {
      console.warn(`  No season averages for ${playerName}`);
      return null;
    }

    // 3. Fetch advanced stats (GOAT tier required)
    const advancedUrl = `https://api.balldontlie.io/v1/stats/advanced?player_ids[]=${player.id}`;
    const advancedRes = await fetch(advancedUrl, { headers: API_HEADERS });

    let ortg = 113, drtg = 113, usg = 20, ts = 56, netRtg = 0;

    if (advancedRes.ok) {
      const advancedData = await advancedRes.json();
      const adv = advancedData.data?.[0];
      if (adv) {
        ortg = adv.offensive_rating ?? adv.ortg ?? 113;
        drtg = adv.defensive_rating ?? adv.drtg ?? 113;
        usg = adv.usage_pct ?? adv.usg_pct ?? 20;
        netRtg = adv.net_rating ?? adv.net_rtg ?? (ortg - drtg);
        // TS% — use if available, or calculate from components
        ts = adv.true_shooting_pct ?? adv.ts_pct ?? calculateTS(basic);
      }
    } else {
      console.warn(`  Advanced stats unavailable for ${playerName} (${advancedRes.status}) — using defaults`);
      // Calculate TS% from basic stats if available
      ts = calculateTS(basic);
    }

    return {
      ppg: basic.pts ?? 0,
      rpg: basic.reb ?? 0,
      apg: basic.ast ?? 0,
      spg: basic.stl ?? 0,
      bpg: basic.blk ?? 0,
      tov: basic.turnover ?? 0,
      ortg,
      drtg,
      usg,
      ts,
      netRtg,
    };
  } catch (err) {
    console.warn(`  API error for ${playerName}:`, err);
    return null;
  }
}

/** Calculate TS% from basic stats: PTS / (2 × (FGA + 0.44 × FTA)) × 100 */
function calculateTS(basic: Record<string, number>): number {
  const pts = basic.pts ?? 0;
  const fga = basic.fga ?? 0;
  const fta = basic.fta ?? 0;
  if (fga + 0.44 * fta === 0) return 56; // default
  return (pts / (2 * (fga + 0.44 * fta))) * 100;
}

/** Mock advanced stats for all 15 players — reasonable 2024-25 estimates. */
const MOCK_STATS: Record<string, AdvancedPlayerStats> = {
  Player_LD:  { ppg: 33.9, rpg: 9.2,  apg: 9.8,  spg: 1.4, bpg: 0.5, tov: 4.0, ortg: 118, drtg: 112, usg: 37, ts: 58, netRtg: 6 },
  Player_JE:  { ppg: 34.7, rpg: 11.0, apg: 5.6,  spg: 1.2, bpg: 1.7, tov: 3.5, ortg: 120, drtg: 108, usg: 38, ts: 64, netRtg: 12 },
  Player_GA:  { ppg: 30.4, rpg: 11.5, apg: 6.5,  spg: 1.2, bpg: 1.1, tov: 3.4, ortg: 119, drtg: 107, usg: 34, ts: 61, netRtg: 12 },
  Player_NJ:  { ppg: 26.4, rpg: 12.4, apg: 9.0,  spg: 1.4, bpg: 0.9, tov: 3.0, ortg: 126, drtg: 112, usg: 28, ts: 63, netRtg: 12 },
  Player_SGA: { ppg: 30.1, rpg: 5.5,  apg: 6.2,  spg: 2.0, bpg: 0.7, tov: 2.5, ortg: 121, drtg: 109, usg: 32, ts: 63, netRtg: 12 },
  Player_LBJ: { ppg: 25.7, rpg: 7.3,  apg: 8.3,  spg: 1.3, bpg: 0.5, tov: 3.5, ortg: 118, drtg: 111, usg: 30, ts: 60, netRtg: 7 },
  Player_AD:  { ppg: 24.7, rpg: 12.6, apg: 3.5,  spg: 1.2, bpg: 2.3, tov: 2.0, ortg: 116, drtg: 105, usg: 28, ts: 58, netRtg: 11 },
  Player_KD:  { ppg: 27.1, rpg: 6.6,  apg: 5.0,  spg: 0.9, bpg: 1.4, tov: 2.8, ortg: 119, drtg: 111, usg: 31, ts: 62, netRtg: 8 },
  Player_JT:  { ppg: 26.9, rpg: 8.1,  apg: 4.9,  spg: 1.0, bpg: 0.6, tov: 2.7, ortg: 118, drtg: 108, usg: 31, ts: 59, netRtg: 10 },
  Player_DB:  { ppg: 27.1, rpg: 4.5,  apg: 6.9,  spg: 0.9, bpg: 0.3, tov: 3.2, ortg: 116, drtg: 113, usg: 31, ts: 57, netRtg: 3 },
  Player_SC:  { ppg: 26.4, rpg: 4.5,  apg: 6.1,  spg: 0.7, bpg: 0.4, tov: 3.0, ortg: 117, drtg: 113, usg: 30, ts: 61, netRtg: 4 },
  Player_TH:  { ppg: 20.7, rpg: 3.7,  apg: 10.9, spg: 1.2, bpg: 0.7, tov: 2.8, ortg: 117, drtg: 112, usg: 25, ts: 59, netRtg: 5 },
  Player_CC:  { ppg: 22.7, rpg: 4.3,  apg: 7.5,  spg: 0.9, bpg: 0.3, tov: 3.2, ortg: 113, drtg: 115, usg: 29, ts: 55, netRtg: -2 },
  Player_VW:  { ppg: 21.4, rpg: 10.6, apg: 3.9,  spg: 1.2, bpg: 3.6, tov: 3.0, ortg: 115, drtg: 104, usg: 28, ts: 57, netRtg: 11 },
  Player_JB:  { ppg: 23.0, rpg: 5.5,  apg: 3.6,  spg: 1.2, bpg: 0.5, tov: 2.5, ortg: 117, drtg: 109, usg: 29, ts: 58, netRtg: 8 },
};

// ── Update Oracle Instruction ─────────────────────────────────────────────

/**
 * Build the update_oracle instruction with 4-pillar delta attribution.
 * New signature: update_oracle(index_price_lamports, stats_source_date,
 *   delta_scoring, delta_playmaking, delta_defense, delta_winning)
 */
function buildUpdateOracleInstruction(
  authority: PublicKey,
  statsOraclePda: PublicKey,
  indexPriceLamports: bigint,
  statsSourceDate: bigint,
  deltaScoring: bigint,
  deltaPlaymaking: bigint,
  deltaDefense: bigint,
  deltaWinning: bigint,
): TransactionInstruction {
  const data = Buffer.concat([
    UPDATE_ORACLE_DISCRIMINATOR,
    encodeU64LE(indexPriceLamports),
    encodeI64LE(statsSourceDate),
    encodeI64LE(deltaScoring),
    encodeI64LE(deltaPlaymaking),
    encodeI64LE(deltaDefense),
    encodeI64LE(deltaWinning),
  ]);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority,       isSigner: true,  isWritable: false },
      { pubkey: statsOraclePda, isSigner: false, isWritable: true  },
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
  let updated = 0;
  let skipped = 0;

  for (const [playerId, mintAddress] of Object.entries(mints)) {
    const mintPubkey = new PublicKey(mintAddress);
    const [statsOraclePda] = getStatsOraclePda(mintPubkey);

    // Fetch stats (API or mock)
    let stats: AdvancedPlayerStats | null = null;
    if (useMock) {
      stats = MOCK_STATS[playerId] ?? null;
    } else {
      const apiInfo = PLAYER_API_MAP[playerId];
      if (apiInfo) {
        stats = await fetchPlayerStats(apiInfo.name);
      }
      if (!stats) {
        console.log(`  ⚠ API unavailable for ${playerId}, using mock stats`);
        stats = MOCK_STATS[playerId] ?? null;
      }
    }

    if (!stats) {
      console.log(`  ✗ No stats for ${playerId}, skipping`);
      skipped++;
      continue;
    }

    // Calculate 4-pillar breakdown
    const pillars = calculatePillarBreakdown(stats);
    const indexLamports = usdToLamports(pillars.usdPrice);

    // Convert pillar contributions to lamport deltas (for OracleUpdateEvent)
    const scoringLamports = BigInt(Math.round(pillars.scoring * 0.12 / 150 * 1_000_000_000));
    const playmakingLamports = BigInt(Math.round(pillars.playmaking * 0.12 / 150 * 1_000_000_000));
    const defenseLamports = BigInt(Math.round(pillars.defense * 0.12 / 150 * 1_000_000_000));
    const winningLamports = BigInt(Math.round(pillars.winning * 0.12 / 150 * 1_000_000_000));

    console.log(
      `${playerId.padEnd(12)} → $${pillars.usdPrice.toFixed(2)} ` +
      `(S:$${(pillars.scoring * 0.12).toFixed(2)} P:$${(pillars.playmaking * 0.12).toFixed(2)} ` +
      `D:$${(pillars.defense * 0.12).toFixed(2)} W:$${(pillars.winning * 0.12).toFixed(2)}) ` +
      `= ${indexLamports} lamports`
    );

    // Build and send the transaction
    try {
      const ix = buildUpdateOracleInstruction(
        authority.publicKey,
        statsOraclePda,
        indexLamports,
        statsSourceDate,
        scoringLamports,
        playmakingLamports,
        defenseLamports,
        winningLamports,
      );
      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [authority], {
        commitment: "confirmed",
      });
      console.log(`  ✓ Updated (tx: ${sig})`);
      updated++;

      // Write price history to Vercel KV (non-blocking)
      if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        try {
          const entry = JSON.stringify({
            t: Math.floor(Date.now() / 1000),
            p: Number(indexLamports),
            usd: pillars.usdPrice,
            scoring: pillars.scoring * 0.12,
            playmaking: pillars.playmaking * 0.12,
            defense: pillars.defense * 0.12,
            winning: pillars.winning * 0.12,
          });
          const kvUrl = process.env.KV_REST_API_URL;
          const kvToken = process.env.KV_REST_API_TOKEN;
          const rpcUrl = process.env.SOLANA_RPC_URL ?? "";
          const cluster =
            process.env.SOLANA_CLUSTER ??
            (rpcUrl.includes("devnet") ? "devnet" :
             rpcUrl.includes("mainnet") ? "mainnet" :
             rpcUrl.includes("testnet") ? "testnet" : "localnet");
          const key = `price-history:${cluster}:${playerId}`;
          await fetch(`${kvUrl}/rpush/${encodeURIComponent(key)}/${encodeURIComponent(entry)}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${kvToken}` },
          });
          await fetch(`${kvUrl}/ltrim/${encodeURIComponent(key)}/-500/-1`, {
            method: "POST",
            headers: { Authorization: `Bearer ${kvToken}` },
          });
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

  console.log(`\n✅ Oracle update done: ${updated} updated, ${skipped} skipped`);

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
