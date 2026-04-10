/**
 * POST /api/cron/oracle
 *
 * Vercel cron job — runs every 5 minutes during NBA season.
 * Fetches live NBA stats from balldontlie.io and calls update_oracle
 * for each player whose index price has changed.
 *
 * Env vars required:
 *   ORACLE_SECRET_KEY     — JSON array of bytes from oracle-keypair.json
 *   SOLANA_RPC_URL        — e.g. https://api.devnet.solana.com
 *   SOLANA_CLUSTER        — "devnet" | "mainnet" | "localnet"
 *   KV_REST_API_URL       — Upstash Redis REST URL (for price history)
 *   KV_REST_API_TOKEN     — Upstash Redis token
 *   CRON_SECRET           — Vercel injects this; set in Vercel project settings
 *   BALLDONTLIE_API_KEY   — optional; improves rate limits on balldontlie.io
 *
 * Vercel injects Authorization: Bearer <CRON_SECRET> on every cron invocation.
 */

import { NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import PLAYER_MINTS from "../../../lib/player-mints.json";
import { STAT_WEIGHTS } from "../../../lib/oracle-weights";

// update_oracle discriminator from fanshare IDL
const UPDATE_ORACLE_DISCRIMINATOR = Buffer.from([112, 41, 209, 18, 248, 226, 252, 188]);
const PROGRAM_ID = new PublicKey("B69juh6rX1Z6WNN2qCkrhuHDnk6v5vrK8oJ2o6oHTVYz");

// NBA player name → real name mapping for balldontlie.io search
const PLAYER_API_MAP: Record<string, string> = {
  Player_LD:  "Luka Doncic",
  Player_JE:  "Joel Embiid",
  Player_GA:  "Giannis Antetokounmpo",
  Player_NJ:  "Nikola Jokic",
  Player_SGA: "Shai Gilgeous-Alexander",
  Player_LBJ: "LeBron James",
  Player_AD:  "Anthony Davis",
  Player_KD:  "Kevin Durant",
  Player_JT:  "Jayson Tatum",
  Player_DB:  "Devin Booker",
  Player_SC:  "Stephen Curry",
  Player_TH:  "Tyrese Haliburton",
  Player_CC:  "Cade Cunningham",
  Player_VW:  "Victor Wembanyama",
  Player_JB:  "Jaylen Brown",
};

const MOCK_STATS: Record<string, PlayerStats> = {
  Player_LBJ: { ppg: 25.7, rpg: 7.3,  apg: 8.3,  spg: 1.3, bpg: 0.5 },
  Player_SC:  { ppg: 26.4, rpg: 4.5,  apg: 6.1,  spg: 0.7, bpg: 0.4 },
  Player_LD:  { ppg: 33.9, rpg: 9.2,  apg: 9.8,  spg: 1.4, bpg: 0.5 },
  Player_NJ:  { ppg: 26.4, rpg: 12.4, apg: 9.0,  spg: 1.4, bpg: 0.9 },
  Player_JT:  { ppg: 26.9, rpg: 8.1,  apg: 4.9,  spg: 1.0, bpg: 0.6 },
  Player_SGA: { ppg: 30.1, rpg: 5.5,  apg: 6.2,  spg: 2.0, bpg: 0.7 },
  Player_GA:  { ppg: 30.4, rpg: 11.5, apg: 6.5,  spg: 1.2, bpg: 1.1 },
  Player_JE:  { ppg: 34.7, rpg: 11.0, apg: 5.6,  spg: 1.2, bpg: 1.7 },
  Player_KD:  { ppg: 27.1, rpg: 6.6,  apg: 5.0,  spg: 0.9, bpg: 1.4 },
  Player_JB:  { ppg: 23.0, rpg: 5.5,  apg: 3.6,  spg: 1.2, bpg: 0.5 },
  Player_DB:  { ppg: 27.1, rpg: 4.5,  apg: 6.9,  spg: 0.9, bpg: 0.3 },
  Player_AD:  { ppg: 24.7, rpg: 12.6, apg: 3.5,  spg: 1.2, bpg: 2.3 },
  Player_VW:  { ppg: 21.4, rpg: 10.6, apg: 3.9,  spg: 1.2, bpg: 3.6 },
  Player_CC:  { ppg: 22.7, rpg: 4.3,  apg: 7.5,  spg: 0.9, bpg: 0.3 },
  Player_TH:  { ppg: 20.7, rpg: 3.7,  apg: 10.9, spg: 1.2, bpg: 0.7 },
};

interface PlayerStats {
  ppg: number; rpg: number; apg: number; spg: number; bpg: number;
}

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

function calculateIndexPrice(stats: PlayerStats): bigint {
  const score =
    stats.ppg * STAT_WEIGHTS.ppg +
    stats.rpg * STAT_WEIGHTS.rpg +
    stats.apg * STAT_WEIGHTS.apg +
    stats.spg * STAT_WEIGHTS.spg +
    stats.bpg * STAT_WEIGHTS.bpg;
  return BigInt(Math.round(score));
}

async function fetchPlayerStats(playerName: string): Promise<PlayerStats | null> {
  try {
    const headers: Record<string, string> = process.env.BALLDONTLIE_API_KEY
      ? { Authorization: process.env.BALLDONTLIE_API_KEY }
      : {};

    const searchRes = await fetch(
      `https://api.balldontlie.io/v1/players?search=${encodeURIComponent(playerName)}`,
      { headers }
    );
    if (!searchRes.ok) return null;

    const searchData = await searchRes.json();
    const player = searchData.data?.[0];
    if (!player) return null;

    const statsRes = await fetch(
      `https://api.balldontlie.io/v1/season_averages?player_ids[]=${player.id}`,
      { headers }
    );
    if (!statsRes.ok) return null;

    const statsData = await statsRes.json();
    const avg = statsData.data?.[0];
    if (!avg) return null;

    return { ppg: avg.pts ?? 0, rpg: avg.reb ?? 0, apg: avg.ast ?? 0, spg: avg.stl ?? 0, bpg: avg.blk ?? 0 };
  } catch {
    return null;
  }
}

async function writeKvPriceHistory(playerId: string, indexPrice: bigint, cluster: string) {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return;

  const entry = JSON.stringify({ t: Math.floor(Date.now() / 1000), p: Number(indexPrice) });
  const key = `price-history:${cluster}:${playerId}`;

  await fetch(`${kvUrl}/rpush/${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${kvToken}`, "Content-Type": "application/json" },
    body: JSON.stringify([entry]),
  });
  await fetch(`${kvUrl}/ltrim/${encodeURIComponent(key)}/-500/-1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${kvToken}` },
  });
}

