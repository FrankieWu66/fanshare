/**
 * Linear Bonding Curve Math — TypeScript mirror of Rust on-chain logic.
 * MUST match programs/fanshare/src/lib.rs exactly (cross-language parity).
 *
 * price(x) = base_price + slope * x
 * cost(s, n) = n * base_price + slope * n * (2s + n - 1) / 2
 *
 * All values in lamports (u64). Uses BigInt for overflow safety.
 */

/** Calculate SOL cost to buy `amount` tokens starting from `tokensSold`. */
export function calculateBuyCost(
  basePrice: bigint,
  slope: bigint,
  tokensSold: bigint,
  amount: bigint
): bigint {
  const n = amount;
  const b = basePrice;
  const k = slope;
  const s = tokensSold;

  const baseCost = n * b;
  const sumTerm = 2n * s + n - 1n;
  const slopeCost = (k * n * sumTerm) / 2n;

  return baseCost + slopeCost;
}

/** Calculate SOL returned when selling `amount` tokens from `tokensSold`. */
export function calculateSellReturn(
  basePrice: bigint,
  slope: bigint,
  tokensSold: bigint,
  amount: bigint
): bigint {
  if (amount > tokensSold)
    throw new RangeError(
      `Cannot sell ${amount} tokens — only ${tokensSold} on curve`
    );
  const newSold = tokensSold - amount;
  return calculateBuyCost(basePrice, slope, newSold, amount);
}

/** Calculate how many whole tokens can be bought with `solAmount` SOL. Binary search. */
export function calculateTokensForSol(
  basePrice: bigint,
  slope: bigint,
  tokensSold: bigint,
  solAmount: bigint,
  totalSupply: bigint
): bigint {
  const maxBuyable = totalSupply - tokensSold;
  if (maxBuyable <= 0n) return 0n;

  let lo = 0n;
  let hi = maxBuyable;

  while (lo < hi) {
    const mid = lo + (hi - lo + 1n) / 2n;
    const cost = calculateBuyCost(basePrice, slope, tokensSold, mid);
    if (cost <= solAmount) {
      lo = mid;
    } else {
      hi = mid - 1n;
    }
  }

  return lo;
}

/** Current marginal price (price of the next token). */
export function currentPrice(
  basePrice: bigint,
  slope: bigint,
  tokensSold: bigint
): bigint {
  return basePrice + slope * tokensSold;
}

/** Convert lamports to SOL display string (up to 6 decimal places). */
export function lamportsToSol(lamports: bigint): number {
  return Number(lamports) / 1_000_000_000;
}

/** Format SOL amount for display. */
export function formatSol(lamports: bigint, decimals = 6): string {
  const sol = lamportsToSol(lamports);
  if (sol === 0) return "0";
  if (sol < 0.000001) return "<0.000001";
  return sol.toFixed(decimals).replace(/\.?0+$/, "");
}

/** Format large token amounts with commas. */
export function formatTokens(amount: bigint): string {
  return amount.toLocaleString();
}

/**
 * Calculate spread between market price and stats index.
 * Returns percentage: positive = overvalued, negative = undervalued.
 */
export function calculateSpread(
  marketPriceLamports: bigint,
  indexPriceLamports: bigint
): number {
  if (indexPriceLamports === 0n) return 0;
  return (
    ((Number(marketPriceLamports) - Number(indexPriceLamports)) /
      Number(indexPriceLamports)) *
    100
  );
}

// ============================================================================
// Cross-language parity test vectors (must match Rust tests exactly)
// ============================================================================
export const PARITY_VECTORS: Array<{
  basePrice: bigint;
  slope: bigint;
  tokensSold: bigint;
  amount: bigint;
  expectedCost: bigint;
}> = [
  { basePrice: 1000n, slope: 10n, tokensSold: 0n, amount: 1n, expectedCost: 1000n },
  { basePrice: 1000n, slope: 10n, tokensSold: 0n, amount: 10n, expectedCost: 10450n },
  { basePrice: 1000n, slope: 10n, tokensSold: 100n, amount: 5n, expectedCost: 10100n },
  { basePrice: 1000n, slope: 10n, tokensSold: 0n, amount: 1000000n, expectedCost: 5000995000000n },
  { basePrice: 5000n, slope: 5n, tokensSold: 500n, amount: 100n, expectedCost: 774750n },
];
