/**
 * Leaderboard score formatting.
 * Pure functions — safe to import from server/client/tests.
 */

import { SOL_REFERENCE_RATE } from "./oracle-weights";

export type LeaderboardTab = "top-traders" | "sharp-calls";

/**
 * Format a leaderboard score for display.
 * - top-traders: score is lamports of realized PnL → "+$12.34" or "-$5.67"
 * - sharp-calls: score is a unitless float → "12.3"
 *
 * Important: negative PnL must render with a minus sign. Previous implementation
 * used `sign = usd >= 0 ? "+" : ""` together with `Math.abs(usd)`, which silently
 * hid negative values (QA ISSUE-001, caught 2026-04-16).
 */
export function formatLeaderboardScore(score: number, tab: LeaderboardTab): string {
  if (tab === "top-traders") {
    const usd = (score / 1e9) * SOL_REFERENCE_RATE;
    const sign = usd >= 0 ? "+" : "-";
    return `${sign}$${Math.abs(usd).toFixed(2)}`;
  }
  return score.toFixed(1);
}
