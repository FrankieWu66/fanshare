/**
 * Shared stats resolution for init-players + oracle scripts.
 *
 * Single source of truth for:
 *   - PLAYER_API_MAP: balldontlie lookup table
 *   - getMockStats: reads from DEVNET_PLAYERS.stats (the only mock dict)
 *   - fetchPlayerStats / fetchLast5GamesAverage / calculateTS: live balldontlie path
 *   - resolveStats: one call that picks mock vs live + handles fallback
 *   - resolveStatsWithContext: extended resolver that also returns games_played_this_season
 *     and most_recent_game_date for injury-policy (Phase C).
 *
 * Why this exists: init-players and oracle used to read different stats arrays,
 * so base_price and index_price disagreed at T0. Now both go through resolveStats
 * and land on the same pillars → spread = 0 at launch.
 */

import type { AdvancedPlayerStats } from "../oracle-weights";
import { DEVNET_PLAYERS } from "../fanshare-program";

// ── Balldontlie lookup ─────────────────────────────────────────────────────

export const PLAYER_API_MAP: Record<string, { name: string; team: string }> = {
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

// ── Mock stats (single source) ─────────────────────────────────────────────

/** Returns the hand-typed mock stats for a player, or null if unknown id. */
export function getMockStats(playerId: string): AdvancedPlayerStats | null {
  const p = DEVNET_PLAYERS.find((x) => x.id === playerId);
  return p ? p.stats : null;
}

// ── Live stats (balldontlie) ───────────────────────────────────────────────

const API_HEADERS: Record<string, string> = process.env.BALLDONTLIE_API_KEY
  ? { Authorization: process.env.BALLDONTLIE_API_KEY }
  : {};

/** Stats plus injury-policy metadata returned by the extended resolver. */
export interface OracleStatsContext {
  stats: AdvancedPlayerStats;
  /** Games played this season (for Rule 3 short-sample cap). */
  gamesThisSeason: number;
  /**
   * ISO date string (YYYY-MM-DD) of the most recent game in the rolling window,
   * or null if unavailable. Used by injury policy to detect whether the player
   * played since the last oracle run.
   */
  mostRecentGameDate: string | null;
}

/**
 * Fetch advanced player stats from balldontlie.io.
 *
 * Box-score averages come from the last 5 games (rolling window) — smooths
 * single-game noise without being as slow as a full season average. Advanced
 * ratings (ORTG/DRTG/USG/TS/NetRtg) still use the season-averaged
 * `/v1/stats/advanced` endpoint (per-game advanced is noisier).
 *
 * Fallback chain: last-5 games → season averages → null.
 *
 * @param windowResetAfterDate — injury-policy Rule 5: if set, only games on/after
 *   this date are included in the rolling 5-game window.
 */
export async function fetchPlayerStats(
  playerName: string,
  windowResetAfterDate?: string | null,
): Promise<(AdvancedPlayerStats & { _mostRecentGameDate?: string | null; _bdlPlayerId?: number }) | null> {
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

    // 2. Try last-5-games rolling average for box-score stats
    //    Pass windowResetAfterDate so Rule 5 filtering applies here.
    const last5Result = await fetchLast5GamesAverage(player.id, windowResetAfterDate);
    let basic: Record<string, number> | null = last5Result?.avg ?? null;
    const mostRecentGameDate = last5Result?.mostRecentDate ?? null;

    if (!basic) {
      console.warn(`  No last-5-games data for ${playerName} — falling back to season averages`);
      const basicUrl = `https://api.balldontlie.io/v1/season_averages?player_ids[]=${player.id}`;
      const basicRes = await fetch(basicUrl, { headers: API_HEADERS });
      if (!basicRes.ok) {
        console.warn(`  Season averages fetch failed for ${playerName}: ${basicRes.status}`);
        return null;
      }
      const basicData = await basicRes.json();
      basic = basicData.data?.[0];
      if (!basic) {
        console.warn(`  No season averages for ${playerName}`);
        return null;
      }
    }

    // 3. Fetch advanced stats (GOAT tier required) — season-averaged
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
        ts = adv.true_shooting_pct ?? adv.ts_pct ?? calculateTS(basic);
      }
    } else {
      console.warn(`  Advanced stats unavailable for ${playerName} (${advancedRes.status}) — using defaults`);
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
      // Internal metadata — stripped before returning from resolveStatsWithContext
      _mostRecentGameDate: mostRecentGameDate,
      _bdlPlayerId: player.id as number,
    };
  } catch (err) {
    console.warn(`  API error for ${playerName}:`, err);
    return null;
  }
}

/**
 * Fetch the 5 most recent game lines for a player and return averaged box-score
 * stats in the same shape as `/v1/season_averages`.
 *
 * @param windowResetAfterDate — if set (Rule 5 return-from-injury), only games
 *   played on or after this date are included in the window. This enforces that
 *   pre-injury stats don't contaminate the post-return rolling average.
 */
