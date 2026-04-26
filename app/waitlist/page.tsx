import type { Metadata } from "next";
import Link from "next/link";
import { GridBackground } from "../components/grid-background";

export const metadata: Metadata = {
  title: "Waitlist — FanShare",
  description:
    "Join the FanShare waitlist. A market for NBA player performance — your basketball read is the edge.",
};

export default function WaitlistPage() {
  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <GridBackground />

      <div className="relative z-10 flex min-h-screen flex-col">
        {/* Header */}
        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
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
        </header>

        {/* Main */}
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 pb-16 pt-10 lg:pt-16">
          {/* Hero */}
          <div className="mb-10">
            <span className="inline-flex items-center gap-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-accent">
              <span className="inline-block h-px w-6 bg-accent" />
              Early access
            </span>
            <h1
              className="m-0 mt-5 font-display font-extrabold text-foreground"
              style={{
                fontSize: "clamp(32px, 5vw, 52px)",
                lineHeight: 1.05,
                letterSpacing: "-0.025em",
              }}
            >
              Join the waitlist.
            </h1>
            <p className="mt-4 max-w-md text-base leading-[1.65] text-muted">
              Your basketball read is the edge. We&apos;re opening Demo 2 to a
              small group — drop your email and we&apos;ll reach out when it&apos;s
              ready.
            </p>
          </div>

          {/* Tally iframe */}
          <div className="w-full flex-1">
            <iframe
              src="https://tally.so/embed/MerLrg?alignLeft=1&hideTitle=1&transparentBackground=1&dynamicHeight=1"
              loading="lazy"
              width="100%"
              height="400"
              title="FanShare waitlist"
              style={{ border: "none", minHeight: 320 }}
            />
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-border-low">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8 lg:py-10">
            <div className="flex flex-wrap items-center justify-between gap-6">
              <span className="inline-flex items-center gap-2 text-sm font-bold tracking-[-0.01em] text-foreground">
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="3" rx="1" fill="var(--accent)" />
                  <rect x="3" y="10.5" width="13" height="3" rx="1" fill="var(--foreground)" />
                  <rect x="3" y="16" width="18" height="3" rx="1" fill="var(--accent)" opacity="0.55" />
                </svg>
                Built by FanShare
              </span>
              <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                <Link href="/about" className="transition hover:text-foreground">
                  About
                </Link>
                <span aria-hidden="true">·</span>
                <Link href="/methodology" className="transition hover:text-foreground">
                  Methodology
                </Link>
                <span aria-hidden="true">·</span>
                <Link href="/invite" className="transition hover:text-foreground">
                  Invite
                </Link>
              </nav>
            </div>
            <p className="m-0 max-w-[560px] font-mono text-[11px] leading-[1.55] text-muted">
              Practice mode. No real money. No seed phrase. Everything runs on
              Solana devnet with simulated funds.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
