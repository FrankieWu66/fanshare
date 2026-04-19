"use client";

import Link from "next/link";
import type { PlayerMarketData } from "../lib/fanshare-program";
import { formatUsd } from "../lib/oracle-weights";

interface PlayerCardProps {
  player: PlayerMarketData;
}

export function PlayerCard({ player }: PlayerCardProps) {
  const { config, currentPrice, spreadPercent, curve, oracle } = player;
  const tokensSold = curve?.tokensSold ?? 0n;
  const totalSupply = curve?.totalSupply ?? 5000n;
  const supplyPercent = totalSupply > 0n ? (Number(tokensSold) / Number(totalSupply)) * 100 : 0;
  const indexPrice = oracle?.indexPriceLamports ?? 0n;
  const treasuryLamports = curve?.treasuryLamports ?? 0n;

  const isUndervalued = spreadPercent < 0;
  const isOvervalued = spreadPercent > 5;

  const spreadColor = isUndervalued
    ? "text-accent"
    : isOvervalued
      ? "text-negative"
      : "text-muted";

  const spreadBadge = isUndervalued
    ? { text: "Undervalued", color: "text-accent", bg: "bg-accent-subtle" }
    : isOvervalued
      ? { text: "Overvalued", color: "text-negative", bg: "bg-negative/10" }
      : null;

  return (
    <Link
      href={`/trade/${config.id}`}
      className="group relative overflow-hidden rounded-xl border border-border-low bg-card p-5 transition-all duration-150 hover:-translate-y-px hover:border-accent/40 hover:shadow-lg hover:shadow-accent/5"
    >
      {/* Player header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/[0.08] text-2xl">
            {config.emoji}
          </span>
          <div>
            <h3 className="font-semibold text-foreground">
              {config.displayName}
            </h3>
            <p className="font-mono text-[11px] text-muted">{config.id.replace("Player_", "$")}</p>
          </div>
        </div>
        {spreadBadge && (
          <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${spreadBadge.color} ${spreadBadge.bg}`}>
            {spreadBadge.text}
          </span>
        )}
      </div>

      {/* Price */}
      <div className="mt-4">
        <p className="font-mono text-2xl font-bold tabular-nums tracking-tight">
          {formatUsd(currentPrice)}
        </p>
      </div>

      {/* Stats row */}
      <div className="mt-3 grid grid-cols-3 gap-3 border-t border-border-low pt-3">
        <div>
          <p className="text-[11px] text-muted">Stats Index</p>
          <p className="font-mono text-sm font-medium tabular-nums">
            {indexPrice > 0n ? formatUsd(indexPrice) : "--"}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted">Spread</p>
          <p className={`font-mono text-sm font-medium tabular-nums ${spreadColor}`}>
            {indexPrice > 0n
              ? `${spreadPercent > 0 ? "+" : ""}${spreadPercent.toFixed(1)}%`
              : "--"}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted">Tokens sold</p>
          <p className="font-mono text-sm font-medium tabular-nums">
            {Number(tokensSold).toLocaleString()}/{Number(totalSupply).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Supply bar — amber fill per design system */}
      <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-border-low">
        <div
          className="h-full rounded-full bg-accent/60 transition-all"
          style={{ width: `${Math.max(supplyPercent > 0 ? 1 : 0, Math.min(supplyPercent, 100))}%` }}
        />
      </div>

      {/* Treasury — proof the curve is self-funding exits */}
      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-[11px] text-muted">Treasury</span>
        <span className="font-mono text-xs font-medium tabular-nums text-foreground">
          {formatUsd(treasuryLamports)}
        </span>
      </div>

      {/* Hover arrow */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
        <span className="text-accent">&rarr;</span>
      </div>
    </Link>
  );
}
