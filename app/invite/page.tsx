"use client";

import { useState } from "react";
import Link from "next/link";
import { useWallet } from "../lib/wallet/context";
import { useBalance } from "../lib/hooks/use-balance";
import { usePlayerMarkets } from "../lib/hooks/use-player-markets";
import { DemoSignin } from "../components/demo-signin";
import { StaticBadge } from "../components/badge";
import { formatUsd } from "../lib/oracle-weights";

/**
 * Demo 1 invite landing page.
 *
 * Single-viewport hero on desktop: big display type, live market ticker,
 * amber primary CTA, ghost secondary, inline locked-badge row. The goal is a
 * "trading floor on first paint" feel — not a numbered marketing checklist.
 *
 * If the visitor is disconnected: primary CTA opens DemoSignin modal which
 * hits /api/demo/register and transfers 0.667 SOL from the deploy wallet.
 *
 * If connected: primary CTA links straight to /trade/Player_LBJ.
 */

const FIRST_MARKET = "Player_LBJ";
const GRANT_FLOOR_SOL = 0.3; // below this we assume the grant hasn't hit yet

export default function InvitePage() {
  const { wallet, isDemoMode } = useWallet();
  const [showSignin, setShowSignin] = useState(false);

  const address = wallet?.account.address;
  const { lamports } = useBalance(address);
  const isConnected = Boolean(wallet);
  const balanceSol = lamports != null ? Number(lamports) / 1_000_000_000 : 0;
  const grantReceived = balanceSol >= GRANT_FLOOR_SOL;

  const { players } = usePlayerMarkets();
  // Sort by |spread| descending — "the market disagreement list" is the hook.
  const movers = [...players]
    .filter((p) => p.currentPrice > 0n && (p.oracle?.indexPriceLamports ?? 0n) > 0n)
    .sort((a, b) => Math.abs(b.spreadPercent) - Math.abs(a.spreadPercent))
    .slice(0, 8);

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Subtle grid backdrop — reinforces "trading terminal" feel without competing for attention */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--color-foreground) 1px, transparent 1px), linear-gradient(to bottom, var(--color-foreground) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-8 lg:py-12">
        {/* ── Market ticker strip ────────────────────────────────────────── */}
        <MarketTicker movers={movers} />

        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <header className="flex flex-1 flex-col justify-center gap-6 lg:gap-8">
          <div className="space-y-4">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
              Devnet · Invite only · Demo 1
            </p>
            <h1 className="font-display text-[2.75rem] font-extrabold leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
              Players trade<br />
              <span className="text-accent">like stocks.</span>
            </h1>
            <p className="max-w-xl text-base text-muted lg:text-lg">
              Every NBA player has a token. Stats drive a fair-value price.
              The market decides what it actually trades at. The gap is your
              edge — if you&apos;re right, and early.
            </p>
          </div>

          {/* CTA block */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {!isConnected ? (
              <button
                onClick={() => setShowSignin(true)}
                className="group inline-flex min-h-[52px] cursor-pointer items-center justify-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-bold text-accent-foreground transition hover:bg-accent/90"
              >
                Claim $100 in devnet SOL
                <span
                  aria-hidden="true"
                  className="transition-transform group-hover:translate-x-0.5"
                >
                  →
                </span>
              </button>
            ) : (
              <Link
                href={`/trade/${FIRST_MARKET}`}
                className="group inline-flex min-h-[52px] items-center justify-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-bold text-accent-foreground transition hover:bg-accent/90"
              >
                Trade {FIRST_MARKET.replace("Player_", "$")}
                <span
                  aria-hidden="true"
                  className="transition-transform group-hover:translate-x-0.5"
                >
                  →
                </span>
              </Link>
            )}
            <Link
              href="/"
              className="inline-flex min-h-[52px] items-center justify-center rounded-lg border border-border-low bg-transparent px-6 py-3 text-sm font-semibold text-foreground transition hover:border-foreground/30 hover:bg-card"
            >
              Browse all markets
            </Link>
          </div>

          {/* Status strip — wallet + grant */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Dot color={isConnected ? "positive" : "muted"} />
              {isConnected
                ? `Wallet connected${isDemoMode ? " · demo" : ""}`
                : "No wallet yet"}
            </span>
            {isConnected && (
              <span className="inline-flex items-center gap-1.5">
                <Dot color={grantReceived ? "positive" : "accent"} pulse={!grantReceived} />
                {grantReceived ? (
                  <>
                    Grant received ·{" "}
                    <span className="font-semibold text-foreground">
                      {balanceSol.toFixed(3)} SOL
                    </span>
                  </>
                ) : (
                  <>Grant incoming… {balanceSol.toFixed(3)} SOL</>
                )}
              </span>
            )}
            <span>0.667 SOL · $100 · no real money · no seed phrase</span>
          </div>
        </header>

        {/* ── Footer: mechanic + earnable badges ─────────────────────────── */}
        <section className="grid gap-4 rounded-xl border border-border-low bg-card p-5 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-8">
          <div className="space-y-1.5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
              How it works
            </p>
            <p className="text-sm leading-relaxed text-foreground">
              <span className="font-semibold text-positive">Green UNDERVALUED</span>{" "}
              = market below fair value.{" "}
              <span className="font-semibold text-negative">Red OVERVALUED</span>{" "}
              = above. Buy if stats will catch up. Sell if the hype&apos;s done.
              No rounds, no expiry.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
              Earn
            </span>
            <StaticBadge tier="early_adopter" locked />
            <StaticBadge tier="sharp_caller" locked />
          </div>
        </section>
      </div>

      {showSignin && <DemoSignin onClose={() => setShowSignin(false)} />}
    </div>
  );
}

// ── Market ticker ──────────────────────────────────────────────────────────

interface Mover {
  config: { id: string };
  currentPrice: bigint;
  spreadPercent: number;
}

function MarketTicker({ movers }: { movers: Mover[] }) {
  if (movers.length === 0) {
    // Loading / no data — render a skeleton strip so layout doesn't jump
    return (
      <div className="flex h-9 items-center gap-6 overflow-hidden border-y border-border-low bg-card/50 px-4 font-mono text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Dot color="accent" pulse />
          LIVE
        </span>
        <span>Markets warming up…</span>
      </div>
    );
  }

  // Duplicate list so the marquee loops seamlessly.
  const loop = [...movers, ...movers];

  return (
    <div className="relative flex h-9 items-center gap-0 overflow-hidden border-y border-border-low bg-card/60 font-mono text-xs">
      <span className="z-10 inline-flex shrink-0 items-center gap-1.5 border-r border-border-low bg-card px-4 py-1 text-accent">
        <Dot color="accent" pulse />
        LIVE
      </span>
      <div className="ticker-track flex min-w-max animate-[ticker_60s_linear_infinite] gap-8 whitespace-nowrap px-6">
        {loop.map((p, i) => {
          const priceUsd = formatUsd(p.currentPrice);
          const up = p.spreadPercent < 0; // market below fair value → undervalued (green, likely to rise)
          return (
            <Link
              key={`${p.config.id}-${i}`}
              href={`/trade/${p.config.id}`}
              className="inline-flex items-center gap-2 text-muted transition hover:text-foreground"
            >
              <span className="font-semibold text-foreground">
                ${p.config.id.replace("Player_", "")}
              </span>
              <span className="tabular-nums">{priceUsd}</span>
              <span
                className={`tabular-nums ${
                  up ? "text-positive" : "text-negative"
                }`}
              >
                {up ? "▲" : "▼"} {Math.abs(p.spreadPercent).toFixed(1)}%
              </span>
            </Link>
          );
        })}
      </div>
      <style jsx>{`
        @keyframes ticker {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </div>
  );
}

// ── Dot ────────────────────────────────────────────────────────────────────

function Dot({
  color,
  pulse = false,
}: {
  color: "positive" | "negative" | "accent" | "muted";
  pulse?: boolean;
}) {
  const bg =
    color === "positive"
      ? "bg-positive"
      : color === "negative"
        ? "bg-negative"
        : color === "accent"
          ? "bg-accent"
          : "bg-muted";
  return (
    <span className="relative inline-flex h-1.5 w-1.5">
      {pulse && (
        <span
          className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${bg}`}
        />
      )}
      <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${bg}`} />
    </span>
  );
}
