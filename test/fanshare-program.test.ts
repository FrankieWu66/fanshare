import { describe, it, expect } from "vitest";
import {
  oracleScore,
  tierParams,
  veteranBasePrice,
  rookieBasePrice,
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
