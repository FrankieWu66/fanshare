import { describe, it, expect } from "vitest";
import {
  deserializeBondingCurve,
  deserializeStatsOracle,
} from "../app/lib/fanshare-program";

// ── deserializeBondingCurve ───────────────────────────────────────────────────
// Layout after discriminator (8 bytes):
//   u32 LE  : player_id length
//   N bytes : player_id UTF-8
//   32 bytes: mint pubkey
//   u64 LE  : base_price
//   u64 LE  : slope
//   u64 LE  : total_supply
//   u64 LE  : tokens_sold
//   u64 LE  : treasury_lamports
//   32 bytes: authority pubkey
//   1 byte  : bump

function buildBondingCurveBytes(opts: {
  playerId: string;
  mint: Uint8Array;      // 32 bytes
  basePrice: bigint;
  slope: bigint;
  totalSupply: bigint;
  tokensSold: bigint;
  treasuryLamports: bigint;
  authority: Uint8Array; // 32 bytes
  bump: number;
}): Uint8Array {
  const playerIdBytes = new TextEncoder().encode(opts.playerId);
  const totalLen = 8 + 4 + playerIdBytes.length + 32 + 8 * 5 + 32 + 1;
  const buf = new ArrayBuffer(totalLen);
  const view = new DataView(buf);
  let off = 0;

  // 8-byte discriminator (zeroed — deserializer skips it)
  off += 8;

  // player_id string
  view.setUint32(off, playerIdBytes.length, true);
  off += 4;
  new Uint8Array(buf, off, playerIdBytes.length).set(playerIdBytes);
  off += playerIdBytes.length;

  // mint (32 bytes)
  new Uint8Array(buf, off, 32).set(opts.mint);
  off += 32;

  // u64 fields
  view.setBigUint64(off, opts.basePrice, true); off += 8;
  view.setBigUint64(off, opts.slope, true); off += 8;
  view.setBigUint64(off, opts.totalSupply, true); off += 8;
  view.setBigUint64(off, opts.tokensSold, true); off += 8;
  view.setBigUint64(off, opts.treasuryLamports, true); off += 8;

  // authority (32 bytes)
  new Uint8Array(buf, off, 32).set(opts.authority);
  off += 32;

  // bump
  view.setUint8(off, opts.bump);

  return new Uint8Array(buf);
}

describe("deserializeBondingCurve", () => {
  const MINT = new Uint8Array(32).fill(1);       // 32 × 0x01
  const AUTHORITY = new Uint8Array(32).fill(2);  // 32 × 0x02

  const payload = buildBondingCurveBytes({
    playerId: "Player_LD",
    mint: MINT,
    basePrice: 23_440n,
    slope: 50n,
    totalSupply: 500_000n,
    tokensSold: 1_234n,
    treasuryLamports: 56_789n,
    authority: AUTHORITY,
    bump: 254,
  });

  it("decodes playerId correctly", () => {
    expect(deserializeBondingCurve(payload).playerId).toBe("Player_LD");
  });

  it("decodes basePrice as bigint", () => {
    expect(deserializeBondingCurve(payload).basePrice).toBe(23_440n);
  });

  it("decodes slope as bigint", () => {
    expect(deserializeBondingCurve(payload).slope).toBe(50n);
  });

  it("decodes totalSupply as bigint", () => {
    expect(deserializeBondingCurve(payload).totalSupply).toBe(500_000n);
  });

  it("decodes tokensSold as bigint", () => {
    expect(deserializeBondingCurve(payload).tokensSold).toBe(1_234n);
  });

  it("decodes treasuryLamports as bigint", () => {
    expect(deserializeBondingCurve(payload).treasuryLamports).toBe(56_789n);
  });

  it("decodes bump correctly", () => {
    expect(deserializeBondingCurve(payload).bump).toBe(254);
  });

  it("decodes a multi-byte playerId (Player_SGA)", () => {
    const p2 = buildBondingCurveBytes({
      playerId: "Player_SGA",
      mint: MINT,
      basePrice: 20_000n,
      slope: 20n,
      totalSupply: 750_000n,
      tokensSold: 0n,
      treasuryLamports: 0n,
      authority: AUTHORITY,
      bump: 253,
    });
    expect(deserializeBondingCurve(p2).playerId).toBe("Player_SGA");
    expect(deserializeBondingCurve(p2).slope).toBe(20n);
  });

  it("handles zero tokensSold and zero treasury", () => {
    const p3 = buildBondingCurveBytes({
      playerId: "P",
      mint: MINT,
      basePrice: 10_000n,
      slope: 8n,
      totalSupply: 1_000_000n,
      tokensSold: 0n,
      treasuryLamports: 0n,
      authority: AUTHORITY,
      bump: 255,
    });
    const result = deserializeBondingCurve(p3);
    expect(result.tokensSold).toBe(0n);
    expect(result.treasuryLamports).toBe(0n);
  });
});

