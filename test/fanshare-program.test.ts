import { describe, it, expect } from "vitest";
import {
  oracleScore,
  tierParams,
  veteranBasePrice,
  rookieBasePrice,
  deserializeBondingCurve,
  deserializeStatsOracle,
  type PlayerStats,
} from "../app/lib/fanshare-program";

const LUKA_STATS: PlayerStats = { ppg: 33.9, rpg: 9.2, apg: 9.8, spg: 1.4, bpg: 0.5 };

// ── oracleScore ───────────────────────────────────────────────────────────────
describe("oracleScore", () => {
  it("computes weighted score: PPG×1000 + RPG×500 + APG×700 + SPG×800 + BPG×800", () => {
    const score = oracleScore(LUKA_STATS);
    const expected =
      33.9 * 1000 + 9.2 * 500 + 9.8 * 700 + 1.4 * 800 + 0.5 * 800;
    expect(score).toBeCloseTo(expected, 1);
  });

  it("returns 0 for a player with all-zero stats", () => {
    expect(oracleScore({ ppg: 0, rpg: 0, apg: 0, spg: 0, bpg: 0 })).toBe(0);
  });

  it("weights PPG highest (1000×) vs RPG (500×)", () => {
    const ppgHeavy = oracleScore({ ppg: 30, rpg: 0, apg: 0, spg: 0, bpg: 0 });
    const rpgHeavy = oracleScore({ ppg: 0, rpg: 30, apg: 0, spg: 0, bpg: 0 });
    expect(ppgHeavy).toBeGreaterThan(rpgHeavy);
  });
});

// ── tierParams ───────────────────────────────────────────────────────────────
describe("tierParams", () => {
  it("Stars tier (score ≥ 40,000): slope=50, supply=500k", () => {
    const p = tierParams(40_000);
    expect(p.slope).toBe(50n);
    expect(p.totalSupply).toBe(500_000n);
  });

  it("Stars tier applies at exactly 40,000", () => {
    expect(tierParams(40_000).slope).toBe(50n);
  });

  it("Second tier (25,000–39,999): slope=20, supply=750k", () => {
    const p = tierParams(30_000);
    expect(p.slope).toBe(20n);
    expect(p.totalSupply).toBe(750_000n);
  });

  it("Second tier applies at exactly 25,000", () => {
    expect(tierParams(25_000).slope).toBe(20n);
  });

  it("Rising tier (score < 25,000): slope=8, supply=1M", () => {
    const p = tierParams(10_000);
    expect(p.slope).toBe(8n);
    expect(p.totalSupply).toBe(1_000_000n);
  });

  it("Rising tier applies at 0", () => {
    expect(tierParams(0).slope).toBe(8n);
  });
});

// ── veteranBasePrice ──────────────────────────────────────────────────────────
describe("veteranBasePrice", () => {
  it("returns round(score × 0.5) as bigint", () => {
    const score = oracleScore(LUKA_STATS);
    const expected = BigInt(Math.round(score * 0.5));
    expect(veteranBasePrice(LUKA_STATS)).toBe(expected);
  });

  it("is a bigint (safe for on-chain lamports)", () => {
    expect(typeof veteranBasePrice(LUKA_STATS)).toBe("bigint");
  });

  it("returns 0n for all-zero stats", () => {
    expect(veteranBasePrice({ ppg: 0, rpg: 0, apg: 0, spg: 0, bpg: 0 })).toBe(0n);
  });
});

// ── rookieBasePrice ───────────────────────────────────────────────────────────
describe("rookieBasePrice", () => {
  it("pick 1 approaches max (~18,000L)", () => {
    const price = rookieBasePrice(1);
    expect(price).toBeLessThanOrEqual(18_000n);
    expect(price).toBeGreaterThan(17_000n); // close to max
  });

  it("pick 60 is near floor (~300L)", () => {
    const price = rookieBasePrice(60);
    expect(price).toBeLessThan(400n);
    expect(price).toBeGreaterThan(0n);
  });

  it("earlier picks command higher prices than later picks", () => {
    expect(rookieBasePrice(1)).toBeGreaterThan(rookieBasePrice(10));
    expect(rookieBasePrice(10)).toBeGreaterThan(rookieBasePrice(30));
  });

  it("is always a bigint", () => {
    expect(typeof rookieBasePrice(15)).toBe("bigint");
  });

  it("is always below veteran Star prices (pick 1 < 23,440L for Stars-tier vets)", () => {
    // Pick 1 ≈ 17,700L — well below Luka's 23,440L base price
    const pick1 = rookieBasePrice(1);
    const lukaBase = veteranBasePrice(LUKA_STATS);
    expect(pick1).toBeLessThan(lukaBase);
  });
});

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
