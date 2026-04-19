/**
 * Shared stats resolution for init-players + oracle scripts.
 *
 * Single source of truth for:
 *   - PLAYER_API_MAP: balldontlie lookup table
 *   - getMockStats: reads from DEVNET_PLAYERS.stats (the only mock dict)
 *   - fetchPlayerStats / fetchLast5GamesAverage / calculateTS: live balldontlie path
 *   - resolveStats: one call that picks mock vs live + handles fallback
 *
 * Why this exists: init-players and oracle used to read different stats arrays,
 * so base_price and index_price disagreed at T0. Now both go through resolveStats
 * and land on the same pillars → spread = 0 at launch.
 */

import type { AdvancedPlayerStats } from "../../app/lib/oracle-weights";
import { DEVNET_PLAYERS } from "../../app/lib/fanshare-program";

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

/**
 * Fetch advanced player stats from balldontlie.io.
 *
 * Box-score averages come from the last 5 games (rolling window) — smooths
 * single-game noise without being as slow as a full season average. Advanced
 * ratings (ORTG/DRTG/USG/TS/NetRtg) still use the season-averaged
 * `/v1/stats/advanced` endpoint (per-game advanced is noisier).
 *
 * Fallback chain: last-5 games → season averages → null.
 */
export async function fetchPlayerStats(
  playerName: string,
): Promise<AdvancedPlayerStats | null> {
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
    let basic = await fetchLast5GamesAverage(player.id);
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
    };
  } catch (err) {
    console.warn(`  API error for ${playerName}:`, err);
    return null;
  }
}

/**
 * Fetch the 5 most recent game lines for a player and return averaged box-score
 * stats in the same shape as `/v1/season_averages`.
 */
export async function fetchLast5GamesAverage(
  playerId: number,
): Promise<Record<string, number> | null> {
  const url =
    `https://api.balldontlie.io/v1/stats?player_ids[]=${playerId}` +
    `&per_page=5&sort=date&order=desc`;
  const res = await fetch(url, { headers: API_HEADERS });
  if (!res.ok) return null;
  const data = await res.json();
  const games: Array<Record<string, number>> = data.data ?? [];
  if (games.length === 0) return null;

  const keys = ["pts", "reb", "ast", "stl", "blk", "turnover", "fga", "fta"] as const;
  const avg: Record<string, number> = {};
  for (const k of keys) {
    const sum = games.reduce((acc, g) => acc + (Number(g[k]) || 0), 0);
    avg[k] = sum / games.length;
  }
  return avg;
}

/** TS% from basic stats: PTS / (2 × (FGA + 0.44 × FTA)) × 100. */
export function calculateTS(basic: Record<string, number>): number {
  const pts = basic.pts ?? 0;
  const fga = basic.fga ?? 0;
  const fta = basic.fta ?? 0;
  if (fga + 0.44 * fta === 0) return 56;
  return (pts / (2 * (fga + 0.44 * fta))) * 100;
}

// ── Unified resolver ───────────────────────────────────────────────────────

/**
 * Resolve stats for a player. Mock mode reads DEVNET_PLAYERS directly; live
 * mode tries balldontlie and falls back to mock on any failure.
 *
 * Both init-players and oracle go through this, which is the whole point:
 * identical input → identical pillars → base_price === index_price at T0.
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
    if (live) return live;
  }
  // Fallback: live unavailable → use mock so init/oracle can still proceed.
  return getMockStats(playerId);
}
