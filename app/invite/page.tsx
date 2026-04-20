"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "../lib/wallet/context";
import { useBalance } from "../lib/hooks/use-balance";
import { usePlayerMarkets } from "../lib/hooks/use-player-markets";
import { DemoSignin } from "../components/demo-signin";
import { formatUsd } from "../lib/oracle-weights";
import { track } from "../lib/analytics/track";

/**
 * Demo 1 invite landing page.
 *
 * Composed layout (per design handoff):
 *   • Hero zone — V1 Terminal styling: live ticker above, dense status row,
 *     big display headline with amber accent em, amber primary CTA + ghost
 *     secondary link.
 *   • Premise zone — V2 Scoreboard styling: centered eyebrow + oversized
 *     display-type manifesto, amber em emphasis.
 *   • Walkthrough zone — V2 Scoreboard styling: vertical 01/02/03 rail with
 *     huge amber mono numerals and generous spacing.
 *   • Badges zone — V3 Editorial styling: minimal wireframe plaques with
 *     locked state + unlock criteria footer.
 *
 * Copy source: design bundle shared.jsx (STEPS, BADGES, MANIFESTO, etc.).
 * Wallet/demo logic unchanged from prior single-viewport version.
 */

const GRANT_FLOOR_SOL = 0.3;

const STEPS = [
  {
    n: "01",
    title: "Get $100 in devnet SOL",
    body: "Click the button. We'll create a fake trading account for you and deposit $100 of play money. No signup, no password — it just appears.",
  },
  {
    n: "02",
    title: "Find a player the market has wrong",
    body: "Every card shows a fair-value price (from stats) and a market price (what others paid). When they disagree, that's the opportunity. Green \"UNDERVALUED\" = market below fair value. Red \"OVERVALUED\" = above. Example: if stats say LeBron is worth $5.59 but the market is trading him at $4.20, you think others are sleeping on him — buy. When they catch up, you cash out the gap.",
  },
  {
    n: "03",
    title:
      "Buy if you think stats will catch up. Sell if you think the hype's done.",
    body: "Buying raises the price for the next person. Selling lowers it. Your $100 only nudges a star like LeBron — but can meaningfully move a role player. That matters because a big price swing means bigger potential gains (and losses) per trade.",
  },
] as const;

const TERMS = [
  {
    k: "Fair-value price",
    v: "What a computer thinks a player is worth based on their real NBA stats (updated daily).",
  },
  {
    k: "Market price",
    v: "What FanShare users are actually paying right now. Goes up when people buy, down when people sell.",
  },
  {
    k: "Spread",
    v: "The gap between fair-value and market. Big gap = big opportunity (or big risk).",
  },
  {
    k: "Oracle",
    v: "The computer that reads NBA stats and updates fair-value prices.",
  },
  {
    k: "Devnet / SOL",
    v: "Solana's test network. SOL is the fake currency we run on. No real money, no real transactions, nothing is worth anything outside this demo.",
  },
] as const;

const BADGES = [
  {
    key: "early",
    name: "Early Adopter",
    unlock: "Trade on Demo 1 to earn",
    oneLine: "Among the first 15 to touch the platform. Locked in forever.",
    color: "var(--accent)",
  },
  {
    key: "sharp",
    name: "Sharp Caller",
    unlock: "5+ profitable trades at >20% spread",
    oneLine: "You saw what the market missed, repeatedly.",
    color: "var(--positive)",
  },
  {
    key: "diamond",
    name: "Diamond Hands",
    unlock: "Hold a winning position through 3 oracle updates",
    oneLine: "Conviction over churn.",
    color: "#A855F7",
  },
] as const;

const DISCLAIMER =
  "Running on Solana devnet. All SOL is test SOL. No real money, no financial risk, no financial advice.";
const BADGE_FINE =
  "Badges are preview-only for Demo 1. They'll be earnable when we open beta.";

