/**
 * Atomic RPUSH + LTRIM for price history via Upstash REST pipeline.
 *
 * Prior implementation fired two separate HTTP calls. If the LTRIM request
 * failed (rate limit / timeout) the list grew unbounded. The `/pipeline`
 * endpoint wraps multiple commands in one atomic round-trip.
 *
 * Spec: https://upstash.com/docs/redis/features/restapi#pipelining
 */

export const PRICE_HISTORY_MAX = 500;

type KvFetch = typeof fetch;

/**
 * RPUSH `entry` to `key` and LTRIM to the last `maxLen` items — atomically.
 * Safe to no-op when KV is not configured.
 */
export async function pushPriceHistoryEntry(
  key: string,
  entry: string,
  opts: { kvUrl?: string; kvToken?: string; maxLen?: number; fetchImpl?: KvFetch } = {},
): Promise<Response | null> {
  const kvUrl = opts.kvUrl ?? process.env.KV_REST_API_URL;
  const kvToken = opts.kvToken ?? process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return null;

  const maxLen = opts.maxLen ?? PRICE_HISTORY_MAX;
  const fetchImpl = opts.fetchImpl ?? fetch;

  return fetchImpl(`${kvUrl}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${kvToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["RPUSH", key, entry],
      ["LTRIM", key, `-${maxLen}`, "-1"],
    ]),
  });
}
