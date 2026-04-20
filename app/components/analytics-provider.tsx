"use client";

import { useEffect, Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";

/**
 * Initializes PostHog once on the client with autocapture + session replay ON
 * (per Demo 0.5 rehearsal spec), and fires a $pageview on every route change
 * since the Next.js App Router doesn't trigger a full reload.
 *
 * No-ops when NEXT_PUBLIC_POSTHOG_KEY is unset (local dev without the env var).
 */
export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;
    if (posthog.__loaded) return;

    posthog.init(key, {
      api_host:
        process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
      // Rehearsal spec: autocapture ON, session replay ON.
      autocapture: true,
      capture_pageview: false, // we fire manually on route change (below)
      capture_pageleave: true,
      session_recording: {
        maskAllInputs: false, // demo-mode names/emails are test data
      },
      disable_session_recording: false,
      persistence: "localStorage+cookie",
      loaded: (ph) => {
        if (process.env.NODE_ENV === "development") {
          ph.debug();
        }
      },
    });
  }, []);

  return (
    <>
      <Suspense fallback={null}>
        <PostHogPageview />
      </Suspense>
      {children}
    </>
  );
}

function PostHogPageview() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!posthog.__loaded) return;
    if (!pathname) return;
    const qs = searchParams?.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}
