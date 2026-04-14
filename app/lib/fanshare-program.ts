/**
 * FanShare program constants, types, and account deserialization.
 * Works with @solana/kit (new SDK).
 */

import { STAT_WEIGHTS } from "./oracle-weights";

// Program ID from anchor build
export const PROGRAM_ID = "B69juh6rX1Z6WNN2qCkrhuHDnk6v5vrK8oJ2o6oHTVYz" as const;

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

// Default bonding curve parameters — floor fallback for incomplete stats
export const DEFAULT_BASE_PRICE = 10_000n; // floor for players with missing stats
export const DEFAULT_SLOPE = 8n;
export const DEFAULT_TOTAL_SUPPLY = 1_000_000n;

// Devnet player roster — abstract IDs per design doc (no real names until legal review)
// 15-player roster locked by CEO review 2026-03-31
// Pricing: stats-anchored at init (CEO review 2026-04-06). base_price is set once, never mutated.
export interface PlayerStats {
  ppg: number; // points per game
  rpg: number; // rebounds per game
  apg: number; // assists per game
  spg: number; // steals per game
  bpg: number; // blocks per game
}

/** How base_price was derived — shown on trade page formula section. */
export type PriceFormula =
  | { type: "veteran"; score: number }
  | { type: "rookie"; draftPick: number }
  | { type: "floor" }; // incomplete stats

export interface PlayerConfig {
  id: string;
  displayName: string;
  emoji: string; // visual identifier for devnet
  position: "PG" | "SG" | "SF" | "PF" | "C";
  team: string; // abbreviated team for display
  stats: PlayerStats; // season averages (mirrors oracle mock data)
  priceFormula: PriceFormula;
}

/** Weighted stat score used to anchor base_price. Weights defined in oracle-weights.ts. */
export function oracleScore(stats: PlayerStats): number {
  const score =
    stats.ppg * STAT_WEIGHTS.ppg +
    stats.rpg * STAT_WEIGHTS.rpg +
    stats.apg * STAT_WEIGHTS.apg +
    stats.spg * STAT_WEIGHTS.spg +
    stats.bpg * STAT_WEIGHTS.bpg;
  if (!isFinite(score))
    throw new TypeError(`oracleScore: invalid stats (NaN/Infinity) — check API response`);
  return score;
}

/** Tier parameters derived from oracle score. */
export function tierParams(score: number): { slope: bigint; totalSupply: bigint } {
  if (score >= 40_000) return { slope: 50n, totalSupply: 500_000n };
  if (score >= 25_000) return { slope: 20n, totalSupply: 750_000n };
  return { slope: 8n, totalSupply: 1_000_000n };
}

/** base_price in lamports from veteran stats formula: round(score × 0.5). */
export function veteranBasePrice(stats: PlayerStats): bigint {
  const score = oracleScore(stats); // throws if stats contain NaN/Infinity
  return BigInt(Math.round(score * 0.5));
}

/** base_price in lamports from draft pick (rookies with no stats). Max 18,000L. */
export function rookieBasePrice(draftPick: number): bigint {
  if (draftPick < 1 || draftPick > 60)
    throw new RangeError(`Draft pick must be 1–60, got ${draftPick}`);
  return BigInt(Math.round(18_000 * (61 - draftPick) / 60));
}

function vf(stats: PlayerStats): PriceFormula {
  return { type: "veteran", score: oracleScore(stats) };
}

