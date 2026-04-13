/**
 * Local price history — stored in localStorage per player.
 * Used to show a price chart when the Vercel KV backend is not provisioned.
 */

type PricePoint = { t: number; p: number }; // unix seconds, lamports

const STORAGE_PREFIX = "fanshare_prices_";
const MAX_POINTS = 200;

export function recordLocalPrice(playerId: string, priceLamports: bigint): void {
  if (typeof window === "undefined") return;
  const key = STORAGE_PREFIX + playerId;
  const existing = loadLocalPriceHistory(playerId);
  const point: PricePoint = {
    t: Math.floor(Date.now() / 1000),
    p: Number(priceLamports),
  };
  const updated = [...existing, point].slice(-MAX_POINTS);
  localStorage.setItem(key, JSON.stringify(updated));
}

export function loadLocalPriceHistory(playerId: string): PricePoint[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + playerId);
    return raw ? (JSON.parse(raw) as PricePoint[]) : [];
  } catch {
    return [];
  }
}

/**
 * Merge API price history with local price history.
 * Deduplicates by timestamp (within 60s) and sorts ascending.
 */
export function mergePriceHistory(
  apiPoints: PricePoint[],
  localPoints: PricePoint[]
): PricePoint[] {
  const all = [...apiPoints, ...localPoints];
  // Sort ascending
  all.sort((a, b) => a.t - b.t);
  // Deduplicate: remove points within 60s of the previous
  const deduped: PricePoint[] = [];
  for (const pt of all) {
    const last = deduped[deduped.length - 1];
    if (!last || pt.t - last.t >= 60) {
      deduped.push(pt);
    }
  }
  return deduped;
}
