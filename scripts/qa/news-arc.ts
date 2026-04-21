/**
 * Scripted box-score arc for the game-night rehearsal.
 *
 * Mirrors Lakers vs Rockets Game 2 (2026-04-21, 10:30pm ET tip) — LBJ vs KD.
 * Timestamps below are offsets from the LIVE phase start (T+0), not wall clock.
 *
 * Each event triggers:
 *   1. Feed line (news printout the operator sees)
 *   2. `update_oracle` push to devnet — moves the on-chain fair value so the
 *      bonding-curve spread visibly shifts in the UI + APIs bots poll.
 *
 * The pillar deltas we pass are just metadata for OracleUpdateEvent (webhook +
 * PostHog don't use them). The source of price-move is indexPriceLamports
 * (absolute). We read the current on-chain index_price, multiply by
 * (1 + pctDelta), push back.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

import { getStatsOraclePda } from "../../app/lib/shared/pdas";
import { buildUpdateOracleInstruction } from "../../app/lib/shared/oracle-instruction";
import { deserializeStatsOracle } from "../../app/lib/fanshare-program";
import PLAYER_MINTS from "../../app/lib/player-mints.json" with { type: "json" };

export interface NewsEvent {
  /** Seconds after LIVE phase start. */
  atSec: number;
  /** Effects keyed by playerId, value is % delta to apply to index_price. */
  effects: Record<string, number>;
  /** 1-line operator-facing headline (also stored in oracle-updates.csv). */
  headline: string;
}

/**
 * Arc timing in seconds from LIVE phase start. 30 min of live phase.
 * Effects are small (±2–6%) so the curve doesn't blow up across 30 min of
 * compounding updates.
 */
export const GAME_NIGHT_ARC: readonly NewsEvent[] = [
  { atSec:  120, effects: { Player_LBJ: +0.04 }, headline: "LBJ opens Q1 hot — 8 quick points" },
  { atSec:  240, effects: { Player_KD:  +0.05 }, headline: "KD answers with 3 triples" },
  { atSec:  360, effects: { Player_JT:  +0.03 }, headline: "JT cooking in Boston" },
  { atSec:  480, effects: { Player_JE:  -0.02 }, headline: "JE picks up early foul trouble" },
  { atSec:  600, effects: { Player_LBJ: +0.02, Player_KD: -0.01 }, headline: "Lakers lead after Q1" },
  { atSec:  780, effects: { Player_AD:  +0.03 }, headline: "AD crashes the boards" },
  { atSec:  960, effects: { Player_KD:  +0.06, Player_LBJ: -0.02 }, headline: "KD takes over Q2" },
  // T+1200 (20 min) is the halftime checkpoint — orchestrator pauses, no event here.
  { atSec: 1380, effects: { Player_LBJ: +0.05 }, headline: "LBJ aggressive start to Q3" },
  { atSec: 1560, effects: { Player_KD:  -0.02 }, headline: "KD bench rest stretch" },
  { atSec: 1740, effects: { Player_JT:  +0.04 }, headline: "JT game-high scoring night" },
  { atSec: 1860, effects: { Player_LBJ: +0.015, Player_KD: +0.015 }, headline: "Close game in Q4 — volatility" },
  { atSec: 1980, effects: { Player_LBJ: +0.05, Player_KD: -0.03 }, headline: "LBJ game-winner scenario unfolds" },
  { atSec: 2040, effects: {}, headline: "Final buzzer — settlement window" },
] as const;

export interface NewsArcDriver {
  tick(nowSec: number): Promise<NewsEvent[]>;
  /** Latest per-player oracle price (SOL) cached from the most recent push. */
  fairValueSol(playerId: string): number | undefined;
  /** All events fired so far, newest first. */
  history(): NewsArcLogEntry[];
  /** Persist to disk for deliverables. */
  serialize(): NewsArcLogEntry[];
}

export interface NewsArcLogEntry {
  ts: string;
  atSec: number;
  playerId: string;
  pctDelta: number;
  headline: string;
  priceBeforeLamports: string;
  priceAfterLamports: string;
  txSig?: string;
  error?: string;
}

