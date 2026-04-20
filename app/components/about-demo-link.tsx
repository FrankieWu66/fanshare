"use client";

import Link from "next/link";
import { track } from "../lib/analytics/track";

/**
 * Nav link to /invite, fires `about_demo_clicked`. Used on /, /trade/[id],
 * /leaderboard, /portfolio. Hidden below the `sm` breakpoint except on the
 * home page (handled by caller via className override).
 */
export function AboutDemoLink({
  className = "inline-flex min-h-[44px] items-center text-xs font-medium text-muted transition hover:text-foreground max-sm:hidden",
  source,
}: {
  className?: string;
  source?: string;
}) {
  return (
    <Link
      href="/invite"
      onClick={() => track("about_demo_clicked", { source: source ?? null })}
      className={className}
    >
      About this demo →
    </Link>
  );
}