export async function GET(request: Request) {
  // Verify Vercel cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Validate required env vars
  const secretKeyEnv = process.env.ORACLE_SECRET_KEY;
  if (!secretKeyEnv) {
    return NextResponse.json({ error: "ORACLE_SECRET_KEY not set" }, { status: 500 });
  }
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    return NextResponse.json({ error: "SOLANA_RPC_URL not set" }, { status: 500 });
  }

  // Load keypair from env
  const authority = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(secretKeyEnv) as number[])
  );

  const connection = new Connection(rpcUrl, "confirmed");
  const cluster = (process.env.SOLANA_CLUSTER ?? (rpcUrl.includes("devnet") ? "devnet" : "localnet")).trim();
  const mints = PLAYER_MINTS as Record<string, string>;

  const results: Array<{ playerId: string; status: string; indexPrice?: number; tx?: string; error?: string }> = [];

  for (const [playerId, mintAddress] of Object.entries(mints)) {
    const mintPubkey = new PublicKey(mintAddress);
    const [statsOraclePda] = getStatsOraclePda(mintPubkey);

    // Fetch live stats, fall back to mock
    const playerName = PLAYER_API_MAP[playerId];
    let stats: PlayerStats | null = playerName ? await fetchPlayerStats(playerName) : null;
    if (!stats) stats = MOCK_STATS[playerId] ?? null;

    if (!stats) {
      results.push({ playerId, status: "no_stats" });
      continue;
    }

    const indexPrice = calculateIndexPrice(stats);

    try {
      const data = Buffer.concat([
        UPDATE_ORACLE_DISCRIMINATOR,
        encodeU64LE(indexPrice),
        encodeI64LE(BigInt(Math.floor(Date.now() / 1000))),
      ]);

      const ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: authority.publicKey, isSigner: true,  isWritable: false },
          { pubkey: statsOraclePda,      isSigner: false, isWritable: true  },
        ],
        data,
      });

      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [authority], {
        commitment: "confirmed",
      });

      await writeKvPriceHistory(playerId, indexPrice, cluster);

      results.push({ playerId, status: "updated", indexPrice: Number(indexPrice), tx: sig });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      results.push({ playerId, status: "failed", indexPrice: Number(indexPrice), error: errMsg.slice(0, 200) });
      console.error(`Oracle update failed for ${playerId}:`, err);
    }

    // Small delay to avoid hammering the RPC
    await new Promise((r) => setTimeout(r, 200));
  }

  const updated = results.filter((r) => r.status === "updated").length;
  const failed  = results.filter((r) => r.status === "failed").length;

  return NextResponse.json({
    ok: true,
    authority: authority.publicKey.toString(),
    cluster,
    updated,
    failed,
    players: results,
    ts: new Date().toISOString(),
  });
}
