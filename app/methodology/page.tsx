import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Methodology — FanShare",
  description:
    "How FanShare turns NBA box-score stats into fair-value prices, and how the bonding-curve market trades around them.",
};

const PILLARS = [
  {
    n: "01",
    title: "Box-score pillars",
    body: "Each player's fair value is built from four weighted pillars of recent NBA performance: scoring efficiency, playmaking, rebounding/defense, and availability. The oracle pulls fresh stats from balldontlie.io after every game.",
  },
  {
    n: "02",
    title: "Daily oracle update",
    body: "Once per day a Solana program-controlled oracle account writes the new fair-value index on-chain. The on-chain account is the only price source the trading program reads — no off-chain trust required at trade time.",
  },
  {
    n: "03",
    title: "Bonding-curve market",
    body: "Each player has a constant-product bonding curve seeded at the same base price as the day-one index. Buys raise the price for the next buyer; sells lower it. The gap between market price and oracle index is the spread — your edge is calling which way it closes.",
  },
  {
    n: "04",
    title: "Practice mode (devnet)",
    body: "Everything today runs on Solana devnet with practice money. There is no real-money exposure, no on-ramp, and no off-ramp. We're testing the mechanics, the oracle, and the player selection before we touch mainnet.",
  },
] as const;

export default function MethodologyPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
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
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 pt-5">
          <Link
            href="/invite"
            className="inline-flex items-center gap-2 text-sm font-bold tracking-[-0.01em] text-foreground transition hover:opacity-80"
            aria-label="FanShare home"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <rect x="3" y="5" width="18" height="3" rx="1" fill="var(--accent)" />
              <rect x="3" y="10.5" width="13" height="3" rx="1" fill="var(--foreground)" />
              <rect x="3" y="16" width="18" height="3" rx="1" fill="var(--accent)" opacity="0.55" />
            </svg>
            FanShare
          </Link>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            Devnet · Practice mode
          </span>
        </div>

        <main className="mx-auto max-w-3xl px-6 py-16 lg:py-24">
          <span className="inline-flex items-center gap-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-accent">
            <span className="inline-block h-px w-6 bg-accent" />
            Methodology
          </span>

          <h1
            className="m-0 mt-6 font-display font-extrabold text-foreground"
            style={{
              fontSize: "clamp(36px, 5vw, 56px)",
              lineHeight: 1.02,
              letterSpacing: "-0.025em",
            }}
          >
            How prices{" "}
            <em className="not-italic text-accent">actually</em> work.
          </h1>

          <p className="mt-8 text-base leading-[1.65] text-muted">
            The short version: real NBA stats set a fair-value price every day,
            and the market trades around that signal on a bonding curve. The
            spread between the two is the opportunity. Here&apos;s the longer
            version, in four pieces.
          </p>

          <div className="mt-12 flex flex-col">
            {PILLARS.map((p, i) => (
              <div
                key={p.n}
                className={`grid grid-cols-[48px_1fr] items-start gap-5 py-6 sm:grid-cols-[88px_1fr] sm:gap-10 sm:py-8 ${
                  i < PILLARS.length - 1 ? "border-b border-border-low" : ""
                }`}
              >
                <div
                  className="font-mono font-bold tabular-nums text-accent"
                  style={{
                    fontSize: "clamp(32px, 5vw, 56px)",
                    lineHeight: 0.9,
                    letterSpacing: "-0.03em",
                  }}
                >
                  {p.n}
                </div>
                <div className="pt-1">
                  <h3 className="m-0 mb-2 text-[18px] font-bold tracking-[-0.015em] text-foreground">
                    {p.title}
                  </h3>
                  <p className="m-0 text-[14px] leading-[1.6] text-muted">
                    {p.body}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 flex flex-wrap items-center gap-6 border-t border-border-low pt-8 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
            <Link
              href="/invite"
              className="inline-flex items-center gap-1.5 text-accent transition hover:opacity-80"
            >
              ← Back to invite
            </Link>
            <Link href="/about" className="transition hover:text-foreground">
              About →
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}