export default function InvitePage() {
  const { wallet, isDemoMode } = useWallet();
  const [showSignin, setShowSignin] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);

  const address = wallet?.account.address;
  const { lamports } = useBalance(address);
  const isConnected = Boolean(wallet);

  // Fire page-view event once per mount.
  useEffect(() => {
    track("invite_page_viewed", { wallet: address ?? null });
    // Intentionally not watching address — the brief is "page viewed", not
    // "page viewed per wallet change". We identify inside PostHog via
    // identifyWallet wherever the connection happens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const balanceSol = lamports != null ? Number(lamports) / 1_000_000_000 : 0;
  const grantReceived = balanceSol >= GRANT_FLOOR_SOL;

  const { players } = usePlayerMarkets();
  // Sort by |spread| descending — "the market disagreement list" is the hook.
  const movers = [...players]
    .filter((p) => p.currentPrice > 0n && (p.oracle?.indexPriceLamports ?? 0n) > 0n)
    .sort((a, b) => Math.abs(b.spreadPercent) - Math.abs(a.spreadPercent))
    .slice(0, 8);

  return (
    <div className="relative overflow-hidden bg-background">
      {/* Grid backdrop — reinforces "trading terminal" feel. Fixed so it stays during scroll. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--color-foreground) 1px, transparent 1px), linear-gradient(to bottom, var(--color-foreground) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative">
        {/* ── Market ticker strip ──────────────────────────────────────────── */}
        <div className="mx-auto max-w-6xl px-6 pt-6">
          <MarketTicker movers={movers} />
        </div>

        {/* ── Hero (V1 Terminal) ───────────────────────────────────────────── */}
        <header className="mx-auto max-w-6xl px-6 pb-16 pt-10 lg:pb-20 lg:pt-14">
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
              <Dot color="positive" pulse />
              <span>Live · Devnet</span>
              <span style={{ color: "var(--border)" }}>·</span>
              <span>Invite · Demo 1</span>
            </div>
            <h1
              className="m-0 font-display font-extrabold text-foreground"
              style={{
                fontSize: "clamp(40px, 5.4vw, 64px)",
                lineHeight: 0.98,
                letterSpacing: "-0.03em",
              }}
            >
              Trade player tokens that move with{" "}
              <em className="not-italic text-accent">real stats.</em>
            </h1>
            <p className="m-0 max-w-[540px] text-base leading-[1.55] text-muted">
              Every player has a token.{" "}
              <b className="font-medium text-foreground">
                Stats move a fair-value price.
              </b>{" "}
              The market decides what it actually trades at. The gap is your
              edge — if you&apos;re right, and early.
            </p>

            {/* CTA row */}
            <div className="mt-1 flex flex-wrap items-center gap-6">
              {!isConnected ? (
                <button
                  onClick={() => {
                    track("invite_cta_clicked");
                    setShowSignin(true);
                  }}
                  className="inline-flex h-14 cursor-pointer items-center gap-2.5 rounded-xl bg-accent px-6 text-base font-bold tracking-[-0.005em] text-accent-foreground shadow-[0_8px_32px_-8px_rgba(245,158,11,0.4)] transition hover:-translate-y-px hover:bg-[#FBBF24] hover:shadow-[0_12px_40px_-8px_rgba(245,158,11,0.5)] active:translate-y-0"
                >
                  <span className="whitespace-nowrap">Claim $100 →</span>
                </button>
              ) : (
                <Link
                  href="/"
                  className="inline-flex h-14 items-center gap-2.5 rounded-xl bg-accent px-6 text-base font-bold tracking-[-0.005em] text-accent-foreground shadow-[0_8px_32px_-8px_rgba(245,158,11,0.4)] transition hover:-translate-y-px hover:bg-[#FBBF24] hover:shadow-[0_12px_40px_-8px_rgba(245,158,11,0.5)] active:translate-y-0"
                >
                  <span className="whitespace-nowrap">Start Trading →</span>
                </Link>
              )}
              <a
                href="#walkthrough"
                className="inline-flex h-11 items-center gap-1.5 text-[13px] font-medium text-muted transition hover:text-foreground"
              >
                How it works
                <svg
                  viewBox="0 0 24 24"
                  width="13"
                  height="13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 5v14" />
                  <path d="m19 12-7 7-7-7" />
                </svg>
              </a>
            </div>

            {/* Status strip (wallet + grant) — live data, unchanged from prior version */}
            <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-xs text-muted">
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
                  ) : balanceSol > 0 ? (
                    <>Grant incoming… {balanceSol.toFixed(3)} SOL</>
                  ) : (
                    <>Grant incoming…</>
                  )}
                </span>
              )}
              <span>0.667 SOL · $100 · no real money · no seed phrase</span>
            </div>
          </div>
        </header>

        {/* ── 10-second explainer (quieter, for crypto-naive first-timers) ── */}
        <section className="border-t border-border-low">
          <div className="mx-auto max-w-3xl px-6 py-10 lg:py-12">
            <div className="mb-3">
              <span className="inline-flex items-center gap-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
                <span className="inline-block h-px w-6 bg-border" />
                New here? 10-second version.
              </span>
            </div>
            <p className="m-0 text-[14px] leading-[1.65] text-muted">
              FanShare is a pretend stock market for NBA players. A computer
              turns each player&apos;s real stats into a &ldquo;fair price&rdquo;
              every day. You use $100 of fake money to bet on players the market
              has priced wrong. If you&apos;re right, your pretend money grows.
              If you&apos;re wrong, it shrinks. No real money, no risk — just a
              fun test of your basketball knowledge.
            </p>
          </div>
        </section>

        {/* ── Premise / Manifesto (V2 Scoreboard, centered) ────────────────── */}
        <section className="border-t border-border-low">
          <div className="mx-auto max-w-6xl px-6 py-20 text-center lg:py-24">
            <Eyebrow>Thesis</Eyebrow>
            <p
              className="mx-auto m-0 mt-6 max-w-[860px] font-display font-bold text-foreground"
              style={{
                fontSize: "clamp(28px, 3.8vw, 44px)",
                lineHeight: 1.15,
                letterSpacing: "-0.02em",
              }}
            >
              Being right <em className="not-italic text-accent">early</em> — and{" "}
              <em className="not-italic text-accent">staying right</em> — pays
              better than being right once.
            </p>
          </div>
        </section>

        {/* ── Walkthrough (V2 Scoreboard vertical rail) ────────────────────── */}
        <section id="walkthrough" className="border-t border-border-low">
          <div className="mx-auto max-w-6xl px-6 py-16 lg:py-20">
            <div className="mb-10 flex flex-col gap-3">
              <Eyebrow>How it works</Eyebrow>
              <h2
                className="m-0 font-display font-extrabold text-foreground"
                style={{
                  fontSize: "clamp(28px, 3.6vw, 42px)",
                  lineHeight: 1.1,
                  letterSpacing: "-0.025em",
                }}
              >
                Three clicks to your first trade.
              </h2>
            </div>
            <div className="flex flex-col">
              {STEPS.map((step, i) => (
                <div
                  key={step.n}
                  className={`grid grid-cols-[64px_1fr] items-start gap-6 py-8 sm:grid-cols-[128px_1fr] sm:gap-12 sm:py-10 ${
                    i < STEPS.length - 1 ? "border-b border-border-low" : ""
                  }`}
                >
                  <div
                    className="font-mono font-bold tabular-nums text-accent"
                    style={{
                      fontSize: "clamp(48px, 7vw, 88px)",
                      lineHeight: 0.9,
                      letterSpacing: "-0.03em",
                    }}
                  >
                    {step.n}
                  </div>
                  <div className="max-w-[640px] pt-3">
                    <h3
                      className="m-0 mb-3.5 font-display font-extrabold text-foreground"
                      style={{
                        fontSize: "clamp(22px, 2.5vw, 30px)",
                        lineHeight: 1.15,
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {step.title}
                    </h3>
                    <p className="m-0 text-[15px] leading-[1.6] text-muted">
                      {step.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Badges (V3 Editorial wireframe plaques) ──────────────────────── */}
        <section className="border-t border-border-low">
          <div className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
            <Eyebrow>What you&apos;re playing for</Eyebrow>
            <h2
              className="m-0 mb-10 mt-5 font-display font-extrabold text-foreground"
              style={{
                fontSize: "clamp(28px, 3.6vw, 40px)",
                lineHeight: 1.1,
                letterSpacing: "-0.025em",
              }}
            >
              Three badges. Zero claimed so far.
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              {BADGES.map((b) => (
                <div
                  key={b.key}
                  className="flex min-h-[200px] flex-col gap-4 rounded-xl border border-border bg-transparent p-6 transition-colors hover:border-border-low"
                >
                  <div
                    className="flex items-center gap-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em]"
                    style={{ color: b.color }}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="13"
                      height="13"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="4" y="11" width="16" height="10" rx="2" />
                      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    </svg>
                    <span className="text-muted">Locked</span>
                  </div>
                  <div
                    className="font-display text-[22px] font-extrabold text-foreground opacity-75"
                    style={{ letterSpacing: "-0.02em", lineHeight: 1.1 }}
                  >
                    {b.name}
                  </div>
                  <p className="m-0 flex-1 text-[14px] leading-[1.55] text-muted">
                    {b.oneLine}
                  </p>
                  <div className="border-t border-border-low pt-3.5 font-mono text-[11px] text-muted">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-accent">
                      Unlock
                    </div>
                    <div>{b.unlock}</div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-6 max-w-[640px] text-[13px] text-muted">
              {BADGE_FINE}
            </p>
          </div>
        </section>

        {/* ── Terms explained (collapsible, above disclaimer) ───────────────── */}
        <section className="border-t border-border-low">
          <div className="mx-auto max-w-6xl px-6 py-6">
            <button
              type="button"
              onClick={() => {
                setTermsOpen((v) => {
                  const next = !v;
                  if (next) track("terms_expanded");
                  return next;
                });
              }}
              aria-expanded={termsOpen}
              className="inline-flex cursor-pointer items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted transition hover:text-foreground"
            >
              <span
                aria-hidden="true"
                className="inline-block transition-transform"
                style={{
                  transform: termsOpen ? "rotate(180deg)" : "rotate(0deg)",
                }}
              >
                ↓
              </span>
              Terms explained
            </button>
            {termsOpen && (
              <dl className="mt-5 grid grid-cols-1 gap-x-10 gap-y-3 md:grid-cols-2">
                {TERMS.map((t) => (
                  <div
                    key={t.k}
                    className="flex flex-col border-t border-border-low pt-3"
                  >
                    <dt className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-accent">
                      {t.k}
                    </dt>
                    <dd className="m-0 mt-1.5 text-[13px] leading-[1.55] text-muted">
                      {t.v}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </section>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <footer className="border-t border-border-low">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-6 py-8 lg:py-10">
            <span className="inline-flex items-center gap-2 text-sm font-bold tracking-[-0.01em] text-foreground">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <rect x="3" y="5" width="18" height="3" rx="1" fill="var(--accent)" />
                <rect x="3" y="10.5" width="13" height="3" rx="1" fill="var(--foreground)" />
                <rect x="3" y="16" width="18" height="3" rx="1" fill="var(--accent)" opacity="0.55" />
              </svg>
              FanShare
            </span>
            <p className="m-0 max-w-[560px] font-mono text-[11px] leading-[1.55] text-muted">
              {DISCLAIMER}
            </p>
          </div>
        </footer>
      </div>

      {showSignin && <DemoSignin onClose={() => setShowSignin(false)} />}
    </div>
  );
}

// ── Eyebrow (shared across section heads) ──────────────────────────────────

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-accent">
      <span className="inline-block h-px w-6 bg-accent" />
      {children}
    </span>
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
          const abs = Math.abs(p.spreadPercent);
          // Treat sub-0.05% as flat — the bonding curve emits tiny float noise
          // even at T0 when base === index. Don't paint the whole ticker red
          // (or green) for a zero delta.
          const flat = abs < 0.05;
          const up = p.spreadPercent < 0; // market below fair value → undervalued
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
                  flat ? "text-muted" : up ? "text-positive" : "text-negative"
                }`}
              >
                {flat ? "—" : up ? "▲" : "▼"} {abs.toFixed(1)}%
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
