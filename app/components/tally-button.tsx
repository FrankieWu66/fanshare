"use client";

import { useEffect } from "react";
import Script from "next/script";
import { track } from "../lib/analytics/track";

/**
 * Tally floating feedback button — injected on every page.
 *
 * Renders nothing until NEXT_PUBLIC_TALLY_FORM_ID is set. Tally's embed.js
 * hooks any element with [data-tally-open="FORM_ID"] and turns it into a
 * popup trigger.
 */
export function TallyButton() {
  const formId = process.env.NEXT_PUBLIC_TALLY_FORM_ID;

  // Fire `feedback_opened` the moment the popup opens. Tally posts a message
  // through window.Tally.events when it's available; easier is to hook the
  // button click itself, which we own.
  useEffect(() => {
    // Nothing to clean up — effect exists so the component mounts cleanly.
  }, []);

  if (!formId) return null;

  return (
    <>
      <Script
        src="https://tally.so/widgets/embed.js"
        strategy="lazyOnload"
      />
      <button
        type="button"
        data-tally-open={formId}
        data-tally-layout="modal"
        data-tally-width="500"
        data-tally-emoji-text="📝"
        data-tally-emoji-animation="wave"
        aria-label="Send feedback"
        onClick={() => track("feedback_opened")}
        className="fixed bottom-4 right-4 z-40 inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-4 text-xs font-semibold text-foreground shadow-lg shadow-black/20 transition hover:-translate-y-px hover:border-accent/50 hover:bg-cream max-sm:h-10 max-sm:px-3"
      >
        <span aria-hidden="true">💬</span>
        <span>Feedback</span>
      </button>
    </>
  );
}
