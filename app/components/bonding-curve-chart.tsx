"use client";

import { calculateTokensForSol } from "../lib/bonding-curve";
import { formatLamports } from "../lib/format";

interface BondingCurveChartProps {
  basePrice: bigint;
  slope: bigint;
  tokensSold: bigint;
  totalSupply: bigint;
  indexPriceLamports?: bigint;
  /** SOL amount user is typing in the trade widget (in lamports). Shows preview dot. */
  inputLamports?: bigint;
}

// Chart layout constants
const W = 480;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 40, left: 56 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

function num(n: bigint): number {
  return Number(n);
}

export function BondingCurveChart({
  basePrice,
  slope,
  tokensSold,
  totalSupply,
  indexPriceLamports,
  inputLamports,
}: BondingCurveChartProps) {
  const supply = num(totalSupply);
  const sold = num(tokensSold);
  const base = num(basePrice);
  const sl = num(slope);

  // Price at any token count
  const priceAt = (tokens: number) => base + sl * tokens;

  const minPrice = base;
  const maxPrice = priceAt(supply);
  const priceRange = maxPrice - minPrice || 1;

  // Map token count → SVG x coordinate
  const xOf = (tokens: number) => PAD.left + (tokens / supply) * INNER_W;

  // Map price → SVG y coordinate (inverted: high price = low y)
  const yOf = (price: number) =>
    PAD.top + INNER_H - ((price - minPrice) / priceRange) * INNER_H;

  // Build polyline points for the full curve
  const STEPS = 60;
  const curvePoints: [number, number][] = Array.from({ length: STEPS + 1 }, (_, i) => {
    const t = (i / STEPS) * supply;
    return [xOf(t), yOf(priceAt(t))];
  });

  const toSvgPath = (pts: [number, number][]) =>
    pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  // Filled area: from 0 → tokensSold (purchased region)
  const soldFraction = supply > 0 ? Math.min(sold / supply, 1) : 0;
  const soldSteps = Math.max(1, Math.round(soldFraction * STEPS));
  const soldArea: [number, number][] = [
    [xOf(0), yOf(minPrice)], // bottom-left
    ...Array.from({ length: soldSteps + 1 }, (_, i) => {
      const t = (i / soldSteps) * sold;
      return [xOf(t), yOf(priceAt(t))] as [number, number];
    }),
    [xOf(sold), yOf(minPrice)], // bottom-right of sold region
  ];

  // Current price marker
  const currentPrice = priceAt(sold);
  const dotX = xOf(sold);
  const dotY = yOf(currentPrice);

  // Preview dot — shows projected position when user is typing a trade amount
  const previewTokens = inputLamports && inputLamports > 0n
    ? num(calculateTokensForSol(basePrice, slope, tokensSold, inputLamports, totalSupply))
    : 0;
  const previewSold = sold + previewTokens;
  const previewDotX = previewTokens > 0 ? xOf(Math.min(previewSold, supply)) : null;
  const previewDotY = previewTokens > 0 ? yOf(priceAt(Math.min(previewSold, supply))) : null;

  // Y-axis grid lines (4 ticks)
  const yTicks = [0, 0.33, 0.67, 1].map((frac) => {
    const price = minPrice + frac * priceRange;
    return { y: yOf(price), label: formatLamports(price) };
  });

  // X-axis ticks (3: 0%, 50%, 100%)
  const xTicks = [0, 0.5, 1].map((frac) => ({
    x: PAD.left + frac * INNER_W,
    label: `${(frac * 100).toFixed(0)}%`,
  }));

  // Index price line
  const indexY = indexPriceLamports && indexPriceLamports > 0n
    ? yOf(num(indexPriceLamports))
    : null;
  // Clamp index line to chart area
  const indexYClamped =
    indexY !== null
      ? Math.max(PAD.top, Math.min(PAD.top + INNER_H, indexY))
      : null;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ aspectRatio: `${W} / ${H}` }}
        aria-label="Bonding curve price chart"
      >
        {/* Grid lines */}
        {yTicks.map((t, i) => (
          <line
            key={i}
            x1={PAD.left}
            y1={t.y}
            x2={PAD.left + INNER_W}
            y2={t.y}
            stroke="var(--color-border-low)"
            strokeWidth="1"
          />
        ))}

        {/* Filled area (tokens sold) */}
        {sold > 0 && (
          <path
            d={
              toSvgPath(soldArea) + " Z"
            }
            fill="var(--color-accent)"
            opacity="0.12"
          />
        )}

        {/* Full bonding curve line */}
        <path
          d={toSvgPath(curvePoints)}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="2"
          strokeLinecap="round"
        />

        {/* Index price dashed line */}
        {indexYClamped !== null && (
          <>
            <line
              x1={PAD.left}
              y1={indexYClamped}
              x2={PAD.left + INNER_W}
              y2={indexYClamped}
              stroke="var(--color-foreground)"
              strokeWidth="1"
              strokeDasharray="4 4"
              opacity="0.35"
            />
            <text
              x={PAD.left + INNER_W - 4}
              y={indexYClamped - 4}
              textAnchor="end"
              fontSize="9"
              fill="var(--color-muted)"
              fontFamily="var(--font-mono)"
            >
              index
            </text>
          </>
        )}

        {/* Current position vertical line */}
        {sold > 0 && (
          <line
            x1={dotX}
            y1={PAD.top}
            x2={dotX}
            y2={PAD.top + INNER_H}
            stroke="var(--color-accent)"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.5"
          />
        )}

        {/* Current price dot */}
        {sold > 0 && (
          <>
            <circle cx={dotX} cy={dotY} r="5" fill="var(--color-accent)" opacity="0.25" />
            <circle cx={dotX} cy={dotY} r="3" fill="var(--color-accent)" />
          </>
        )}

        {/* Y-axis labels */}
        {yTicks.map((t, i) => (
          <text
            key={i}
            x={PAD.left - 6}
            y={t.y + 3.5}
            textAnchor="end"
            fontSize="9"
            fill="var(--color-muted)"
            fontFamily="var(--font-mono)"
          >
            {t.label}
          </text>
        ))}

        {/* X-axis labels */}
        {xTicks.map((t, i) => (
          <text
            key={i}
            x={t.x}
            y={PAD.top + INNER_H + 14}
            textAnchor="middle"
            fontSize="9"
            fill="var(--color-muted)"
            fontFamily="var(--font-mono)"
          >
            {t.label}
          </text>
        ))}

        {/* Axis lines */}
        <line
          x1={PAD.left}
          y1={PAD.top}
          x2={PAD.left}
          y2={PAD.top + INNER_H}
          stroke="var(--color-border)"
          strokeWidth="1"
        />
        <line
          x1={PAD.left}
          y1={PAD.top + INNER_H}
          x2={PAD.left + INNER_W}
          y2={PAD.top + INNER_H}
          stroke="var(--color-border)"
          strokeWidth="1"
        />

        {/* X-axis label */}
        <text
          x={PAD.left + INNER_W / 2}
          y={H - 4}
          textAnchor="middle"
          fontSize="9"
          fill="var(--color-muted)"
          fontFamily="var(--font-mono)"
        >
          supply distributed
        </text>

        {/* Preview dot — projected position for typed trade amount */}
        {previewDotX !== null && previewDotY !== null && (
          <>
            <circle
              cx={previewDotX}
              cy={previewDotY}
              r="7"
              fill="var(--color-accent)"
              opacity="0.15"
            />
            <circle
              cx={previewDotX}
              cy={previewDotY}
              r="4"
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="2"
              opacity="0.8"
            />
            <circle
              cx={previewDotX}
              cy={previewDotY}
              r="2"
              fill="var(--color-accent)"
            />
          </>
        )}
      </svg>
    </div>
  );
}

// formatLamports imported from app/lib/format.ts
