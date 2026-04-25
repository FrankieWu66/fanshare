/**
 * POST /api/cron/oracle
 *
 * Vercel cron job — runs daily at 06:00 UTC.
 * Fetches live NBA stats from balldontlie.io via the shared stats resolver,
 * computes 4-pillar index price, and calls update_oracle for each player.
 *
 * Shares stats/PDA/instruction helpers with scripts/oracle.ts and
 * scripts/init-players.ts so the three never drift.
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
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import PLAYER_MINTS from "@/app/lib/player-mints.json";
import {
  calculatePillarBreakdown,
  usdToLamports,
} from "@/app/lib/oracle-weights";
import { pushPriceHistoryEntry } from "@/app/lib/kv-history";
import { resolveStatsWithContext } from "@/app/lib/shared/stats";
import { getStatsOraclePda } from "@/app/lib/shared/pdas";
import {
  buildUpdateOracleInstruction,
  pillarLamportDeltas,
} from "@/app/lib/shared/oracle-instruction";
import {
  applyInjuryPolicy,
  loadPlayerStateFromKv,
  savePlayerStateToKv,
} from "@/app/lib/shared/injury-policy";

async function writeKvPriceHistory(
  playerId: string, indexLamports: bigint, usdPrice: number,
  scoring: number, playmaking: number, defense: number, winning: number,
  cluster: string
) {
  const entry = JSON.stringify({
    t: Math.floor(Date.now() / 1000),
    p: Number(indexLamports),
    usd: usdPrice,
    scoring, playmaking, defense, winning,
  });
  const key = `price-history:${cluster}:${playerId}`;
  await pushPriceHistoryEntry(key, entry);
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

  const results: Array<{ playerId: string; status: string; usdPrice?: number; tx?: string; error?: string; policyReason?: string }> = [];

  for (const [playerId, mintAddress] of Object.entries(mints)) {
    const mintPubkey = new PublicKey(mintAddress);
    const [statsOraclePda] = getStatsOraclePda(mintPubkey);

    // Load per-player oracle state for injury-policy (Phase C).
    const playerState = await loadPlayerStateFromKv(cluster, playerId);

    // Vercel cron always runs live mode. resolveStatsWithContext falls back to mock
    // (DEVNET_PLAYERS.stats) automatically if balldontlie fails.
    // Pass windowResetAfterDate so Rule 5 filtering applies to the rolling window.
    const ctx = await resolveStatsWithContext(playerId, {
      mock: false,
      windowResetAfterDate: playerState.windowResetAfterDate,
    });
    if (!ctx) { results.push({ playerId, status: "no_stats" }); continue; }

    const pillars = calculatePillarBreakdown(ctx.stats);

    // Apply injury policy (Rules 1–5).
    // lastOracleUsd is the formula output before policy caps; used as the
    // freeze passthrough value when the player didn't play today.
    const policy = applyInjuryPolicy(
      playerId,
      pillars.usdPrice,
      playerState,
      ctx.mostRecentGameDate,
      ctx.gamesThisSeason,
      pillars.usdPrice, // lastOracleUsd — formula output is the baseline
    );

    // Persist updated state regardless of freeze/update outcome.
    await savePlayerStateToKv(cluster, playerId, policy.updatedState);

    // Rule 1/2/4: frozen — skip on-chain update, hold last value.
    if (policy.freeze) {
      results.push({ playerId, status: "frozen", policyReason: policy.reason });
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }

    // Apply post-formula caps (Rule 3 short-sample) from policy result.
    const finalUsdPrice = policy.finalUsdPrice;
    const indexLamports = usdToLamports(finalUsdPrice);
    const deltas = pillarLamportDeltas(pillars);

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
      const sig = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });

      await writeKvPriceHistory(
        playerId, indexLamports, finalUsdPrice,
        pillars.scoring * 0.12, pillars.playmaking * 0.12,
        pillars.defense * 0.12, pillars.winning * 0.12, cluster,
      );

      results.push({ playerId, status: "updated", usdPrice: finalUsdPrice, tx: sig, policyReason: policy.reason });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      results.push({ playerId, status: "failed", usdPrice: finalUsdPrice, error: errMsg.slice(0, 200) });
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
