"use client";

import useSWR from "swr";

type BadgeTier =
  | "sharp"
  | "elite"
  | "oracle"
  // Demo 1 locked-state tiers (no backend — display only, earnable flag deferred to Demo 2)
  | "early_adopter"
  | "sharp_caller"
  | "diamond_hands";

interface BadgeData {
  tier: BadgeTier;
  label: string;
}

const TIER_STYLES: Record<BadgeTier, { bg: string; text: string }> = {
  sharp: { bg: "bg-positive/15", text: "text-positive" },
  elite: { bg: "bg-[#A855F7]/15", text: "text-[#A855F7]" },
  oracle: { bg: "bg-accent-subtle", text: "text-accent" },
  early_adopter: { bg: "bg-accent-subtle", text: "text-accent" },
  sharp_caller: { bg: "bg-positive/15", text: "text-positive" },
  diamond_hands: { bg: "bg-[#A855F7]/15", text: "text-[#A855F7]" },
};

const TIER_LABELS: Record<BadgeTier, string> = {
  sharp: "Sharp",
  elite: "Elite",
  oracle: "Oracle",
  early_adopter: "Early Adopter",
  sharp_caller: "Sharp Caller",
  diamond_hands: "Diamond Hands",
};

const badgeFetcher = async (url: string): Promise<BadgeData | null> => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    // API returns { wallet, badge: { tier, qualifying_calls } | null }
    if (!data.badge?.tier) return null;
    const tier = data.badge.tier as BadgeTier;
    return {
      tier,
      label: TIER_LABELS[tier] ?? tier,
    };
  } catch {
    return null;
  }
};

interface BadgeProps {
  wallet: string;
  className?: string;
}

/**
 * Small inline pill/tag showing the Sharp badge tier for a wallet.
 * Fetches from /api/badge/[wallet]. Renders nothing if no badge or fetch fails.
 */
export function Badge({ wallet, className = "" }: BadgeProps) {
  const { data: badge } = useSWR(
    wallet ? `/api/badge/${wallet}` : null,
    badgeFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );

  if (!badge) return null;

  const style = TIER_STYLES[badge.tier];

  return (
    <span
      className={`inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide ${style.bg} ${style.text} ${className}`}
    >
      {badge.label}
    </span>
  );
}

/**
 * Static badge display without fetching — for use when tier is already known.
 * Pass `locked` to render a disabled variant with a padlock glyph (used on the
 * invite page to preview earnable tiers).
 */
export function StaticBadge({
  tier,
  locked = false,
  className = "",
}: {
  tier: BadgeTier;
  locked?: boolean;
  className?: string;
}) {
  const style = TIER_STYLES[tier];
  const label = TIER_LABELS[tier];

  if (locked) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide opacity-40 ${style.bg} ${style.text} ${className}`}
        title="Locked — earnable in a future demo"
      >
        {/* Inline padlock SVG — avoid emoji per DESIGN_SYSTEM.md chrome rules */}
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor" aria-hidden="true">
          <path d="M6 1a3 3 0 0 0-3 3v2H2.5A.5.5 0 0 0 2 6.5v4a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 0-.5-.5H9V4a3 3 0 0 0-3-3Zm2 5H4V4a2 2 0 1 1 4 0v2Z" />
        </svg>
        {label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide ${style.bg} ${style.text} ${className}`}
    >
      {label}
    </span>
  );
}
