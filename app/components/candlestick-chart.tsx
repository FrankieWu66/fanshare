"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import { formatLamportsAsUsd } from "../lib/format";

interface PricePoint {
  t: number; // unix seconds
  p: number; // lamports
}

interface Candle {
  t: number; // bucket start, unix seconds
  o: number; // open (lamports)
  h: number; // high
  l: number; // low
  c: number; // close
  n: number; // sample count in bucket
}

type Timeframe = "1H" | "24H" | "7D" | "ALL";

interface CandlestickChartProps {
  data: PricePoint[];
  currentPrice?: number; // lamports — horizontal ref line (solid, muted)
  fairValuePrice?: number; // lamports — horizontal ref line (dashed, amber)
  height?: number;
  // default tab (caller can control via key/prop)
  defaultTimeframe?: Timeframe;
}

const SOL_REF = 150;
const LAMPORTS_PER_SOL = 1_000_000_000;

// Bucket size in seconds for each timeframe.
// Aims for 20-60 candles visible in the selected window.
const BUCKET_SECONDS: Record<Timeframe, number> = {
  "1H": 60, // 60s buckets → 60 candles in 1h
  "24H": 15 * 60, // 15-min buckets → 96 candles
  "7D": 3 * 3600, // 3-hour buckets → 56 candles
  ALL: 0, // auto — target ~40 candles across full range
};

const WINDOW_SECONDS: Record<Timeframe, number> = {
  "1H": 3600,
  "24H": 24 * 3600,
  "7D": 7 * 24 * 3600,
  ALL: 0,
};

