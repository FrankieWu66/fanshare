import { describe, it, expect } from "vitest";
import {
  calculateBuyCost,
  calculateSellReturn,
  calculateTokensForSol,
  currentPrice,
  calculateSpread,
  formatSol,
  PARITY_VECTORS,
} from "../app/lib/bonding-curve";

// ── Locked constants (must match Rust program) ────────────────────────────────
const BASE_PRICE = 1000n;
const SLOPE = 10n;
const TOTAL_SUPPLY = 1_000_000n;

// ── Cross-language parity vectors ─────────────────────────────────────────────
describe("calculateBuyCost — parity vectors (must match Rust)", () => {
  PARITY_VECTORS.forEach(({ basePrice, slope, tokensSold, amount, expectedCost }) => {
    it(`base=${basePrice} slope=${slope} sold=${tokensSold} amount=${amount} → ${expectedCost}`, () => {
      expect(calculateBuyCost(basePrice, slope, tokensSold, amount)).toBe(expectedCost);
    });
  });
});

// ── currentPrice ─────────────────────────────────────────────────────────────
describe("currentPrice", () => {
  it("at genesis (0 tokens sold) = base_price", () => {
    expect(currentPrice(BASE_PRICE, SLOPE, 0n)).toBe(1000n);
  });

  it("increases linearly with tokens sold", () => {
    expect(currentPrice(BASE_PRICE, SLOPE, 100n)).toBe(2000n);
    expect(currentPrice(BASE_PRICE, SLOPE, 1000n)).toBe(11000n);
  });

  it("at full supply is base + slope * total_supply", () => {
    expect(currentPrice(BASE_PRICE, SLOPE, TOTAL_SUPPLY)).toBe(
      BASE_PRICE + SLOPE * TOTAL_SUPPLY
    );
  });
});

// ── calculateBuyCost ─────────────────────────────────────────────────────────
describe("calculateBuyCost", () => {
  it("buying 1 token at genesis costs exactly base_price", () => {
    expect(calculateBuyCost(BASE_PRICE, SLOPE, 0n, 1n)).toBe(1000n);
  });

  it("buying 0 tokens costs 0", () => {
    expect(calculateBuyCost(BASE_PRICE, SLOPE, 0n, 0n)).toBe(0n);
  });

  it("cost increases when starting from a higher tokensSold", () => {
    const costAt0 = calculateBuyCost(BASE_PRICE, SLOPE, 0n, 10n);
    const costAt500 = calculateBuyCost(BASE_PRICE, SLOPE, 500n, 10n);
    expect(costAt500).toBeGreaterThan(costAt0);
  });

  it("buying in two steps costs the same as buying in one step", () => {
    const oneShot = calculateBuyCost(BASE_PRICE, SLOPE, 0n, 20n);
    const step1 = calculateBuyCost(BASE_PRICE, SLOPE, 0n, 10n);
    const step2 = calculateBuyCost(BASE_PRICE, SLOPE, 10n, 10n);
    expect(step1 + step2).toBe(oneShot);
  });
});

// ── calculateSellReturn ───────────────────────────────────────────────────────
describe("calculateSellReturn", () => {
  it("buy then sell same amount returns same SOL (no fees)", () => {
    const amount = 100n;
    const buyCost = calculateBuyCost(BASE_PRICE, SLOPE, 0n, amount);
    const sellReturn = calculateSellReturn(BASE_PRICE, SLOPE, amount, amount);
    expect(sellReturn).toBe(buyCost);
  });

  it("selling from higher supply returns more SOL", () => {
    const sellFrom100 = calculateSellReturn(BASE_PRICE, SLOPE, 100n, 10n);
    const sellFrom500 = calculateSellReturn(BASE_PRICE, SLOPE, 500n, 10n);
    expect(sellFrom500).toBeGreaterThan(sellFrom100);
  });
});

// ── calculateTokensForSol ─────────────────────────────────────────────────────
describe("calculateTokensForSol", () => {
  it("returns 0 when solAmount is 0", () => {
    expect(calculateTokensForSol(BASE_PRICE, SLOPE, 0n, 0n, TOTAL_SUPPLY)).toBe(0n);
  });

  it("returns 0 when supply is exhausted", () => {
    expect(
      calculateTokensForSol(BASE_PRICE, SLOPE, TOTAL_SUPPLY, 1_000_000_000n, TOTAL_SUPPLY)
    ).toBe(0n);
  });

  it("tokens out × buy cost ≤ solAmount (never overspends)", () => {
    const solAmount = 1_000_000_000n; // 1 SOL
    const tokens = calculateTokensForSol(BASE_PRICE, SLOPE, 0n, solAmount, TOTAL_SUPPLY);
    const cost = calculateBuyCost(BASE_PRICE, SLOPE, 0n, tokens);
    expect(cost).toBeLessThanOrEqual(solAmount);
  });

  it("one more token would exceed the budget", () => {
    const solAmount = 1_000_000_000n;
    const tokens = calculateTokensForSol(BASE_PRICE, SLOPE, 0n, solAmount, TOTAL_SUPPLY);
    if (tokens + 1n <= TOTAL_SUPPLY) {
      const costPlusOne = calculateBuyCost(BASE_PRICE, SLOPE, 0n, tokens + 1n);
      expect(costPlusOne).toBeGreaterThan(solAmount);
    }
  });
});

// ── calculateSpread ───────────────────────────────────────────────────────────
describe("calculateSpread", () => {
  it("returns 0 when index price is 0 (no oracle data)", () => {
    expect(calculateSpread(5000n, 0n)).toBe(0);
  });

  it("returns 0 when market === index (fair value)", () => {
    expect(calculateSpread(5000n, 5000n)).toBe(0);
  });

  it("returns negative when market < index (undervalued)", () => {
    expect(calculateSpread(4000n, 5000n)).toBe(-20);
  });

  it("returns positive when market > index (overvalued)", () => {
    expect(calculateSpread(6000n, 5000n)).toBe(20);
  });
});

// ── formatSol ─────────────────────────────────────────────────────────────────
describe("formatSol", () => {
  it("formats 0 lamports as '0'", () => {
    expect(formatSol(0n)).toBe("0");
  });

  it("formats 1 SOL correctly", () => {
    expect(formatSol(1_000_000_000n)).toBe("1");
  });

  it("formats partial SOL and trims trailing zeros", () => {
    expect(formatSol(1_500_000_000n)).toBe("1.5");
  });

  it("returns '<0.000001' for dust amounts", () => {
    expect(formatSol(1n)).toBe("<0.000001");
  });
});