// ── deserializeStatsOracle ────────────────────────────────────────────────────
// Layout after discriminator (8 bytes):
//   32 bytes: mint pubkey
//   u64 LE  : index_price_lamports
//   i64 LE  : last_updated (unix timestamp)
//   32 bytes: authority pubkey
//   1 byte  : bump

function buildStatsOracleBytes(opts: {
  mint: Uint8Array;
  indexPriceLamports: bigint;
  lastUpdated: bigint;
  authority: Uint8Array;
  bump: number;
}): Uint8Array {
  const totalLen = 8 + 32 + 8 + 8 + 32 + 1;
  const buf = new ArrayBuffer(totalLen);
  const view = new DataView(buf);
  let off = 8; // skip discriminator

  new Uint8Array(buf, off, 32).set(opts.mint);
  off += 32;

  view.setBigUint64(off, opts.indexPriceLamports, true); off += 8;
  view.setBigInt64(off, opts.lastUpdated, true); off += 8;

  new Uint8Array(buf, off, 32).set(opts.authority);
  off += 32;

  view.setUint8(off, opts.bump);

  return new Uint8Array(buf);
}

describe("deserializeStatsOracle", () => {
  const MINT = new Uint8Array(32).fill(3);
  const AUTHORITY = new Uint8Array(32).fill(4);
  const TIMESTAMP = 1_743_984_000n; // 2025-04-07 00:00 UTC approx

  const payload = buildStatsOracleBytes({
    mint: MINT,
    indexPriceLamports: 47_120n,
    lastUpdated: TIMESTAMP,
    authority: AUTHORITY,
    bump: 252,
  });

  it("decodes indexPriceLamports as bigint", () => {
    expect(deserializeStatsOracle(payload).indexPriceLamports).toBe(47_120n);
  });

  it("decodes lastUpdated as bigint", () => {
    expect(deserializeStatsOracle(payload).lastUpdated).toBe(TIMESTAMP);
  });

  it("decodes bump correctly", () => {
    expect(deserializeStatsOracle(payload).bump).toBe(252);
  });

  it("handles zero index price (oracle not yet updated)", () => {
    const p2 = buildStatsOracleBytes({
      mint: MINT,
      indexPriceLamports: 0n,
      lastUpdated: 0n,
      authority: AUTHORITY,
      bump: 255,
    });
    expect(deserializeStatsOracle(p2).indexPriceLamports).toBe(0n);
    expect(deserializeStatsOracle(p2).lastUpdated).toBe(0n);
  });

  it("handles max u64 index price without overflow", () => {
    const MAX_U64 = 18_446_744_073_709_551_615n;
    const p3 = buildStatsOracleBytes({
      mint: MINT,
      indexPriceLamports: MAX_U64,
      lastUpdated: TIMESTAMP,
      authority: AUTHORITY,
      bump: 1,
    });
    expect(deserializeStatsOracle(p3).indexPriceLamports).toBe(MAX_U64);
  });
});
