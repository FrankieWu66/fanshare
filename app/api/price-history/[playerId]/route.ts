/**
 * GET /api/price-history/[playerId]?cluster=<moniker>
 *
 * Returns the last 500 index price snapshots for a player from Vercel KV.
 * Each entry: { t: number (unix seconds), p: number (lamports) }
 *
 * cluster defaults to "localnet" when omitted.
 * Returns [] when KV is not configured (local dev without KV credentials).
 */

import { NextRequest, NextResponse } from "next/server";

const VALID_CLUSTERS = ["localnet", "devnet", "testnet", "mainnet"] as const;
type ClusterMoniker = (typeof VALID_CLUSTERS)[number];

interface PricePoint {
  t: number; // unix timestamp (seconds)
  p: number; // index price in lamports
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ playerId: string }> }
) {
  const { playerId } = await params;

  // Validate playerId format (e.g. "Player_LD")
  if (!/^Player_[A-Za-z0-9_]+$/.test(playerId)) {
    return NextResponse.json({ error: "Invalid playerId" }, { status: 400 });
  }

  // Cluster query param — determines which KV namespace to read from
  const clusterParam = req.nextUrl.searchParams.get("cluster") ?? "localnet";
  const cluster: ClusterMoniker = (VALID_CLUSTERS as readonly string[]).includes(clusterParam)
    ? (clusterParam as ClusterMoniker)
    : "localnet";

  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_READ_ONLY_TOKEN ?? process.env.KV_REST_API_TOKEN;

  // Return empty array when KV is not configured (local dev)
  if (!kvUrl || !kvToken) {
    return NextResponse.json([], { headers: { "Cache-Control": "no-store" } });
  }

  const key = `price-history:${cluster}:${playerId}`;
  // LRANGE to fetch all 500 entries (0 to -1 = full list, capped at 500 by oracle LTRIM)
  const res = await fetch(`${kvUrl}/lrange/${encodeURIComponent(key)}/0/-1`, {
    headers: { Authorization: `Bearer ${kvToken}` },
    next: { revalidate: 30 }, // cache 30s — oracle runs every 5 min
  });

  if (!res.ok) {
    console.error(`[price-history] KV error ${res.status} for ${playerId}`);
    return NextResponse.json([], { status: 503 });
  }

  const json = await res.json();
  const rawEntries: string[] = json.result ?? [];

  const points: PricePoint[] = rawEntries
    .map((raw) => {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.t !== "number" || typeof parsed?.p !== "number") return null;
        return parsed as PricePoint;
      } catch {
        return null;
      }
    })
    .filter((p): p is PricePoint => p !== null);

  return NextResponse.json(points, {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
  });
}
