/**
 * FanShare — Oracle Update Script
 *
 * Fetches NBA player stats from a public API and updates the on-chain
 * StatsOracle for each player. Designed to run as a cron job (every 5 minutes).
 *
 * Flow:
 *   1. Load player-mints.json (output of init-players.ts)
 *   2. Fetch current NBA stats from the API
 *   3. Calculate index price = weighted stat score × price multiplier
 *   4. Call update_oracle for each player whose index has changed
 *
 * Run:     npm run oracle
 * Cron:    every 5 minutes during NBA season
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
import { STAT_WEIGHTS } from "../app/lib/oracle-weights.js";

// Load .env.local for KV credentials (Next.js convention)
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env.local") });

// ── Constants ──────────────────────────────────────────────────────────────
const PROGRAM_ID = new PublicKey("B69juh6rX1Z6WNN2qCkrhuHDnk6v5vrK8oJ2o6oHTVYz");

// Anchor discriminator helper: first 8 bytes of sha256("global:<method_name>")
function anchorDiscriminator(methodName: string): Buffer {
  const hash = crypto.createHash("sha256").update(`global:${methodName}`).digest();
  return hash.subarray(0, 8);
}

// update_oracle discriminator from IDL
const UPDATE_ORACLE_DISCRIMINATOR = Buffer.from([112, 41, 209, 18, 248, 226, 252, 188]);

// freeze_market discriminator for inactive player detection
const FREEZE_MARKET_DISCRIMINATOR = anchorDiscriminator("freeze_market");

// Stat weights — single source of truth in app/lib/oracle-weights.ts
// index = (PPG × 1000 + RPG × 500 + APG × 700 + SPG × 800 + BPG × 800) lamports

// Player ID → real NBA player mapping (for stats API lookup)
// Using abstract IDs until legal review clears real names
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
  // No args — just the discriminator
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

interface PlayerStats {
  ppg: number;
  rpg: number;
  apg: number;
  spg: number;
  bpg: number;
}

/** Calculate index price in lamports from player stats. */
function calculateIndexPrice(stats: PlayerStats): bigint {
  const score =
    stats.ppg * STAT_WEIGHTS.ppg +
    stats.rpg * STAT_WEIGHTS.rpg +
    stats.apg * STAT_WEIGHTS.apg +
    stats.spg * STAT_WEIGHTS.spg +
    stats.bpg * STAT_WEIGHTS.bpg;

  return BigInt(Math.round(score));
}

/**
 * Fetch player stats from balldontlie.io (free, no API key needed for basic use).
 * Falls back to mock data if the API is unavailable.
 */
async function fetchPlayerStats(playerName: string): Promise<PlayerStats | null> {
  try {
    // Search for player by name
    const searchUrl = `https://api.balldontlie.io/v1/players?search=${encodeURIComponent(playerName)}`;
    const searchRes = await fetch(searchUrl, {
      headers: process.env.BALLDONTLIE_API_KEY ? { Authorization: process.env.BALLDONTLIE_API_KEY } : {},
    });

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

    // Fetch season averages
    const statsUrl = `https://api.balldontlie.io/v1/season_averages?player_ids[]=${player.id}`;
    const statsRes = await fetch(statsUrl, {
      headers: process.env.BALLDONTLIE_API_KEY ? { Authorization: process.env.BALLDONTLIE_API_KEY } : {},
    });

    if (!statsRes.ok) {
      console.warn(`  Stats fetch failed for ${playerName}: ${statsRes.status}`);
      return null;
    }

    const statsData = await statsRes.json();
    const avg = statsData.data?.[0];
    if (!avg) {
      console.warn(`  No season averages for ${playerName}`);
      return null;
    }

    return {
      ppg: avg.pts ?? 0,
      rpg: avg.reb ?? 0,
      apg: avg.ast ?? 0,
      spg: avg.stl ?? 0,
      bpg: avg.blk ?? 0,
    };
  } catch (err) {
    console.warn(`  API error for ${playerName}:`, err);
    return null;
  }
}

