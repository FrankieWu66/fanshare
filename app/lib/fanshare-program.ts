/**
 * FanShare program constants, types, and account deserialization.
 * Works with @solana/kit (new SDK).
 */

// Program ID from anchor build
export const PROGRAM_ID = "B69juh6rX1Z6WNN2qCkrhuHDnk6v5vrK8oJ2o6oHTVYz" as const;

// PDA seed prefixes (must match Rust seeds exactly)
export const BONDING_CURVE_SEED = "bonding-curve";
export const STATS_ORACLE_SEED = "stats-oracle";

// Default bonding curve parameters (from design doc TODOS.md)
export const DEFAULT_BASE_PRICE = 1000n; // 0.000001 SOL
export const DEFAULT_SLOPE = 10n; // 10 lamports per token sold
export const DEFAULT_TOTAL_SUPPLY = 1_000_000n;

// Devnet player roster — abstract IDs per design doc (no real names until legal review)
// 15-player roster locked by CEO review 2026-03-31
export interface PlayerConfig {
  id: string;
  displayName: string;
  emoji: string; // visual identifier for devnet
  position: "PG" | "SG" | "SF" | "PF" | "C";
  team: string; // abbreviated team for display
}

export const DEVNET_PLAYERS: PlayerConfig[] = [
  // Top tier stars
  { id: "Player_LBJ", displayName: "The King",       emoji: "👑", position: "SF", team: "LAL" },
  { id: "Player_SC",  displayName: "The Chef",        emoji: "🍛", position: "PG", team: "GSW" },
  { id: "Player_LD",  displayName: "The Maverick",    emoji: "⚡", position: "PG", team: "DAL" },
  { id: "Player_NJ",  displayName: "The Joker",       emoji: "🃏", position: "C",  team: "DEN" },
  { id: "Player_JT",  displayName: "The Jaybird",     emoji: "🦅", position: "SF", team: "BOS" },
  // Second tier
  { id: "Player_SGA", displayName: "The Shai",        emoji: "🌩", position: "PG", team: "OKC" },
  { id: "Player_GA",  displayName: "The Greek Freak", emoji: "🦌", position: "PF", team: "MIL" },
  { id: "Player_JE",  displayName: "The Process",     emoji: "🔨", position: "C",  team: "PHI" },
  { id: "Player_KD",  displayName: "The Slim Reaper", emoji: "🪄", position: "SF", team: "PHX" },
  { id: "Player_JB",  displayName: "The Jet",         emoji: "✈️", position: "SG", team: "BOS" },
  // Rising stars
  { id: "Player_DB",  displayName: "The Book",        emoji: "📖", position: "SG", team: "PHX" },
  { id: "Player_AD",  displayName: "The Brow",        emoji: "🦾", position: "PF", team: "LAL" },
  { id: "Player_VW",  displayName: "The Alien",       emoji: "👽", position: "C",  team: "SAS" },
  { id: "Player_CC",  displayName: "The Cade",        emoji: "🎯", position: "PG", team: "DET" },
  { id: "Player_TH",  displayName: "The Hali",        emoji: "💧", position: "PG", team: "IND" },
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