export const DEVNET_PLAYERS: PlayerConfig[] = [
  // Stars tier (oracle_score ≥ 40,000) — slope=50, supply=500k
  { id: "Player_LD",  displayName: "The Maverick",    emoji: "⚡",  position: "PG", team: "DAL", stats: { ppg: 33.9, rpg: 9.2,  apg: 9.8,  spg: 1.4, bpg: 0.5 }, priceFormula: vf({ ppg: 33.9, rpg: 9.2,  apg: 9.8,  spg: 1.4, bpg: 0.5 }) },
  { id: "Player_JE",  displayName: "The Process",     emoji: "🔨",  position: "C",  team: "PHI", stats: { ppg: 34.7, rpg: 11.0, apg: 5.6,  spg: 1.2, bpg: 1.7 }, priceFormula: vf({ ppg: 34.7, rpg: 11.0, apg: 5.6,  spg: 1.2, bpg: 1.7 }) },
  { id: "Player_GA",  displayName: "The Greek Freak", emoji: "🦌",  position: "PF", team: "MIL", stats: { ppg: 30.4, rpg: 11.5, apg: 6.5,  spg: 1.2, bpg: 1.1 }, priceFormula: vf({ ppg: 30.4, rpg: 11.5, apg: 6.5,  spg: 1.2, bpg: 1.1 }) },
  { id: "Player_NJ",  displayName: "The Joker",       emoji: "🃏",  position: "C",  team: "DEN", stats: { ppg: 26.4, rpg: 12.4, apg: 9.0,  spg: 1.4, bpg: 0.9 }, priceFormula: vf({ ppg: 26.4, rpg: 12.4, apg: 9.0,  spg: 1.4, bpg: 0.9 }) },
  // Second tier (oracle_score 25,000–39,999) — slope=20, supply=750k
  { id: "Player_SGA", displayName: "The Shai",        emoji: "🌩",  position: "PG", team: "OKC", stats: { ppg: 30.1, rpg: 5.5,  apg: 6.2,  spg: 2.0, bpg: 0.7 }, priceFormula: vf({ ppg: 30.1, rpg: 5.5,  apg: 6.2,  spg: 2.0, bpg: 0.7 }) },
  { id: "Player_LBJ", displayName: "The King",        emoji: "👑",  position: "SF", team: "LAL", stats: { ppg: 25.7, rpg: 7.3,  apg: 8.3,  spg: 1.3, bpg: 0.5 }, priceFormula: vf({ ppg: 25.7, rpg: 7.3,  apg: 8.3,  spg: 1.3, bpg: 0.5 }) },
  { id: "Player_AD",  displayName: "The Brow",        emoji: "🦾",  position: "PF", team: "LAL", stats: { ppg: 24.7, rpg: 12.6, apg: 3.5,  spg: 1.2, bpg: 2.3 }, priceFormula: vf({ ppg: 24.7, rpg: 12.6, apg: 3.5,  spg: 1.2, bpg: 2.3 }) },
  { id: "Player_KD",  displayName: "The Slim Reaper", emoji: "🪄",  position: "SF", team: "PHX", stats: { ppg: 27.1, rpg: 6.6,  apg: 5.0,  spg: 0.9, bpg: 1.4 }, priceFormula: vf({ ppg: 27.1, rpg: 6.6,  apg: 5.0,  spg: 0.9, bpg: 1.4 }) },
  { id: "Player_JT",  displayName: "The Jaybird",     emoji: "🦅",  position: "SF", team: "BOS", stats: { ppg: 26.9, rpg: 8.1,  apg: 4.9,  spg: 1.0, bpg: 0.6 }, priceFormula: vf({ ppg: 26.9, rpg: 8.1,  apg: 4.9,  spg: 1.0, bpg: 0.6 }) },
  { id: "Player_DB",  displayName: "The Book",        emoji: "📖",  position: "SG", team: "PHX", stats: { ppg: 27.1, rpg: 4.5,  apg: 6.9,  spg: 0.9, bpg: 0.3 }, priceFormula: vf({ ppg: 27.1, rpg: 4.5,  apg: 6.9,  spg: 0.9, bpg: 0.3 }) },
  { id: "Player_SC",  displayName: "The Chef",        emoji: "🍛",  position: "PG", team: "GSW", stats: { ppg: 26.4, rpg: 4.5,  apg: 6.1,  spg: 0.7, bpg: 0.4 }, priceFormula: vf({ ppg: 26.4, rpg: 4.5,  apg: 6.1,  spg: 0.7, bpg: 0.4 }) },
  { id: "Player_TH",  displayName: "The Hali",        emoji: "💧",  position: "PG", team: "IND", stats: { ppg: 20.7, rpg: 3.7,  apg: 10.9, spg: 1.2, bpg: 0.7 }, priceFormula: vf({ ppg: 20.7, rpg: 3.7,  apg: 10.9, spg: 1.2, bpg: 0.7 }) },
  { id: "Player_CC",  displayName: "The Cade",        emoji: "🎯",  position: "PG", team: "DET", stats: { ppg: 22.7, rpg: 4.3,  apg: 7.5,  spg: 0.9, bpg: 0.3 }, priceFormula: vf({ ppg: 22.7, rpg: 4.3,  apg: 7.5,  spg: 0.9, bpg: 0.3 }) },
  { id: "Player_VW",  displayName: "The Alien",       emoji: "👽",  position: "C",  team: "SAS", stats: { ppg: 21.4, rpg: 10.6, apg: 3.9,  spg: 1.2, bpg: 3.6 }, priceFormula: vf({ ppg: 21.4, rpg: 10.6, apg: 3.9,  spg: 1.2, bpg: 3.6 }) },
  { id: "Player_JB",  displayName: "The Jet",         emoji: "✈️",  position: "SG", team: "BOS", stats: { ppg: 23.0, rpg: 5.5,  apg: 3.6,  spg: 1.2, bpg: 0.5 }, priceFormula: vf({ ppg: 23.0, rpg: 5.5,  apg: 3.6,  spg: 1.2, bpg: 0.5 }) },
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

  const authorityBytes = data.slice(offset, offset + 32);
  const authority = bytesToBase58(authorityBytes);
  offset += 32;

  const bump = data[offset];

  return { mint, indexPriceLamports, lastUpdated, authority, bump };
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