/** Mock stats for when the API is unavailable (reasonable season averages). */
const MOCK_STATS: Record<string, PlayerStats> = {
  Player_LBJ: { ppg: 25.7, rpg: 7.3, apg: 8.3, spg: 1.3, bpg: 0.5 },
  Player_SC:  { ppg: 26.4, rpg: 4.5, apg: 6.1, spg: 0.7, bpg: 0.4 },
  Player_LD:  { ppg: 33.9, rpg: 9.2, apg: 9.8, spg: 1.4, bpg: 0.5 },
  Player_NJ:  { ppg: 26.4, rpg: 12.4, apg: 9.0, spg: 1.4, bpg: 0.9 },
  Player_JT:  { ppg: 26.9, rpg: 8.1, apg: 4.9, spg: 1.0, bpg: 0.6 },
  Player_SGA: { ppg: 30.1, rpg: 5.5, apg: 6.2, spg: 2.0, bpg: 0.7 },
  Player_GA:  { ppg: 30.4, rpg: 11.5, apg: 6.5, spg: 1.2, bpg: 1.1 },
  Player_JE:  { ppg: 34.7, rpg: 11.0, apg: 5.6, spg: 1.2, bpg: 1.7 },
  Player_KD:  { ppg: 27.1, rpg: 6.6, apg: 5.0, spg: 0.9, bpg: 1.4 },
  Player_JB:  { ppg: 23.0, rpg: 5.5, apg: 3.6, spg: 1.2, bpg: 0.5 },
  Player_DB:  { ppg: 27.1, rpg: 4.5, apg: 6.9, spg: 0.9, bpg: 0.3 },
  Player_AD:  { ppg: 24.7, rpg: 12.6, apg: 3.5, spg: 1.2, bpg: 2.3 },
  Player_VW:  { ppg: 21.4, rpg: 10.6, apg: 3.9, spg: 1.2, bpg: 3.6 },
  Player_CC:  { ppg: 22.7, rpg: 4.3, apg: 7.5, spg: 0.9, bpg: 0.3 },
  Player_TH:  { ppg: 20.7, rpg: 3.7, apg: 10.9, spg: 1.2, bpg: 0.7 },
};

function buildUpdateOracleInstruction(
  authority: PublicKey,
  statsOraclePda: PublicKey,
  indexPriceLamports: bigint
): TransactionInstruction {
  const data = Buffer.concat([
    UPDATE_ORACLE_DISCRIMINATOR,
    encodeU64LE(indexPriceLamports),
    encodeI64LE(BigInt(Math.floor(Date.now() / 1000))),
  ]);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority,       isSigner: true,  isWritable: false }, // authority
      { pubkey: statsOraclePda, isSigner: false, isWritable: true  }, // stats_oracle PDA
    ],
    data,
  });
}

// ── Inactive Player Detection ─────────────────────────────────────────────

/**
 * Check each player for inactivity (0 games in last 30 days).
 * If inactive and market not already frozen, call freeze_market.
 */
