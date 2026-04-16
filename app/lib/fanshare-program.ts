/**
 * FanShare program constants, types, and account deserialization.
 * Works with @solana/kit (new SDK).
 */

import type { AdvancedPlayerStats } from "./oracle-weights";

// Program ID from anchor build
export const PROGRAM_ID = "FLnVTYYPDShw4nmGz6oZKsBHVSdWB1vJxLmcycFo1T7F" as const;

// PDA seed prefixes (must match Rust seeds exactly)
export const BONDING_CURVE_SEED = "bonding-curve";
export const STATS_ORACLE_SEED = "stats-oracle";
export const EXIT_TREASURY_SEED = "exit-treasury";
export const ORACLE_CONFIG_SEED = "oracle-config";
export const MARKET_STATUS_SEED = "market-status";
export const LEADERBOARD_SEED = "leaderboard";
export const SHARP_CALLS_TYPE = 1;

// Protocol wallet — receives 1.0% fee from every trade.
// Must match the value stored in GlobalExitTreasury on-chain.
export const PROTOCOL_WALLET = "CsGh5T7EzTUW3hmdpjMrJyzBVq1RPnDXMr9VYuHyXa83" as const;

// Fee constants (must match on-chain: FEE_NUMERATOR / FEE_DENOMINATOR = 1.5%)
export const FEE_NUMERATOR = 15n;
export const FEE_DENOMINATOR = 1000n;

// Default bonding curve parameters — pre-init fallback only.
// Real curves are init'd with basePrice = 4-pillar index price (see scripts/init-players.ts).
// Slope + totalSupply are AMM parameters, tuned later once trading is live.
export const DEFAULT_BASE_PRICE = 10_000n;
export const DEFAULT_SLOPE = 1n; // placeholder — AMM tuning deferred
export const DEFAULT_TOTAL_SUPPLY = 1_000_000n;

// Devnet player roster
// 15-player roster locked by CEO review 2026-03-31.
// Pricing: basePrice = 4-pillar index price (Jerry's spec) at launch. AMM moves from there.
export interface PlayerConfig {
  id: string;
  displayName: string;
  emoji: string; // visual identifier for devnet
  position: "PG" | "SG" | "SF" | "PF" | "C";
  team: string; // abbreviated team for display
  stats: AdvancedPlayerStats; // full 4-pillar inputs — single source of truth
}

