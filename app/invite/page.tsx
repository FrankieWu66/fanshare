"use client";

import { useState } from "react";
import Link from "next/link";
import { useWallet } from "../lib/wallet/context";
import { useBalance } from "../lib/hooks/use-balance";
import { DemoSignin } from "../components/demo-signin";
import { StaticBadge } from "../components/badge";

/**
 * Demo 1 invite landing page.
 *
 * Flow:
 *   1. User lands here from invite link.
 *   2. If no wallet → "Claim $100 demo grant" opens DemoSignin modal (existing
 *      connectDemo path calls /api/demo/register which transfers 0.667 SOL from
 *      the deploy wallet).
 *   3. If wallet connected → show balance check + CTA to first market.
 *   4. Always show locked-badge gallery so users see the earnable surface.
 *
 * Ops copy TODOs are marked inline; engineering ships the scaffold.
 */

const FIRST_MARKET = "Player_LBJ"; // LeBron — known name, high-priced tier, likely to show movement first

export default function InvitePage() {
  const { wallet, isDemoMode } = useWallet();
  const [showSignin, setShowSignin] = useState(false);

  const address = wallet?.account.address;
  const { lamports } = useBalance(address);
  const isConnected = Boolean(wallet);
  // 0.667 SOL grant floor — display "grant received" once balance crosses half that
  // (allows for small trade activity without reverting the badge).
  const balanceSol = lamports != null ? Number(lamports) / 1_000_000_000 : 0;
  const grantReceived = balanceSol >= 0.3;

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-12">
      {/* Hero */}
      <header className="space-y-3">
        {/* TODO(ops): landing headline */}
        <h1 className="font-display text-4xl font-extrabold tracking-tight">
          Welcome to FanShare
        </h1>
        {/* TODO(ops): landing subhead — what-is-this, why-care */}
        <p className="text-base text-muted">
          Trade NBA player performance tokens on a bonding curve anchored to
          stats. Your $100 demo grant is on us — no real money, just fake
          devnet SOL.
        </p>
      </header>

      {/* Step 1 — connect / grant */}
      <section className="rounded-2xl border border-border-low bg-card p-6">
        <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/15 font-mono text-[10px] text-accent">
            1
          </span>
          Claim your $100 grant
        </div>

        {!isConnected ? (
          <div className="space-y-3">
            <p className="text-sm">
              We&apos;ll create a demo wallet and airdrop 0.667 SOL (≈ $100)
              so you can start trading immediately.
            </p>
            <button
              onClick={() => setShowSignin(true)}
              className="w-full cursor-pointer rounded-lg bg-accent px-4 py-3 text-sm font-bold text-accent-foreground transition hover:bg-accent/90"
            >
              Claim $100 demo grant →
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm">
              Wallet connected{isDemoMode ? " (demo mode)" : ""}.
            </p>
            <div className="flex items-baseline justify-between rounded-lg border border-border-low bg-cream/50 px-3 py-2">
              <span className="text-xs text-muted">Balance</span>
              <span className="font-mono text-sm font-semibold tabular-nums">
                {balanceSol.toFixed(4)} SOL
              </span>
            </div>
            {grantReceived ? (
              <p className="text-xs text-positive">
                ✓ Grant received — you&apos;re ready to trade.
              </p>
            ) : (
              <p className="text-xs text-muted">
                Grant should arrive in a few seconds. Refresh if it doesn&apos;t show up.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Step 2 — first trade */}
      <section className="rounded-2xl border border-border-low bg-card p-6">
        <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/15 font-mono text-[10px] text-accent">
            2
          </span>
          Make your first trade
        </div>
        {/* TODO(ops): first-trade walkthrough copy */}
        <p className="mb-4 text-sm text-muted">
          Pick a player, buy some tokens, watch the spread move. Sell anytime
          — 1.5% fee, no lockup.
        </p>
        <Link
          href={`/trade/${FIRST_MARKET}`}
          className={`inline-flex w-full items-center justify-center rounded-lg px-4 py-3 text-sm font-bold transition ${
            isConnected
              ? "bg-foreground text-background hover:bg-foreground/90"
              : "cursor-not-allowed bg-border-low text-muted"
          }`}
          aria-disabled={!isConnected}
          onClick={(e) => {
            if (!isConnected) e.preventDefault();
          }}
        >
          Trade {FIRST_MARKET.replace("Player_", "$")} →
        </Link>
        {!isConnected && (
          <p className="mt-2 text-center text-xs text-muted">
            Claim your grant first.
          </p>
        )}
      </section>

      {/* Badges you can earn — locked preview */}
      <section className="rounded-2xl border border-border-low bg-card p-6">
        <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/15 font-mono text-[10px] text-accent">
            3
          </span>
          Badges you can earn
        </div>
        {/* TODO(ops): badge copy — what each one means */}
        <p className="mb-4 text-sm text-muted">
          Locked badges preview the earnable system. The backend ships after
          Demo 1.
        </p>
        <ul className="space-y-3">
          <li className="flex items-start justify-between gap-4 rounded-lg border border-border-low bg-cream/30 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Early Adopter</p>
              <p className="text-xs text-muted">
                Traded in the first cohort of FanShare users.
              </p>
            </div>
            <StaticBadge tier="early_adopter" locked />
          </li>
          <li className="flex items-start justify-between gap-4 rounded-lg border border-border-low bg-cream/30 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Sharp Caller</p>
              <p className="text-xs text-muted">
                Bought undervalued players before the oracle caught up.
              </p>
            </div>
            <StaticBadge tier="sharp_caller" locked />
          </li>
          <li className="flex items-start justify-between gap-4 rounded-lg border border-border-low bg-cream/30 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Diamond Hands</p>
              <p className="text-xs text-muted">
                Held through volatility for 7+ days.
              </p>
            </div>
            <StaticBadge tier="diamond_hands" locked />
          </li>
        </ul>
      </section>

      {showSignin && <DemoSignin onClose={() => setShowSignin(false)} />}
    </div>
  );
}
