"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";
import { track } from "../lib/analytics/track";

/**
 * Tally floating feedback button — injected on every page.
 *
 * Renders nothing until NEXT_PUBLIC_TALLY_FORM_ID is set. Tally's embed.js
 * hooks any element with [data-tally-open="FORM_ID"] and turns it into a
 * popup trigger.
 *
 * Why native capture-phase listener instead of React onClick:
 *   Tally's embed.js attaches a click handler on the button and stops
 *   propagation. React's delegated onClick (which listens at the root) never
 *   sees the event. We attach our `feedback_opened` listener in the capture
 *   phase so we fire before Tally's handler has a chance to stop it.
 */
export function TallyButton() {
  const formId = process.env.NEXT_PUBLIC_TALLY_FORM_ID;
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const el = btnRef.current;
    if (!el) return;
    const onClickCapture = () => {
      track("feedback_opened");
    };
    el.addEventListener("click", onClickCapture, { capture: true });
    return () => {
      el.removeEventListener("click", onClickCapture, { capture: true });
    };
  }, []);

  if (!formId) return null;

  return (
    <>
      <Script
        src="https://tally.so/widgets/embed.js"
        strategy="lazyOnload"
      />
      <button
        ref={btnRef}
        type="button"
        data-tally-open={formId}
        data-tally-layout="modal"
        data-tally-width="500"
        data-tally-emoji-text="📝"
        data-tally-emoji-animation="wave"
        aria-label="Send feedback"
        className="fixed bottom-4 right-4 z-40 inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-4 text-xs font-semibold text-foreground shadow-lg shadow-black/20 transition hover:-translate-y-px hover:border-accent/50 hover:bg-cream max-sm:h-10 max-sm:px-3"
      >
        <span aria-hidden="true">💬</span>
        <span>Feedback</span>
      </button>
    </>
  );
}
