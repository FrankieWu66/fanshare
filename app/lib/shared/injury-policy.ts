/**
 * Injury-player oracle policy — Phase C implementation.
 *
 * Implements all 5 rules from basketball/specs/injury-player-policy.md.
 * All policy state is stored in Vercel KV (or a local JSON file when running
 * as a script). Oracle update callers load state, apply rules, then persist
 * the updated state after each player update cycle.
 *
 * Rules summary:
 *   Rule 1 — Mid-season injury (1–3 weeks): freeze oracle at last computed value.
 *   Rule 2 — Season-ending injury: same freeze, hold all season.
 *   Rule 3 — Short-sample rookies: 0–4 games → floor; 5–14 games → cap $3.00.
 *   Rule 4 — DNP / rest / load management: skip game; balldontlie already omits DNPs.
 *   Rule 5 — Return from injury (40+ games missed): reset window, treat as game 1.
 */

export const SHORT_SAMPLE_CAP_USD    = 3.00;   // Rule 3: cap for 5–14 game window
export const SHORT_SAMPLE_FLOOR_USD  = 0.25;   // Rule 3: floor for 0–4 game window
export const RESET_THRESHOLD_GAMES   = 40;     // Rule 5: reset window after this many missed
export const STALENESS_FLAG_GAMES    = 12;     // Rule 5: flag for review after this many missed

export interface PlayerOracleState {
  /** Total games played in the current NBA season (for Rule 3 short-sample cap). */
  gamesPlayedThisSeason: number;
  /** Games missed in a row (no box-score entry). Resets to 0 when player plays. */
  consecutiveGamesMissed: number;
  /**
   * ISO date string (YYYY-MM-DD) of the last game played.
   * Used to detect whether the player played since the last oracle run.
   */
  lastGameDate: string | null;
  /**
   * If set, the oracle rolling window is treated as starting fresh from this
   * date (Rule 5: return from 40+ game injury). Only games on or after this
   * date enter the 5-game window.
   */
  windowResetAfterDate: string | null;
}

export function defaultPlayerOracleState(): PlayerOracleState {
  return {
    gamesPlayedThisSeason: 0,
    consecutiveGamesMissed: 0,
    lastGameDate: null,
    windowResetAfterDate: null,
  };
}

// ── KV persistence (Vercel KV / Upstash REST) ─────────────────────────────

function kvKey(cluster: string, playerId: string): string {
  return `oracle-player-state:${cluster}:${playerId}`;
}

/** Load player oracle state from Vercel KV. Returns default if not found. */
export async function loadPlayerStateFromKv(
  cluster: string,
  playerId: string,
  opts: { kvUrl?: string; kvToken?: string } = {},
): Promise<PlayerOracleState> {
  const kvUrl   = opts.kvUrl   ?? process.env.KV_REST_API_URL;
  const kvToken = opts.kvToken ?? process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return defaultPlayerOracleState();

  try {
    const key = encodeURIComponent(kvKey(cluster, playerId));
    const res = await fetch(`${kvUrl}/get/${key}`, {
      headers: { Authorization: `Bearer ${kvToken}` },
    });
    if (!res.ok) return defaultPlayerOracleState();
    const body = await res.json() as { result?: string | null };
    if (!body.result) return defaultPlayerOracleState();
    return JSON.parse(body.result) as PlayerOracleState;
  } catch {
    return defaultPlayerOracleState();
  }
}

/** Persist player oracle state to Vercel KV. */
export async function savePlayerStateToKv(
  cluster: string,
  playerId: string,
  state: PlayerOracleState,
  opts: { kvUrl?: string; kvToken?: string } = {},
): Promise<void> {
  const kvUrl   = opts.kvUrl   ?? process.env.KV_REST_API_URL;
  const kvToken = opts.kvToken ?? process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return;

  try {
    const key = encodeURIComponent(kvKey(cluster, playerId));
    await fetch(`${kvUrl}/set/${key}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${kvToken}`,
        "Content-Type": "application/json",
      },
      // No expiry — state is long-lived (full season)
      body: JSON.stringify(JSON.stringify(state)),
    });
  } catch {
    // Non-fatal — state loss just means we lose policy tracking for one cycle
    console.warn(`[injury-policy] Failed to save state for ${playerId}`);
  }
}

// ── Policy application ─────────────────────────────────────────────────────

export interface PolicyResult {
  /** If true, skip the oracle update for this player this cycle (freeze). */
  freeze: boolean;
  /**
   * If freeze is false, this is the final capped USD price to use.
   * If freeze is true, this is the last computed value (callers may log it).
   */
  finalUsdPrice: number;
  /** Human-readable reason for logging. */
  reason: string;
  /** Updated state to persist after this cycle. */
  updatedState: PlayerOracleState;
}

