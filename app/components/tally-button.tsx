"use client";

import Script from "next/script";
import posthog from "posthog-js";
import { track } from "../lib/analytics/track";

declare global {
  interface Window {
    Tally?: {
      openPopup: (
        formId: string,
        options: {
          layout?: "modal";
          width?: number;
          emoji?: { text: string; animation: string };
          hiddenFields?: Record<string, string>;
        },
      ) => void;
    };
  }
}

const DEMO_STORAGE_KEY = "fanshare_demo";

/**
 * Tally floating feedback button — injected on every page.
 *
 * Renders nothing until NEXT_PUBLIC_TALLY_FORM_ID is set.
 *
 * Wiring contract (per /ceo/handoffs/2026-04-20-observability.md DoD):
 *   - `feedback_opened` PostHog event fires on click (always, even if Tally fails to open)
 *   - 4 hidden fields passed to Tally form: page_url, wallet_addr, session_id, session_source
 *
 * Why programmatic openPopup instead of declarative data-tally-open:
 *   data-tally-open hands control to Tally's embed.js, which loads the form with
 *   only originPage in the iframe URL — no way to pass per-click hidden fields.
 *   Calling Tally.openPopup() from our own click handler lets us thread current
 *   wallet, session, and source context into the form on every open.
 *
 * Why localStorage read instead of useWallet():
 *   This component renders on every page including /_not-found, which
 *   prerenders at build time without WalletProvider in scope. useWallet()
 *   throws there. Reading the demo wallet directly from localStorage is
 *   safe (only runs in click handler, post-hydration) and avoids the
 *   provider dependency.
 */
export function TallyButton() {
  const formId = process.env.NEXT_PUBLIC_TALLY_FORM_ID;
  if (!formId) return null;

  const handleClick = () => {
    track("feedback_opened");

    if (typeof window === "undefined" || !window.Tally) {
      // Tally embed.js hasn't loaded yet — feedback_opened still fires so
      // we capture the intent, user can retry once embed.js is ready.
      return;
    }

    const pageUrl = window.location.href;

    let walletAddr = "";
    try {
      const raw = localStorage.getItem(DEMO_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { address?: string };
        walletAddr = parsed?.address ?? "";
      }
    } catch {
      walletAddr = "";
    }

    let sessionId = "";
    try {
      const ph = posthog as unknown as { get_session_id?: () => string };
      sessionId = ph.get_session_id?.() ?? posthog.get_distinct_id() ?? "";
    } catch {
      sessionId = "";
    }

    const pathname = window.location.pathname;
    const sessionSource = pathname === "/invite"
      ? "invite"
      : pathname === "/"
        ? "home"
        : pathname.startsWith("/trade")
          ? "trade"
          : pathname.startsWith("/leaderboard")
            ? "leaderboard"
            : pathname.startsWith("/portfolio")
              ? "portfolio"
              : "other";

    window.Tally.openPopup(formId, {
      layout: "modal",
      width: 500,
      emoji: { text: "📝", animation: "wave" },
      hiddenFields: {
        page_url: pageUrl,
        wallet_addr: walletAddr,
        session_id: sessionId,
        session_source: sessionSource,
      },
    });
  };

  return (
    <>
      <Script
        src="https://tally.so/widgets/embed.js"
        strategy="afterInteractive"
      />
      <button
        type="button"
        onClick={handleClick}
        aria-label="Send feedback"
        className="fixed bottom-4 right-4 z-40 inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-4 text-xs font-semibold text-foreground shadow-lg shadow-black/20 transition hover:-translate-y-px hover:border-accent/50 hover:bg-cream max-sm:h-10 max-sm:px-3"
      >
        <span aria-hidden="true">💬</span>
        <span>Feedback</span>
      </button>
    </>
  );
}