// Advanced stats for each player — mirror of MOCK_STATS in cron/oracle/route.ts.
// Used for: (1) init-players basePrice calc, (2) trade page pillar breakdown display.
// Shape matches AdvancedPlayerStats from oracle-weights.ts.
export const DEVNET_PLAYERS: PlayerConfig[] = [
  { id: "Player_LD",  displayName: "Luka Dončić",             emoji: "⚡",  position: "PG", team: "DAL", stats: { ppg: 33.9, rpg: 9.2,  apg: 9.8,  spg: 1.4, bpg: 0.5, tov: 4.0, ortg: 118, drtg: 112, usg: 37, ts: 58, netRtg: 6  } },
  { id: "Player_JE",  displayName: "Joel Embiid",             emoji: "🔨",  position: "C",  team: "PHI", stats: { ppg: 34.7, rpg: 11.0, apg: 5.6,  spg: 1.2, bpg: 1.7, tov: 3.5, ortg: 120, drtg: 108, usg: 38, ts: 64, netRtg: 12 } },
  { id: "Player_GA",  displayName: "Giannis Antetokounmpo",   emoji: "🦌",  position: "PF", team: "MIL", stats: { ppg: 30.4, rpg: 11.5, apg: 6.5,  spg: 1.2, bpg: 1.1, tov: 3.4, ortg: 119, drtg: 107, usg: 34, ts: 61, netRtg: 12 } },
  { id: "Player_NJ",  displayName: "Nikola Jokić",            emoji: "🃏",  position: "C",  team: "DEN", stats: { ppg: 26.4, rpg: 12.4, apg: 9.0,  spg: 1.4, bpg: 0.9, tov: 3.0, ortg: 126, drtg: 112, usg: 28, ts: 63, netRtg: 12 } },
  { id: "Player_SGA", displayName: "Shai Gilgeous-Alexander", emoji: "🌩",  position: "PG", team: "OKC", stats: { ppg: 30.1, rpg: 5.5,  apg: 6.2,  spg: 2.0, bpg: 0.7, tov: 2.5, ortg: 121, drtg: 109, usg: 32, ts: 63, netRtg: 12 } },
  { id: "Player_LBJ", displayName: "LeBron James",            emoji: "👑",  position: "SF", team: "LAL", stats: { ppg: 25.7, rpg: 7.3,  apg: 8.3,  spg: 1.3, bpg: 0.5, tov: 3.5, ortg: 118, drtg: 111, usg: 30, ts: 60, netRtg: 7  } },
  { id: "Player_AD",  displayName: "Anthony Davis",           emoji: "🦾",  position: "PF", team: "LAL", stats: { ppg: 24.7, rpg: 12.6, apg: 3.5,  spg: 1.2, bpg: 2.3, tov: 2.0, ortg: 116, drtg: 105, usg: 28, ts: 58, netRtg: 11 } },
  { id: "Player_KD",  displayName: "Kevin Durant",            emoji: "🪄",  position: "SF", team: "PHX", stats: { ppg: 27.1, rpg: 6.6,  apg: 5.0,  spg: 0.9, bpg: 1.4, tov: 2.8, ortg: 119, drtg: 111, usg: 31, ts: 62, netRtg: 8  } },
  { id: "Player_JT",  displayName: "Jayson Tatum",            emoji: "🦅",  position: "SF", team: "BOS", stats: { ppg: 26.9, rpg: 8.1,  apg: 4.9,  spg: 1.0, bpg: 0.6, tov: 2.7, ortg: 118, drtg: 108, usg: 31, ts: 59, netRtg: 10 } },
  { id: "Player_DB",  displayName: "Devin Booker",            emoji: "📖",  position: "SG", team: "PHX", stats: { ppg: 27.1, rpg: 4.5,  apg: 6.9,  spg: 0.9, bpg: 0.3, tov: 3.2, ortg: 116, drtg: 113, usg: 31, ts: 57, netRtg: 3  } },
  { id: "Player_SC",  displayName: "Stephen Curry",           emoji: "🍛",  position: "PG", team: "GSW", stats: { ppg: 26.4, rpg: 4.5,  apg: 6.1,  spg: 0.7, bpg: 0.4, tov: 3.0, ortg: 117, drtg: 113, usg: 30, ts: 61, netRtg: 4  } },
  { id: "Player_TH",  displayName: "Tyrese Haliburton",       emoji: "💧",  position: "PG", team: "IND", stats: { ppg: 20.7, rpg: 3.7,  apg: 10.9, spg: 1.2, bpg: 0.7, tov: 2.8, ortg: 117, drtg: 112, usg: 25, ts: 59, netRtg: 5  } },
  { id: "Player_CC",  displayName: "Cade Cunningham",         emoji: "🎯",  position: "PG", team: "DET", stats: { ppg: 22.7, rpg: 4.3,  apg: 7.5,  spg: 0.9, bpg: 0.3, tov: 3.2, ortg: 113, drtg: 115, usg: 29, ts: 55, netRtg: -2 } },
  { id: "Player_VW",  displayName: "Victor Wembanyama",       emoji: "👽",  position: "C",  team: "SAS", stats: { ppg: 21.4, rpg: 10.6, apg: 3.9,  spg: 1.2, bpg: 3.6, tov: 3.0, ortg: 115, drtg: 104, usg: 28, ts: 57, netRtg: 11 } },
  { id: "Player_JB",  displayName: "Jaylen Brown",            emoji: "✈️",  position: "SG", team: "BOS", stats: { ppg: 23.0, rpg: 5.5,  apg: 3.6,  spg: 1.2, bpg: 0.5, tov: 2.5, ortg: 117, drtg: 109, usg: 29, ts: 58, netRtg: 8  } },
];

// On-chain account types (deserialized from BondingCurveAccount)
export interface BondingCurveData {
  playerId: string;
  mint: string;
  basePrice: bigint;
  slope: bigint;
  totalSupply: bigint;
  tokensSold: bigint;
  treasuryLamports: bigint;
  authority: string;
  bump: number;
}

export interface StatsOracleData {
  mint: string;
  indexPriceLamports: bigint;
  lastUpdated: bigint;
  statsSourceDate: bigint;
  authority: string;
  bump: number;
}

export interface MarketStatusData {
  mint: string;
  isFrozen: boolean;
  freezeTimestamp: bigint;
  closeTimestamp: bigint;
  openTime: bigint;
  authority: string;
  bump: number;
}

// Combined view for the market screen
export interface PlayerMarketData {
  config: PlayerConfig;
  curve: BondingCurveData | null; // null if not yet initialized on-chain
  oracle: StatsOracleData | null;
  currentPrice: bigint;
  spreadPercent: number;
}

/**
 * Anchor account discriminator — first 8 bytes of SHA256("account:<AccountName>")
 * These are from the IDL.
 */
export const BONDING_CURVE_DISCRIMINATOR = new Uint8Array([143, 100, 193, 40, 52, 254, 111, 103]);
export const STATS_ORACLE_DISCRIMINATOR = new Uint8Array([244, 15, 171, 62, 225, 182, 102, 103]);
export const MARKET_STATUS_DISCRIMINATOR = new Uint8Array([101, 43, 127, 201, 100, 221, 208, 188]);

