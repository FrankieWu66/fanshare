/**
 * POST /api/cron/oracle
 *
 * Vercel cron job — runs daily at 06:00 UTC.
 * Fetches live NBA stats from balldontlie.io, computes 4-pillar index price,
 * and calls update_oracle for each player.
 *
 * Env vars required:
 *   ORACLE_SECRET_KEY     — JSON array of bytes from oracle-keypair.json
 *   SOLANA_RPC_URL        — e.g. https://devnet.helius-rpc.com/?api-key=...
 *   SOLANA_CLUSTER        — "devnet" | "mainnet" | "localnet"
 *   KV_REST_API_URL       — Upstash Redis REST URL (for price history)
 *   KV_REST_API_TOKEN     — Upstash Redis token
 *   CRON_SECRET           — Vercel injects this; set in Vercel project settings
 *   BALLDONTLIE_API_KEY   — required for advanced stats (GOAT tier $39.99/mo)
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
import {
  type AdvancedPlayerStats,
  calculatePillarBreakdown,
  usdToLamports,
} from "../../../lib/oracle-weights";

// update_oracle discriminator from fanshare IDL
const UPDATE_ORACLE_DISCRIMINATOR = Buffer.from([112, 41, 209, 18, 248, 226, 252, 188]);
const PROGRAM_ID = new PublicKey("FLnVTYYPDShw4nmGz6oZKsBHVSdWB1vJxLmcycFo1T7F");

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

/** Mock advanced stats — reasonable 2024-25 estimates. */
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

async function fetchPlayerStats(playerName: string): Promise<AdvancedPlayerStats | null> {
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

    // Basic stats
    const basicRes = await fetch(
      `https://api.balldontlie.io/v1/season_averages?player_ids[]=${player.id}`,
      { headers }
    );
    if (!basicRes.ok) return null;
    const basicData = await basicRes.json();
    const basic = basicData.data?.[0];
    if (!basic) return null;

    // Advanced stats (GOAT tier)
    let ortg = 113, drtg = 113, usg = 20, ts = 56, netRtg = 0;
    const advRes = await fetch(
      `https://api.balldontlie.io/v1/stats/advanced?player_ids[]=${player.id}`,
      { headers }
    );
    if (advRes.ok) {
      const advData = await advRes.json();
      const adv = advData.data?.[0];
      if (adv) {
        ortg = adv.offensive_rating ?? adv.ortg ?? 113;
        drtg = adv.defensive_rating ?? adv.drtg ?? 113;
        usg = adv.usage_pct ?? adv.usg_pct ?? 20;
        netRtg = adv.net_rating ?? adv.net_rtg ?? (ortg - drtg);
        ts = adv.true_shooting_pct ?? adv.ts_pct ?? 56;
      }
    }

    return {
      ppg: basic.pts ?? 0, rpg: basic.reb ?? 0, apg: basic.ast ?? 0,
      spg: basic.stl ?? 0, bpg: basic.blk ?? 0, tov: basic.turnover ?? 0,
      ortg, drtg, usg, ts, netRtg,
    };
  } catch {
    return null;
  }
}

async function writeKvPriceHistory(
  playerId: string, indexLamports: bigint, usdPrice: number,
  scoring: number, playmaking: number, defense: number, winning: number,
  cluster: string
) {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return;

  const entry = JSON.stringify({
    t: Math.floor(Date.now() / 1000),
    p: Number(indexLamports),
    usd: usdPrice,
    scoring, playmaking, defense, winning,
  });
  const key = `price-history:${cluster}:${playerId}`;

  await fetch(`${kvUrl}/rpush/${encodeURIComponent(key)}/${encodeURIComponent(entry)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${kvToken}` },
  });
  await fetch(`${kvUrl}/ltrim/${encodeURIComponent(key)}/-500/-1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${kvToken}` },
  });
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const secretKeyEnv = process.env.ORACLE_SECRET_KEY;
  if (!secretKeyEnv) {
    return NextResponse.json({ error: "ORACLE_SECRET_KEY not set" }, { status: 500 });
  }
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    return NextResponse.json({ error: "SOLANA_RPC_URL not set" }, { status: 500 });
  }

  const authority = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(secretKeyEnv) as number[])
  );
  const connection = new Connection(rpcUrl, "confirmed");
  const cluster = (process.env.SOLANA_CLUSTER ?? (rpcUrl.includes("devnet") ? "devnet" : "localnet")).trim();
  const mints = PLAYER_MINTS as Record<string, string>;
  const statsSourceDate = BigInt(Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000));

  const results: Array<{ playerId: string; status: string; usdPrice?: number; tx?: string; error?: string }> = [];

  for (const [playerId, mintAddress] of Object.entries(mints)) {
    const mintPubkey = new PublicKey(mintAddress);
    const [statsOraclePda] = getStatsOraclePda(mintPubkey);

    const playerName = PLAYER_API_MAP[playerId];
    let stats: AdvancedPlayerStats | null = playerName ? await fetchPlayerStats(playerName) : null;
    if (!stats) stats = MOCK_STATS[playerId] ?? null;
    if (!stats) { results.push({ playerId, status: "no_stats" }); continue; }

    const pillars = calculatePillarBreakdown(stats);
    const indexLamports = usdToLamports(pillars.usdPrice);
    const scoringL = BigInt(Math.round(pillars.scoring * 0.12 / 150 * 1e9));
    const playmakingL = BigInt(Math.round(pillars.playmaking * 0.12 / 150 * 1e9));
    const defenseL = BigInt(Math.round(pillars.defense * 0.12 / 150 * 1e9));
    const winningL = BigInt(Math.round(pillars.winning * 0.12 / 150 * 1e9));

    try {
      const data = Buffer.concat([
        UPDATE_ORACLE_DISCRIMINATOR,
        encodeU64LE(indexLamports),
        encodeI64LE(statsSourceDate),
        encodeI64LE(scoringL),
        encodeI64LE(playmakingL),
        encodeI64LE(defenseL),
        encodeI64LE(winningL),
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
      const sig = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });

      await writeKvPriceHistory(
        playerId, indexLamports, pillars.usdPrice,
        pillars.scoring * 0.12, pillars.playmaking * 0.12,
        pillars.defense * 0.12, pillars.winning * 0.12, cluster,
      );

      results.push({ playerId, status: "updated", usdPrice: pillars.usdPrice, tx: sig });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      results.push({ playerId, status: "failed", usdPrice: pillars.usdPrice, error: errMsg.slice(0, 200) });
    }

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
