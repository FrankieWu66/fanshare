"use client";

import { track as vercelTrack } from "@vercel/analytics";
import posthog from "posthog-js";

/**
 * Single source of truth for custom events.
 *
 * One call fires to BOTH Vercel Analytics AND PostHog so the two dashboards
 * stay in sync. Props are the same shape in both.
 *
 * Vercel Analytics only accepts primitive (string/number/boolean/null) props,
 * so we flatten before dispatching. PostHog accepts anything JSON-serializable.
 *
 * @see docs/TELEMETRY_EVENTS.md for the canonical event catalog.
 */
export type EventName =
  | "invite_page_viewed"
  | "invite_cta_clicked"
  | "terms_expanded"
  | "about_demo_clicked"
  | "grant_claimed"
  | "first_player_opened"
  | "first_buy_attempted"
  | "first_buy_succeeded"
  | "first_sell_succeeded"
  | "error_shown"
  | "feedback_opened";

export interface EventProps {
  wallet?: string | null;
  player_id?: string;
  amount_sol?: number;
  spread_at_click?: number;
  // Free-form extras (error context, source links, etc.) — still flattened for Vercel.
  [key: string]: string | number | boolean | null | undefined;
}

export function track(event: EventName, props?: EventProps) {
  if (typeof window === "undefined") return;

  // Strip undefined for a clean payload in both sinks.
  const clean: Record<string, string | number | boolean | null> = {};
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v !== undefined) clean[k] = v;
    }
  }

  // Vercel Analytics — fire-and-forget; throws silently if not initialized.
  try {
    vercelTrack(event, clean);
  } catch {
    // Analytics script may be blocked (ad-blocker); never crash the app.
  }

  // PostHog — only if initialized (i.e. env var was set at bootstrap).
  try {
    if (posthog.__loaded) {
      posthog.capture(event, clean);
    }
  } catch {
    // Same — don't let telemetry break the UI.
  }
}

/**
 * Identify a user by their wallet address in PostHog. Enables funnel analysis
 * per-wallet across sessions. Call once per wallet connection.
 */
export function identifyWallet(wallet: string | null | undefined) {
  if (typeof window === "undefined" || !wallet) return;
  try {
    if (posthog.__loaded) {
      posthog.identify(wallet);
    }
  } catch {
    /* no-op */
  }
}

/**
 * Demo rehearsal uses `first_*` events to build a funnel. A wallet attempting
 * its second buy shouldn't look like a new user in that funnel, so we dedupe
 * per-wallet via localStorage.
 *
 * Returns true if this is the first time (event will fire), false if already fired.
 */
export function trackOnce(
  event: EventName,
  wallet: string | null | undefined,
  props?: EventProps,
): boolean {
  if (typeof window === "undefined") return false;
  const key = `fs:ev:${event}:${wallet ?? "anon"}`;
  if (typeof localStorage !== "undefined" && localStorage.getItem(key)) {
    return false;
  }
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* private mode / quota — still fire once this session */
  }
  track(event, props);
  return true;
}