/**
 * Deserialize a BondingCurveAccount from raw account data.
 * Layout (after 8-byte discriminator):
 *   4 bytes: string length (u32 LE)
 *   N bytes: player_id UTF-8
 *   32 bytes: mint (Pubkey)
 *   8 bytes: base_price (u64 LE)
 *   8 bytes: slope (u64 LE)
 *   8 bytes: total_supply (u64 LE)
 *   8 bytes: tokens_sold (u64 LE)
 *   8 bytes: treasury_lamports (u64 LE)
 *   32 bytes: authority (Pubkey)
 *   1 byte: bump (u8)
 */
export function deserializeBondingCurve(data: Uint8Array): BondingCurveData {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 8; // skip discriminator

  // String: 4-byte length prefix + UTF-8 bytes
  const strLen = view.getUint32(offset, true);
  offset += 4;
  const playerId = new TextDecoder().decode(data.slice(offset, offset + strLen));
  offset += strLen;

  // Pubkey (32 bytes) -> base58 string
  const mintBytes = data.slice(offset, offset + 32);
  const mint = bytesToBase58(mintBytes);
  offset += 32;

  const basePrice = view.getBigUint64(offset, true); offset += 8;
  const slope = view.getBigUint64(offset, true); offset += 8;
  const totalSupply = view.getBigUint64(offset, true); offset += 8;
  const tokensSold = view.getBigUint64(offset, true); offset += 8;
  const treasuryLamports = view.getBigUint64(offset, true); offset += 8;

  const authorityBytes = data.slice(offset, offset + 32);
  const authority = bytesToBase58(authorityBytes);
  offset += 32;

  const bump = data[offset];

  return {
    playerId,
    mint,
    basePrice,
    slope,
    totalSupply,
    tokensSold,
    treasuryLamports,
    authority,
    bump,
  };
}

/**
 * Deserialize a StatsOracleAccount from raw account data.
 * Layout (after 8-byte discriminator):
 *   32 bytes: mint (Pubkey)
 *   8 bytes: index_price_lamports (u64 LE)
 *   8 bytes: last_updated (i64 LE)
 *   8 bytes: stats_source_date (i64 LE)
 *   32 bytes: authority (Pubkey)
 *   1 byte: bump (u8)
 */
export function deserializeStatsOracle(data: Uint8Array): StatsOracleData {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 8; // skip discriminator

  const mintBytes = data.slice(offset, offset + 32);
  const mint = bytesToBase58(mintBytes);
  offset += 32;

  const indexPriceLamports = view.getBigUint64(offset, true); offset += 8;
  const lastUpdated = view.getBigInt64(offset, true); offset += 8;
  const statsSourceDate = view.getBigInt64(offset, true); offset += 8;

  const authorityBytes = data.slice(offset, offset + 32);
  const authority = bytesToBase58(authorityBytes);
  offset += 32;

  const bump = data[offset];

  return { mint, indexPriceLamports, lastUpdated, statsSourceDate, authority, bump };
}

/**
 * Deserialize a MarketStatus account from raw account data.
 * Layout (after 8-byte discriminator):
 *   32 bytes: mint (Pubkey)
 *   1 byte: is_frozen (bool)
 *   8 bytes: freeze_timestamp (i64 LE)
 *   8 bytes: close_timestamp (i64 LE)
 *   8 bytes: open_time (i64 LE)
 *   32 bytes: authority (Pubkey)
 *   1 byte: bump (u8)
 */
export function deserializeMarketStatus(data: Uint8Array): MarketStatusData {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 8; // skip discriminator

  const mintBytes = data.slice(offset, offset + 32);
  const mint = bytesToBase58(mintBytes);
  offset += 32;

  const isFrozen = data[offset] !== 0;
  offset += 1;

  const freezeTimestamp = view.getBigInt64(offset, true); offset += 8;
  const closeTimestamp = view.getBigInt64(offset, true); offset += 8;
  const openTime = view.getBigInt64(offset, true); offset += 8;

  const authorityBytes = data.slice(offset, offset + 32);
  const authority = bytesToBase58(authorityBytes);
  offset += 32;

  const bump = data[offset];

  return { mint, isFrozen, freezeTimestamp, closeTimestamp, openTime, authority, bump };
}

// Simple base58 encoder (no dependency needed for display)
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function bytesToBase58(bytes: Uint8Array): string {
  let num = 0n;
  for (const byte of bytes) {
    num = num * 256n + BigInt(byte);
  }

  let str = "";
  while (num > 0n) {
    const remainder = Number(num % 58n);
    str = BASE58_ALPHABET[remainder] + str;
    num = num / 58n;
  }

  // Leading zeros
  for (const byte of bytes) {
    if (byte === 0) str = "1" + str;
    else break;
  }

  return str || "1";
}
