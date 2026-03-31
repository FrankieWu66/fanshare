"use client";

import Link from "next/link";
import type { PlayerMarketData } from "../lib/fanshare-program";
import { formatSol } from "../lib/bonding-curve";

interface PlayerCardProps {
  player: PlayerMarketData;
}

export function PlayerCard({ player }: PlayerCardProps) {
  const { config, currentPrice, spreadPercent, curve, oracle } = player;
  const tokensSold = curve?.tokensSold ?? 0n;
  const totalSupply = curve?.totalSupply ?? 1000000n;
  const supplyPercent = Number((tokensSold * 100n) / totalSupply);
  const indexPrice = oracle?.indexPriceLamports ?? 0n;

  const isUndervalued = spreadPercent < 0;
  const spreadColor = isUndervalued
    ? "text-emerald-500"
    : spreadPercent > 0
      ? "text-red-400"
      : "text-muted";

  return (
    <Link
      href={`/trade/${config.id}`}
      className="group relative overflow-hidden rounded-2xl border border-border-low bg-card p-5 transition-all hover:border-border hover:shadow-lg"
    >
      {/* Player header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{config.emoji}</span>
          <div>
            <h3 className="font-semibold text-foreground">
              {config.displayName}
            </h3>
            <p className="text-xs text-muted">{config.id}</p>
          </div>
        </div>
        {isUndervalued && (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500">
            Undervalued
          </span>
        )}
      </div>

      {/* Price */}
      <div className="mt-4">
        <p className="font-mono text-2xl font-bold tabular-nums tracking-tight">
          {formatSol(currentPrice)}
          <span className="ml-1 text-sm font-normal text-muted">SOL</span>
        </p>
      </div>

      {/* Stats row */}
      <div className="mt-3 grid grid-cols-3 gap-3 border-t border-border-low pt-3">
        <div>
          <p className="text-xs text-muted">Stats Index</p>
          <p className="font-mono text-sm font-medium tabular-nums">
            {indexPrice > 0n ? formatSol(indexPrice) : "--"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">Spread</p>
          <p className={`font-mono text-sm font-medium tabular-nums ${spreadColor}`}>
            {indexPrice > 0n
              ? `${spreadPercent > 0 ? "+" : ""}${spreadPercent.toFixed(1)}%`
              : "--"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">Supply</p>
          <p className="font-mono text-sm font-medium tabular-nums">
            {supplyPercent.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Supply bar */}
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border-low">
        <div
          className="h-full rounded-full bg-foreground/30 transition-all"
          style={{ width: `${Math.min(supplyPercent, 100)}%` }}
        />
      </div>

      {/* Hover arrow */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
        <span className="text-muted">&rarr;</span>
      </div>
    </Link>
  );
}
