/**
 * 4-Pillar Oracle Index Price Formula
 * Single source of truth — imported by fanshare-program.ts, scripts/oracle.ts, and cron oracle.
 *
 * Formula (eng-brief §2):
 *   ts_bonus    = clamp(TS% − 56, min=−5, max=+5)
 *   scoring     = PPG × 0.60 + (ORTG − 113) × (USG% / 20) × 0.18 + ts_bonus
 *   playmaking  = APG × 1.20 − TOV × 2.00 + RPG × 1.10
 *   defense     = SPG × 3.00 + BPG × 3.00 + (113 − DRTG) × 0.15
 *   winning     = Net Rating × 1.30
 *   composite   = scoring + playmaking + defense + winning
 *   index_price = max($0.25, composite × 0.12)
 *
 * Devnet SOL conversion: index_price_SOL = index_price_USD / 150
 */

// Fixed devnet reference rate
export const SOL_REFERENCE_RATE = 150; // $150/SOL
export const PRICE_FLOOR_USD = 0.25;
export const MIN_GAMES_PLAYED = 5;

/** Advanced stats required by the 4-pillar formula. */
export interface AdvancedPlayerStats {
  ppg: number;   // Points per game
  rpg: number;   // Rebounds per game
  apg: number;   // Assists per game
  spg: number;   // Steals per game
  bpg: number;   // Blocks per game
  tov: number;   // Turnovers per game
  ortg: number;  // Offensive rating
  drtg: number;  // Defensive rating
  usg: number;   // Usage rate (percentage, e.g. 28.5)
  ts: number;    // True shooting % (percentage, e.g. 63.2)
  netRtg: number; // Net rating (ORTG - DRTG, signed)
}

/** Pillar breakdown in USD — shown on player card and trade page. */
export interface PillarBreakdown {
  scoring: number;
  playmaking: number;
  defense: number;
  winning: number;
  composite: number;
  usdPrice: number;
}

/** Calculate 4-pillar index price from advanced stats. */
export function calculatePillarBreakdown(stats: AdvancedPlayerStats): PillarBreakdown {
  const tsBonus = Math.max(-5, Math.min(5, stats.ts - 56));
  const scoring = stats.ppg * 0.60 + (stats.ortg - 113) * (stats.usg / 20) * 0.18 + tsBonus;
  const playmaking = stats.apg * 1.20 - stats.tov * 2.00 + stats.rpg * 1.10;
  const defense = stats.spg * 3.00 + stats.bpg * 3.00 + (113 - stats.drtg) * 0.15;
  const winning = stats.netRtg * 1.30;
  const composite = scoring + playmaking + defense + winning;
  const usdPrice = Math.max(PRICE_FLOOR_USD, composite * 0.12);

  return { scoring, playmaking, defense, winning, composite, usdPrice };
}

/** Convert USD price to devnet lamports using fixed $150/SOL rate. */
export function usdToLamports(usdPrice: number): bigint {
  const sol = usdPrice / SOL_REFERENCE_RATE;
  return BigInt(Math.round(sol * 1_000_000_000));
}

/** Convert lamports to USD display value. */
export function lamportsToUsd(lamports: bigint): number {
  return Number(lamports) / 1_000_000_000 * SOL_REFERENCE_RATE;
}

/** Format lamports as USD string. Uses more precision below $0.01 so tiny
 *  bonding-curve prices don't collapse to "$0.00" and look broken. */
export function formatUsd(lamports: bigint): string {
  const usd = lamportsToUsd(lamports);
  if (usd === 0) return "$0.00";
  if (usd < 0.0001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

// ── Legacy compatibility: simple 5-stat weights for init-players base_price ──
// Used ONLY for initial bonding curve base_price calculation (not oracle updates).
export const STAT_WEIGHTS = {
  ppg: 1000,
  rpg: 500,
  apg: 700,
  spg: 800,
  bpg: 800,
} as const;

export type StatWeights = typeof STAT_WEIGHTS;