/**
 * Apply all injury-policy rules to a computed oracle price.
 *
 * @param playerId      — player id for logging
 * @param computedUsd   — raw formula output (after max($0.25, composite * 0.12))
 * @param currentState  — loaded from KV before this cycle
 * @param todayGameDate — ISO date string (YYYY-MM-DD) of any game played today,
 *                        or null if the player did not play today / data not available.
 * @param gamesThisSeason — total games played by this player in the current season.
 *                          Pass 0 if unknown (policy degrades gracefully).
 * @param lastOracleUsd — last oracle value written on-chain (for freeze passthrough).
 *                        Pass computedUsd if not tracked.
 */
export function applyInjuryPolicy(
  playerId: string,
  computedUsd: number,
  currentState: PlayerOracleState,
  todayGameDate: string | null,
  gamesThisSeason: number,
  lastOracleUsd: number,
): PolicyResult {
  const state: PlayerOracleState = { ...currentState, gamesPlayedThisSeason: gamesThisSeason };

  const playerPlayed = todayGameDate !== null && todayGameDate !== state.lastGameDate;

  // ── Rule 4: DNP / rest / load management ─────────────────────────────────
  // If the player did not play today, no new data — freeze (hold last value).
  // balldontlie omits DNPs from the /stats endpoint so `todayGameDate` will be
  // null on a DNP. This is the same behavior as Rules 1 & 2 (frozen injury).
  if (!playerPlayed) {
    const newMissed = state.consecutiveGamesMissed + 1;

    // Rule 5 staleness flag: 12–39 games missed → log for review
    if (newMissed >= STALENESS_FLAG_GAMES && newMissed < RESET_THRESHOLD_GAMES) {
      console.warn(
        `[injury-policy] ${playerId}: ${newMissed} consecutive games missed — ` +
        `oracle frozen (staleness flag: review recommended)`
      );
    }

    const updatedState: PlayerOracleState = {
      ...state,
      consecutiveGamesMissed: newMissed,
    };

    return {
      freeze: true,
      finalUsdPrice: lastOracleUsd,
      reason: `Rule 1/2/4 freeze — ${newMissed} consecutive games missed (no new data)`,
      updatedState,
    };
  }

  // Player played today — update last game date
  state.lastGameDate = todayGameDate;

  // ── Rule 5: Return from 40+ game injury — reset rolling window ────────────
  const wasInLongInjury = currentState.consecutiveGamesMissed >= RESET_THRESHOLD_GAMES;
  if (wasInLongInjury) {
    console.log(
      `[injury-policy] ${playerId}: returned after ${currentState.consecutiveGamesMissed} games missed — ` +
      `resetting rolling window (Rule 5)`
    );
    // Mark window reset: only post-return games enter the rolling average.
    // The actual window filtering is done in fetchLast5GamesSince (stats layer).
    state.windowResetAfterDate = todayGameDate;
    state.consecutiveGamesMissed = 0;
    // After a window reset, treat gamesThisSeason counter as if starting fresh
    // for the purpose of the short-sample cap (Rule 3).
    state.gamesPlayedThisSeason = 1; // this is game 1 post-return

    // Rule 3 applies during re-entry: < 5 post-return games → floor
    // We set gamesThisSeason = 1, so the floor check below will catch it.
  } else {
    state.consecutiveGamesMissed = 0;
  }

  // ── Rule 3: Short-sample cap ──────────────────────────────────────────────
  const effectiveGames = wasInLongInjury ? state.gamesPlayedThisSeason : gamesThisSeason;
  let finalUsdPrice = computedUsd;
  let reason = "no policy cap applied";

  if (effectiveGames < 5) {
    // 0–4 games: hold at floor (existing rule, now explicitly enforced)
    finalUsdPrice = SHORT_SAMPLE_FLOOR_USD;
    reason = `Rule 3: short-sample floor (${effectiveGames} games played < 5)`;
  } else if (effectiveGames < 15) {
    // 5–14 games: cap at $3.00
    if (computedUsd > SHORT_SAMPLE_CAP_USD) {
      finalUsdPrice = SHORT_SAMPLE_CAP_USD;
      reason = `Rule 3: short-sample cap at $${SHORT_SAMPLE_CAP_USD} (${effectiveGames} games played, formula → $${computedUsd.toFixed(2)})`;
    } else {
      reason = `Rule 3: short-sample window (${effectiveGames} games), formula $${computedUsd.toFixed(2)} under cap`;
    }
  } else {
    reason = `full formula — ${effectiveGames} games played`;
  }

  return {
    freeze: false,
    finalUsdPrice,
    reason,
    updatedState: state,
  };
}
