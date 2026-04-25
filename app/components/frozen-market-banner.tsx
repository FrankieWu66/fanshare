"use client";

import { useState, useEffect } from "react";
import type { MarketStatusData } from "../lib/fanshare-program";

interface FrozenMarketBannerProps {
  marketStatus: MarketStatusData;
  onClaimExit?: () => void;
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "0s";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push("<1m");
  return parts.join(" ");
}

export function FrozenMarketBanner({ marketStatus, onClaimExit }: FrozenMarketBannerProps) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!marketStatus.isFrozen) return null;

  const closeTime = Number(marketStatus.closeTimestamp);
  const isClosed = now >= closeTime;
  const secondsRemaining = closeTime - now;

  if (isClosed) {
    // Market permanently closed
    return (
      <div className="mb-5 rounded-xl border border-negative/30 bg-negative/10 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-negative">
              This market is permanently closed.
            </p>
            <p className="mt-0.5 text-xs text-muted">
              Trading is disabled. Claim your exit to receive your share of the treasury.
            </p>
          </div>
          {onClaimExit && (
            <button
              onClick={onClaimExit}
              className="cursor-pointer rounded-lg bg-negative px-4 py-2 text-sm font-bold text-background transition hover:opacity-90 active:scale-[0.98]"
            >
              Claim Exit
            </button>
          )}
        </div>
      </div>
    );
  }

  // Market frozen — trading fully halted (Demo 1: full halt, no in-app sell window).
  // SIM-001 fix: previous banner said "Exit claim available in X" which implied a sell
  // path that does not exist in Demo 1. Now clearly states trading is halted and directs
  // users to contact support. The process_exit flow (sell window + treasury backstop)
  // is deferred to Demo 2.
  return (
    <div className="mb-5 rounded-xl border border-accent/30 bg-accent-subtle px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-accent">
            This market is frozen. All trading is paused.
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Your tokens are safe. If you hold a position on this player, contact{" "}
            <span className="font-semibold text-accent">@fanshares</span> for assistance.
            Exit claims will be available in a future update.
          </p>
        </div>
      </div>
    </div>
  );
}
