"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface PricePoint {
  t: number; // unix timestamp (seconds)
  p: number; // price in lamports
}

interface PriceHistoryChartProps {
  data: PricePoint[];
  currentPrice?: number; // lamports — draws a horizontal reference line
}

function formatLamports(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(0);
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diffHours = (now.getTime() - d.getTime()) / 3_600_000;
  if (diffHours < 24) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function PriceHistoryChart({ data, currentPrice }: PriceHistoryChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[164px] items-center justify-center">
        <p className="font-mono text-xs text-muted">No price history yet</p>
      </div>
    );
  }

  // Downsample to at most 120 points for performance
  const sampled =
    data.length <= 120
      ? data
      : data.filter((_, i) => i % Math.ceil(data.length / 120) === 0);

  const prices = sampled.map((p) => p.p);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const pad = (maxP - minP) * 0.1 || minP * 0.05 || 1;

  return (
    <div style={{ width: "100%", height: 164 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={sampled} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="t"
            tickFormatter={formatTime}
            tick={{ fontSize: 9, fill: "var(--color-muted)", fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[minP - pad, maxP + pad]}
            tickFormatter={formatLamports}
            tick={{ fontSize: 9, fill: "var(--color-muted)", fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const pt = payload[0].payload as PricePoint;
              return (
                <div className="rounded-lg border border-border-low bg-card px-2.5 py-1.5 shadow-lg">
                  <p className="font-mono text-xs text-muted">{formatTime(pt.t)}</p>
                  <p className="font-mono text-sm font-semibold text-foreground">
                    {formatLamports(pt.p)} lam
                  </p>
                </div>
              );
            }}
          />
          {currentPrice !== undefined && (
            <ReferenceLine
              y={currentPrice}
              stroke="var(--color-foreground)"
              strokeDasharray="4 4"
              strokeOpacity={0.35}
              strokeWidth={1}
            />
          )}
          <Line
            type="monotone"
            dataKey="p"
            stroke="var(--color-accent)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, fill: "var(--color-accent)" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