export interface DriverOpts {
  connection: Connection;
  authority: Keypair;
  arc?: readonly NewsEvent[];
  /** Dry-run: don't actually send update_oracle, just update in-memory cache. */
  dryRun?: boolean;
}

export function makeNewsArcDriver(opts: DriverOpts): NewsArcDriver {
  const arc = opts.arc ?? GAME_NIGHT_ARC;
  const fired = new Set<number>();
  const log: NewsArcLogEntry[] = [];
  const cachedPriceSol = new Map<string, number>();

  async function fetchIndexLamports(playerId: string, mint: PublicKey): Promise<bigint> {
    const [pda] = getStatsOraclePda(mint);
    const info = await opts.connection.getAccountInfo(pda);
    if (!info) throw new Error(`stats_oracle not found for ${playerId}`);
    const decoded = deserializeStatsOracle(new Uint8Array(info.data));
    return decoded.indexPriceLamports;
  }

  async function applyEvent(ev: NewsEvent): Promise<NewsArcLogEntry[]> {
    const entries: NewsArcLogEntry[] = [];
    const nowIso = new Date().toISOString();
    const mints = PLAYER_MINTS as Record<string, string>;
    const statsSourceDate = BigInt(Math.floor(new Date().setUTCHours(0, 0, 0, 0) / 1000));

    for (const [playerId, pct] of Object.entries(ev.effects)) {
      const mintStr = mints[playerId];
      if (!mintStr) {
        entries.push({
          ts: nowIso, atSec: ev.atSec, playerId, pctDelta: pct, headline: ev.headline,
          priceBeforeLamports: "0", priceAfterLamports: "0",
          error: "player not in player-mints.json",
        });
        continue;
      }
      const mint = new PublicKey(mintStr);
      try {
        const before = await fetchIndexLamports(playerId, mint);
        const after = scaleBy(before, pct);
        let sig: string | undefined;
        if (!opts.dryRun) {
          const [pda] = getStatsOraclePda(mint);
          const ix = buildUpdateOracleInstruction(
            opts.authority.publicKey,
            pda,
            after,
            statsSourceDate,
            0n, 0n, 0n, 0n,
          );
          const tx = new Transaction().add(ix);
          sig = await sendAndConfirmTransaction(opts.connection, tx, [opts.authority], {
            commitment: "confirmed",
          });
        }
        cachedPriceSol.set(playerId, Number(after) / 1e9);
        entries.push({
          ts: nowIso, atSec: ev.atSec, playerId, pctDelta: pct, headline: ev.headline,
          priceBeforeLamports: before.toString(),
          priceAfterLamports: after.toString(),
          txSig: sig,
        });
      } catch (err) {
        entries.push({
          ts: nowIso, atSec: ev.atSec, playerId, pctDelta: pct, headline: ev.headline,
          priceBeforeLamports: "0", priceAfterLamports: "0",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (Object.keys(ev.effects).length === 0) {
      // Headline with no price effect (e.g., final buzzer) — still log it.
      entries.push({
        ts: nowIso, atSec: ev.atSec, playerId: "", pctDelta: 0,
        headline: ev.headline, priceBeforeLamports: "0", priceAfterLamports: "0",
      });
    }
    return entries;
  }

  return {
    async tick(nowSec: number): Promise<NewsEvent[]> {
      const due = arc.filter((e) => e.atSec <= nowSec && !fired.has(e.atSec));
      const fired_now: NewsEvent[] = [];
      for (const ev of due) {
        fired.add(ev.atSec);
        const entries = await applyEvent(ev);
        log.unshift(...entries);
        fired_now.push(ev);
      }
      return fired_now;
    },
    fairValueSol(playerId) {
      return cachedPriceSol.get(playerId);
    },
    history() {
      return log.slice();
    },
    serialize() {
      return log.slice().reverse();
    },
  };
}

function scaleBy(lamports: bigint, pct: number): bigint {
  // Multiply preserving u64-ish range. Use 1e6 scale for fractional precision.
  const factor = BigInt(Math.round((1 + pct) * 1_000_000));
  return (lamports * factor) / 1_000_000n;
}
