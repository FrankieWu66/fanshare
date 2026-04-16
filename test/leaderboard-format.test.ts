import { describe, it, expect } from "vitest";
import { formatLeaderboardScore } from "../app/lib/leaderboard-format";

describe("formatLeaderboardScore — top-traders", () => {
  // QA ISSUE-001 regression: negative PnL must show a minus sign.
  // API returns score in lamports; $150/SOL conversion.
  //   -50_000_000 lamports = -0.05 SOL = -$7.50
  //   -120_000_000 lamports = -0.12 SOL = -$18.00

  it("prefixes positive PnL with '+'", () => {
    expect(formatLeaderboardScore(245_000_000, "top-traders")).toBe("+$36.75");
  });

  it("prefixes negative PnL with '-' (regression: ISSUE-001)", () => {
    expect(formatLeaderboardScore(-50_000_000, "top-traders")).toBe("-$7.50");
  });

  it("handles large negative PnL correctly (regression: ISSUE-001)", () => {
    expect(formatLeaderboardScore(-120_000_000, "top-traders")).toBe("-$18.00");
  });

  it("formats zero as positive (+$0.00)", () => {
    expect(formatLeaderboardScore(0, "top-traders")).toBe("+$0.00");
  });

  it("rounds to two decimals", () => {
    // 1 lamport = 1.5e-7 dollars; 3_333_333 lamports ≈ $0.50
    expect(formatLeaderboardScore(3_333_333, "top-traders")).toBe("+$0.50");
  });
});

describe("formatLeaderboardScore — sharp-calls", () => {
  it("formats score with one decimal, no sign", () => {
    expect(formatLeaderboardScore(12.34, "sharp-calls")).toBe("12.3");
  });

  it("formats integer scores", () => {
    expect(formatLeaderboardScore(42, "sharp-calls")).toBe("42.0");
  });

  it("does not apply SOL conversion to sharp-calls scores", () => {
    expect(formatLeaderboardScore(1_000_000_000, "sharp-calls")).toBe("1000000000.0");
  });
});