export async function fetchLast5GamesAverage(
  playerId: number,
  windowResetAfterDate?: string | null,
): Promise<{ avg: Record<string, number>; mostRecentDate: string | null } | null> {
  // Fetch more games than needed so we can filter by date if a reset is in effect
  const perPage = windowResetAfterDate ? 15 : 5;
  const url =
    `https://api.balldontlie.io/v1/stats?player_ids[]=${playerId}` +
    `&per_page=${perPage}&sort=date&order=desc`;
  const res = await fetch(url, { headers: API_HEADERS });
  if (!res.ok) return null;
  const data = await res.json();
  let games: Array<Record<string, unknown>> = data.data ?? [];
  if (games.length === 0) return null;

  // Rule 5: filter out pre-injury games when window has been reset
  if (windowResetAfterDate) {
    games = games.filter((g) => {
      const gameDate = (g.date as string | undefined)?.slice(0, 10) ?? "";
      return gameDate >= windowResetAfterDate;
    });
    if (games.length === 0) return null;
  }

  // Take the 5 most recent (already sorted desc)
  const window = games.slice(0, 5);
  const mostRecentDate = (window[0]?.date as string | undefined)?.slice(0, 10) ?? null;

  const keys = ["pts", "reb", "ast", "stl", "blk", "turnover", "fga", "fta"] as const;
  const avg: Record<string, number> = {};
  for (const k of keys) {
    const sum = window.reduce((acc, g) => acc + (Number(g[k]) || 0), 0);
    avg[k] = sum / window.length;
  }
  return { avg, mostRecentDate };
}

/**
 * Fetch the number of games a player has played this season.
 * Used by injury policy Rule 3 (short-sample cap).
 * Returns 0 on any failure (policy degrades gracefully to no cap).
 */
export async function fetchGamesPlayedThisSeason(playerId: number): Promise<number> {
  try {
    // Use per_page=1 with total_count meta to get the count efficiently
    const season = new Date().getFullYear() - (new Date().getMonth() < 9 ? 1 : 0);
    const url =
      `https://api.balldontlie.io/v1/stats?player_ids[]=${playerId}` +
      `&seasons[]=${season}&per_page=1`;
    const res = await fetch(url, { headers: API_HEADERS });
    if (!res.ok) return 0;
    const data = await res.json();
    return data.meta?.total_count ?? data.data?.length ?? 0;
  } catch {
    return 0;
  }
}

/** TS% from basic stats: PTS / (2 × (FGA + 0.44 × FTA)) × 100. */
export function calculateTS(basic: Record<string, number>): number {
  const pts = basic.pts ?? 0;
  const fga = basic.fga ?? 0;
  const fta = basic.fta ?? 0;
  if (fga + 0.44 * fta === 0) return 56;
  return (pts / (2 * (fga + 0.44 * fta))) * 100;
}

// ── Unified resolvers ──────────────────────────────────────────────────────

/**
 * Resolve stats for a player. Mock mode reads DEVNET_PLAYERS directly; live
 * mode tries balldontlie and falls back to mock on any failure.
 *
 * Both init-players and oracle go through this, which is the whole point:
 * identical input → identical pillars → base_price === index_price at T0.
 *
 * NOTE: this resolver does NOT return injury-policy metadata. Use
 * resolveStatsWithContext for oracle update jobs that apply Phase C rules.
 */
export async function resolveStats(
  playerId: string,
  opts: { mock: boolean },
): Promise<AdvancedPlayerStats | null> {
  if (opts.mock) {
    return getMockStats(playerId);
  }
  const apiInfo = PLAYER_API_MAP[playerId];
  if (apiInfo) {
    const live = await fetchPlayerStats(apiInfo.name);
    if (live) {
      // Strip internal metadata before returning
      const { _mostRecentGameDate: _d, _bdlPlayerId: _id, ...stats } = live;
      void _d; void _id;
      return stats;
    }
  }
  // Fallback: live unavailable → use mock so init/oracle can still proceed.
  return getMockStats(playerId);
}

/**
 * Extended resolver — returns stats plus injury-policy metadata.
 *
 * Used by the oracle update job (cron + script) to apply Phase C injury rules.
 * In mock mode, gamesThisSeason defaults to 30 (past the short-sample window)
 * and mostRecentGameDate is today, so mock runs are unaffected by policy caps.
 *
 * @param windowResetAfterDate — if set (Rule 5 return-from-injury), only games
 *   on/after this date enter the rolling 5-game window.
 */
export async function resolveStatsWithContext(
  playerId: string,
  opts: { mock: boolean; windowResetAfterDate?: string | null },
): Promise<OracleStatsContext | null> {
  if (opts.mock) {
    const stats = getMockStats(playerId);
    if (!stats) return null;
    return {
      stats,
      gamesThisSeason: 30, // mock: treat all players as past short-sample window
      mostRecentGameDate: new Date().toISOString().slice(0, 10),
    };
  }

  const apiInfo = PLAYER_API_MAP[playerId];
  if (!apiInfo) {
    const mock = getMockStats(playerId);
    if (!mock) return null;
    return { stats: mock, gamesThisSeason: 0, mostRecentGameDate: null };
  }

  const live = await fetchPlayerStats(apiInfo.name, opts.windowResetAfterDate);
  if (!live) {
    const mock = getMockStats(playerId);
    if (!mock) return null;
    return { stats: mock, gamesThisSeason: 0, mostRecentGameDate: null };
  }

  const { _mostRecentGameDate, _bdlPlayerId, ...stats } = live;
  const gamesThisSeason = _bdlPlayerId
    ? await fetchGamesPlayedThisSeason(_bdlPlayerId)
    : 0;

  return {
    stats,
    gamesThisSeason,
    mostRecentGameDate: _mostRecentGameDate ?? null,
  };
}