async function checkInactivePlayers(
  connection: Connection,
  authority: Keypair,
  mints: Record<string, string>,
): Promise<void> {
  console.log(`\n── Inactive Player Detection ──`);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const startDate = thirtyDaysAgo.toISOString().split("T")[0]; // YYYY-MM-DD
  const endDate = new Date().toISOString().split("T")[0];

  const headers: Record<string, string> = process.env.BALLDONTLIE_API_KEY
    ? { Authorization: process.env.BALLDONTLIE_API_KEY }
    : {};

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
      // 1. Look up player ID from balldontlie
      const searchRes = await fetch(
        `https://api.balldontlie.io/v1/players?search=${encodeURIComponent(apiInfo.name)}`,
        { headers }
      );
      if (!searchRes.ok) {
        console.warn(`  ${playerId}: player search failed (${searchRes.status}) — skipping`);
        skipped++;
        continue;
      }

      const searchData = await searchRes.json();
      const player = searchData.data?.[0];
      if (!player) {
        console.warn(`  ${playerId}: player not found on API — skipping`);
        skipped++;
        continue;
      }

      // 2. Fetch games in the last 30 days
      const gamesUrl =
        `https://api.balldontlie.io/v1/stats?player_ids[]=${player.id}` +
        `&start_date=${startDate}&end_date=${endDate}&per_page=1`;
      const gamesRes = await fetch(gamesUrl, { headers });
      if (!gamesRes.ok) {
        console.warn(`  ${playerId}: games fetch failed (${gamesRes.status}) — skipping`);
        skipped++;
        continue;
      }

      const gamesData = await gamesRes.json();
      const gamesPlayed = gamesData.meta?.total_count ?? gamesData.data?.length ?? 0;

      if (gamesPlayed > 0) {
        // Player is active — nothing to do
        continue;
      }

      // Player has 0 games in last 30 days — check if market already frozen
      const mintPubkey = new PublicKey(mintAddress);
      const [marketStatusPda] = getMarketStatusPda(mintPubkey);
      const marketInfo = await connection.getAccountInfo(marketStatusPda);

      if (!marketInfo) {
        console.warn(`  ${playerId}: no MarketStatus account — skipping freeze`);
        skipped++;
        continue;
      }

      // MarketStatus account layout: 8-byte discriminator, then fields.
      // Check if already frozen by inspecting the account data.
      // The "frozen" flag is a bool stored after the discriminator + other fields.
      // For safety, we attempt the freeze and let the program reject if already frozen.
      console.log(`  ${playerId} inactive for 30+ days (0 games since ${startDate}) — freezing market`);

      try {
        const ix = buildFreezeMarketInstruction(authority.publicKey, marketStatusPda);
        const tx = new Transaction().add(ix);
        const sig = await sendAndConfirmTransaction(connection, tx, [authority], {
          commitment: "confirmed",
        });
        console.log(`  ✓ ${playerId} market frozen (tx: ${sig})`);
        frozen++;
      } catch (freezeErr: unknown) {
        const msg = freezeErr instanceof Error ? freezeErr.message : String(freezeErr);
        // If already frozen, the program will reject — that's fine
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

    // Rate limit kindness
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n  Inactive check done: ${frozen} frozen, ${skipped} skipped`);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const connection = new Connection(
    process.env.SOLANA_RPC_URL || "http://localhost:8899", // localnet default — matches Anchor.toml
    "confirmed"
  );

  // Load authority keypair — ORACLE_KEYPAIR_PATH env var overrides all (useful for localnet
  // where the default wallet is the init authority, not a dedicated oracle signer).
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

  // Load mint addresses from init-players output
  const mintsPath = path.join(__scriptDir, "../app/lib/player-mints.json");
  if (!fs.existsSync(mintsPath)) {
    throw new Error(
      `No player-mints.json found. Run 'npm run init-players' first.`
    );
  }
  const mints: Record<string, string> = JSON.parse(
    fs.readFileSync(mintsPath, "utf-8")
  );

  const useMock = process.argv.includes("--mock");
  console.log(`\n🏀 FanShare Oracle Update`);
  console.log(`Authority: ${authority.publicKey.toString()}`);
  console.log(`Mode:      ${useMock ? "MOCK (hardcoded stats)" : "LIVE (balldontlie.io API)"}`);
  console.log(`Players:   ${Object.keys(mints).length}\n`);

  let updated = 0;
  let skipped = 0;

  for (const [playerId, mintAddress] of Object.entries(mints)) {
    const mintPubkey = new PublicKey(mintAddress);
    const [statsOraclePda] = getStatsOraclePda(mintPubkey);

    // Fetch stats (API or mock)
    let stats: PlayerStats | null = null;
    if (useMock) {
      stats = MOCK_STATS[playerId] ?? null;
    } else {
      const apiInfo = PLAYER_API_MAP[playerId];
      if (apiInfo) {
        stats = await fetchPlayerStats(apiInfo.name);
      }
      // Fall back to mock if API fails
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

    const indexPrice = calculateIndexPrice(stats);
    console.log(
      `${playerId.padEnd(12)} → index: ${indexPrice} lamports ` +
      `(PPG:${stats.ppg} RPG:${stats.rpg} APG:${stats.apg})`
    );

    // Build and send the transaction
    try {
      const ix = buildUpdateOracleInstruction(
        authority.publicKey,
        statsOraclePda,
        indexPrice
      );
      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [authority], {
        commitment: "confirmed",
      });
      console.log(`  ✓ Updated (tx: ${sig})`);
      updated++;

      // Write price history to Vercel KV (non-blocking; skip if KV not configured)
      if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        try {
          const entry = JSON.stringify({ t: Math.floor(Date.now() / 1000), p: Number(indexPrice) });
          const kvUrl = process.env.KV_REST_API_URL;
          const kvToken = process.env.KV_REST_API_TOKEN;
          // Cluster prefix: set SOLANA_CLUSTER env var, or derive from RPC URL
          const rpcUrl = process.env.SOLANA_RPC_URL ?? "";
          const cluster =
            process.env.SOLANA_CLUSTER ??
            (rpcUrl.includes("devnet") ? "devnet" :
             rpcUrl.includes("mainnet") ? "mainnet" :
             rpcUrl.includes("testnet") ? "testnet" : "localnet");
          const key = `price-history:${cluster}:${playerId}`;
          // RPUSH then LTRIM to keep newest 500 entries
          await fetch(`${kvUrl}/rpush/${encodeURIComponent(key)}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${kvToken}`, "Content-Type": "application/json" },
            body: JSON.stringify([entry]),
          });
          await fetch(`${kvUrl}/ltrim/${encodeURIComponent(key)}/-500/-1`, {
            method: "POST",
            headers: { Authorization: `Bearer ${kvToken}` },
          });
          console.log(`  ✓ KV price history recorded`);
        } catch (kvErr) {
          console.warn(`  ⚠ KV write failed (non-fatal):`, kvErr);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Failed: ${msg}`);
      skipped++;
    }

    // Rate limit kindness
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n✅ Oracle update done: ${updated} updated, ${skipped} skipped`);

  // Phase 2-4: check for inactive players and freeze their markets
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
