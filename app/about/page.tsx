import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About — FanShare",
  description:
    "FanShare is a stock market for NBA player performance. Built by a small team on Solana devnet.",
};

export default function AboutPage() {
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
            Practice mode
          </span>
        </div>

        <main className="mx-auto max-w-3xl px-6 py-16 lg:py-24">
          <span className="inline-flex items-center gap-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-accent">
            <span className="inline-block h-px w-6 bg-accent" />
            About
          </span>

          <h1
            className="m-0 mt-6 font-display font-extrabold text-foreground"
            style={{
              fontSize: "clamp(36px, 5vw, 56px)",
              lineHeight: 1.02,
              letterSpacing: "-0.025em",
            }}
          >
            We&apos;re building a market for{" "}
            <em className="not-italic text-accent">human performance.</em>
          </h1>

          <p className="mt-8 text-base leading-[1.65] text-muted">
            FanShare turns NBA player performance into tradable tokens. A daily
            oracle reads individual box-score stats and computes a fair-value
            price for each player. FanShare publishes that index and stands
            aside — the market sets the traded price on a Solana bonding
            curve. The gap between the two is your read.
          </p>

          <p className="mt-5 text-base leading-[1.65] text-muted">
            We&apos;re running on Solana devnet today with practice money so we
            can stress the model, the index, and the trading flow without putting
            anyone&apos;s real funds at risk. Every design decision is being
            tested against the question: does this make a real market that real
            fans want to play in?
          </p>

          <div className="mt-12 border-t border-border-low pt-8">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-accent">
              Team
            </span>
            <ul className="mt-5 grid grid-cols-1 gap-y-4 sm:grid-cols-2">
              <li className="flex flex-col">
                <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                  Frankie Wu
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
                  Founder · Product
                </span>
              </li>
              <li className="flex flex-col">
                <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                  Jerry Zhu
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
                  Basketball · Index design
                </span>
              </li>
              <li className="flex flex-col">
                <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                  Engineering
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
                  Solana program · App · Oracle
                </span>
              </li>
            </ul>
          </div>

          <div className="mt-12 flex flex-wrap items-center gap-6 border-t border-border-low pt-8 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
            <Link
              href="/invite"
              className="inline-flex items-center gap-1.5 text-accent transition hover:opacity-80"
            >
              ← Back to invite
            </Link>
            <Link
              href="/methodology"
              className="transition hover:text-foreground"
            >
              Methodology →
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}
