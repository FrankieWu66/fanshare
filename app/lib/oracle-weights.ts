/**
 * Stat weights for oracle index price calculation.
 * Single source of truth — imported by both fanshare-program.ts and scripts/oracle.ts.
 *
 * index_price = (PPG × 1000 + RPG × 500 + APG × 700 + SPG × 800 + BPG × 800) lamports
 */
export const STAT_WEIGHTS = {
  ppg: 1000, // points per game
  rpg: 500,  // rebounds per game
  apg: 700,  // assists per game
  spg: 800,  // steals per game
  bpg: 800,  // blocks per game
} as const;

export type StatWeights = typeof STAT_WEIGHTS;