function bucketize(points: PricePoint[], bucketSec: number): Candle[] {
  if (points.length === 0 || bucketSec <= 0) return [];
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const buckets = new Map<number, Candle>();
  for (const pt of sorted) {
    const key = Math.floor(pt.t / bucketSec) * bucketSec;
    const c = buckets.get(key);
    if (!c) {
      buckets.set(key, { t: key, o: pt.p, h: pt.p, l: pt.p, c: pt.p, n: 1 });
    } else {
      c.h = Math.max(c.h, pt.p);
      c.l = Math.min(c.l, pt.p);
      c.c = pt.p;
      c.n += 1;
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

function formatTimeAxis(ts: number, tf: Timeframe): string {
  const d = new Date(ts * 1000);
  if (tf === "1H" || tf === "24H") {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatPriceAxis(lamports: number): string {
  // Compact USD: $4.33, $0.98, $12.4k
  const usd = (lamports / LAMPORTS_PER_SOL) * SOL_REF;
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
  if (usd >= 10) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(2)}`;
}

export function CandlestickChart({
  data,
  currentPrice,
  fairValuePrice,
  height = 200,
  defaultTimeframe = "24H",
}: CandlestickChartProps) {
  const [tf, setTf] = useState<Timeframe>(defaultTimeframe);
  const [hover, setHover] = useState<{ x: number; y: number; candle: Candle } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Filter points to the selected window, then bucket.
  const { candles, yMin, yMax } = useMemo(() => {
    if (data.length === 0) return { candles: [] as Candle[], yMin: 0, yMax: 1 };

    const now = Math.floor(Date.now() / 1000);
    const windowStart = tf === "ALL" ? 0 : now - WINDOW_SECONDS[tf];
    const filtered = data.filter((pt) => pt.t >= windowStart);
    const pts = filtered.length > 0 ? filtered : data; // fall back to full data if filter empty

    // Pick bucket size. ALL mode targets ~40 candles across the full span.
    let bucket = BUCKET_SECONDS[tf];
    if (tf === "ALL" && pts.length > 0) {
      const span = pts[pts.length - 1].t - pts[0].t;
      bucket = Math.max(60, Math.floor(span / 40));
    }

    const c = bucketize(pts, bucket);
    if (c.length === 0) return { candles: [], yMin: 0, yMax: 1 };

    let lo = Infinity;
    let hi = -Infinity;
    for (const k of c) {
      if (k.l < lo) lo = k.l;
      if (k.h > hi) hi = k.h;
    }
    // Also include ref lines in the y-range so they're always visible
    if (currentPrice !== undefined) {
      lo = Math.min(lo, currentPrice);
      hi = Math.max(hi, currentPrice);
    }
    if (fairValuePrice !== undefined) {
      lo = Math.min(lo, fairValuePrice);
      hi = Math.max(hi, fairValuePrice);
    }
    const pad = (hi - lo) * 0.08 || lo * 0.05 || 1;
    return { candles: c, yMin: lo - pad, yMax: hi + pad };
  }, [data, tf, currentPrice, fairValuePrice]);

  // Layout
  const W = 1; // unitless width — we use viewBox for responsiveness
  // We'll use a fixed aspect via viewBox 0 0 VB_W VB_H and let SVG scale.
  const VB_W = 800;
  const VB_H = height;
  const PAD_L = 8;
  const PAD_R = 56; // room for price axis labels
  const PAD_T = 8;
  const PAD_B = 22; // room for time axis labels
  const plotW = VB_W - PAD_L - PAD_R;
  const plotH = VB_H - PAD_T - PAD_B;

  const xFor = useCallback(
    (i: number) => {
      if (candles.length <= 1) return PAD_L + plotW / 2;
      return PAD_L + (i / (candles.length - 1)) * plotW;
    },
    [candles.length, plotW]
  );
  const yFor = useCallback(
    (price: number) => {
      if (yMax === yMin) return PAD_T + plotH / 2;
      return PAD_T + plotH - ((price - yMin) / (yMax - yMin)) * plotH;
    },
    [yMin, yMax, plotH]
  );

  const candleWidth = candles.length > 1 ? Math.max(2, Math.min(14, (plotW / candles.length) * 0.7)) : 10;

  // Axis ticks
  const yTicks = useMemo(() => {
    if (yMax === yMin) return [];
    const n = 4;
    return Array.from({ length: n + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / n);
  }, [yMin, yMax]);
  const xTicks = useMemo(() => {
    if (candles.length === 0) return [];
    const n = Math.min(5, candles.length);
    return Array.from({ length: n }, (_, i) => Math.floor((i * (candles.length - 1)) / (n - 1 || 1)));
  }, [candles.length]);

  // Hover handling — find nearest candle to cursor x
  const onMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || candles.length === 0) return;
      const rect = svgRef.current.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const scale = VB_W / rect.width;
      const svgX = relX * scale;
      // Find nearest candle
      let nearest = 0;
      let minDist = Infinity;
      for (let i = 0; i < candles.length; i++) {
        const cx = xFor(i);
        const d = Math.abs(cx - svgX);
        if (d < minDist) {
          minDist = d;
          nearest = i;
        }
      }
      const c = candles[nearest];
      setHover({ x: xFor(nearest), y: yFor(c.c), candle: c });
    },
    [candles, xFor, yFor]
  );

  const onLeave = useCallback(() => setHover(null), []);

  // Empty state
  if (data.length === 0) {
    return (
      <div style={{ height }} className="flex flex-col items-center justify-center gap-1.5">
        {currentPrice !== undefined && (
          <p className="font-mono text-2xl font-bold tabular-nums">{formatPriceAxis(currentPrice)}</p>
        )}
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted">
          awaiting first trade
        </p>
      </div>
    );
  }

  // Not enough data after bucketing — show big number + label
  if (candles.length < 2) {
    return (
      <div style={{ height }} className="flex flex-col items-center justify-center gap-1.5">
        <p className="font-mono text-2xl font-bold tabular-nums">
          {formatPriceAxis(candles[0]?.c ?? currentPrice ?? 0)}
        </p>
        <p className="font-mono text-[11px] uppercase tracking-wider text-muted">
          chart activates after more trades
        </p>
        <TimeframeTabs value={tf} onChange={setTf} />
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height }}>
      <div className="flex items-center justify-end pb-1.5">
        <TimeframeTabs value={tf} onChange={setTf} />
      </div>
      <div className="relative flex-1">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          width="100%"
          height="100%"
          onMouseMove={onMove}
          onMouseLeave={onLeave}
          style={{ display: "block" }}
        >
          {/* Horizontal gridlines */}
          {yTicks.map((v, i) => (
            <line
              key={`gy-${i}`}
              x1={PAD_L}
              x2={VB_W - PAD_R}
              y1={yFor(v)}
              y2={yFor(v)}
              stroke="var(--color-border-low)"
              strokeWidth={1}
              strokeDasharray={i === 0 || i === yTicks.length - 1 ? undefined : "2 3"}
              opacity={i === 0 || i === yTicks.length - 1 ? 1 : 0.35}
            />
          ))}

          {/* Vertical gridlines at x-ticks */}
          {xTicks.map((idx, i) => (
            <line
              key={`gx-${i}`}
              x1={xFor(idx)}
              x2={xFor(idx)}
              y1={PAD_T}
              y2={VB_H - PAD_B}
              stroke="var(--color-border-low)"
              strokeWidth={1}
              opacity={0.25}
            />
          ))}

          {/* Reference line: fair value (amber dashed) */}
          {fairValuePrice !== undefined && (
            <g>
              <line
                x1={PAD_L}
                x2={VB_W - PAD_R}
                y1={yFor(fairValuePrice)}
                y2={yFor(fairValuePrice)}
                stroke="var(--color-accent)"
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.7}
              />
              <text
                x={VB_W - PAD_R + 4}
                y={yFor(fairValuePrice) + 3}
                fontSize={9}
                fontFamily="var(--font-mono)"
                fill="var(--color-accent)"
                opacity={0.9}
              >
                fair
              </text>
            </g>
          )}

          {/* Reference line: current market (subtle) */}
          {currentPrice !== undefined && (
            <line
              x1={PAD_L}
              x2={VB_W - PAD_R}
              y1={yFor(currentPrice)}
              y2={yFor(currentPrice)}
              stroke="var(--color-foreground)"
              strokeWidth={1}
              strokeDasharray="4 4"
              opacity={0.18}
            />
          )}

          {/* Candles */}
          {candles.map((k, i) => {
            const cx = xFor(i);
            const up = k.c >= k.o;
            const color = up ? "var(--color-positive)" : "var(--color-negative)";
            const yOpen = yFor(k.o);
            const yClose = yFor(k.c);
            const yHigh = yFor(k.h);
            const yLow = yFor(k.l);
            const bodyTop = Math.min(yOpen, yClose);
            const bodyH = Math.max(1, Math.abs(yClose - yOpen));
            return (
              <g key={`c-${i}`}>
                {/* Wick */}
                <line x1={cx} x2={cx} y1={yHigh} y2={yLow} stroke={color} strokeWidth={1} />
                {/* Body */}
                <rect
                  x={cx - candleWidth / 2}
                  y={bodyTop}
                  width={candleWidth}
                  height={bodyH}
                  fill={color}
                  opacity={up ? 0.9 : 0.95}
                />
              </g>
            );
          })}

          {/* Y-axis labels (right) */}
          {yTicks.map((v, i) => (
            <text
              key={`yl-${i}`}
              x={VB_W - PAD_R + 4}
              y={yFor(v) + 3}
              fontSize={9}
              fontFamily="var(--font-mono)"
              fill="var(--color-muted)"
            >
              {formatPriceAxis(v)}
            </text>
          ))}

          {/* X-axis labels (bottom) */}
          {xTicks.map((idx, i) => {
            const x = xFor(idx);
            const align =
              i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle";
            return (
              <text
                key={`xl-${i}`}
                x={x}
                y={VB_H - 6}
                fontSize={9}
                fontFamily="var(--font-mono)"
                fill="var(--color-muted)"
                textAnchor={align as "start" | "middle" | "end"}
              >
                {formatTimeAxis(candles[idx].t, tf)}
              </text>
            );
          })}

          {/* Hover crosshair */}
          {hover && (
            <g pointerEvents="none">
              <line
                x1={hover.x}
                x2={hover.x}
                y1={PAD_T}
                y2={VB_H - PAD_B}
                stroke="var(--color-foreground)"
                strokeWidth={1}
                strokeDasharray="2 2"
                opacity={0.3}
              />
              <circle cx={hover.x} cy={hover.y} r={3} fill="var(--color-accent)" />
            </g>
          )}
        </svg>

        {/* Hover tooltip (HTML overlay, positioned via svg coords) */}
        {hover && (
          <div
            className="pointer-events-none absolute rounded-md border border-border-low bg-card px-2 py-1.5 font-mono text-[10px] shadow-lg"
            style={{
              left: `${(hover.x / VB_W) * 100}%`,
              top: 4,
              transform: hover.x > VB_W * 0.6 ? "translateX(calc(-100% - 8px))" : "translateX(8px)",
            }}
          >
            <div className="mb-0.5 text-muted">{formatTimeAxis(hover.candle.t, tf)}</div>
            <div className="flex gap-2">
              <span className="text-muted">O</span>
              <span className="tabular-nums">{formatPriceAxis(hover.candle.o)}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted">H</span>
              <span className="tabular-nums text-positive">{formatPriceAxis(hover.candle.h)}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted">L</span>
              <span className="tabular-nums text-negative">{formatPriceAxis(hover.candle.l)}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted">C</span>
              <span
                className={`tabular-nums font-semibold ${
                  hover.candle.c >= hover.candle.o ? "text-positive" : "text-negative"
                }`}
              >
                {formatPriceAxis(hover.candle.c)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TimeframeTabs({
  value,
  onChange,
}: {
  value: Timeframe;
  onChange: (v: Timeframe) => void;
}) {
  const tabs: Timeframe[] = ["1H", "24H", "7D", "ALL"];
  return (
    <div className="flex gap-0.5 rounded-md border border-border-low p-0.5">
      {tabs.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={`min-w-[36px] rounded px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide transition ${
            value === t
              ? "bg-accent/15 text-accent"
              : "text-muted hover:text-foreground"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

// Re-export type for callers
export type { PricePoint as CandlestickPoint };

// Keep a compact sparkline variant for the invite page ticker / cards.
// Renders a single-row line chart in amber — no axes, no tooltip.
export function Sparkline({
  data,
  height = 28,
  width = 96,
  color = "var(--color-accent)",
}: {
  data: number[];
  height?: number;
  width?: number;
  color?: string;
}) {
  if (data.length < 2) {
    return <svg width={width} height={height} />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
