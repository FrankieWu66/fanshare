"use client";

import useSWR from "swr";

type BadgeTier = "sharp" | "elite" | "oracle";

interface BadgeData {
  tier: BadgeTier;
  label: string;
}

const TIER_STYLES: Record<BadgeTier, { bg: string; text: string }> = {
  sharp: { bg: "bg-positive/15", text: "text-positive" },
  elite: { bg: "bg-[#A855F7]/15", text: "text-[#A855F7]" },
  oracle: { bg: "bg-accent-subtle", text: "text-accent" },
};

const TIER_LABELS: Record<BadgeTier, string> = {
  sharp: "Sharp",
  elite: "Elite",
  oracle: "Oracle",
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
 */
export function StaticBadge({
  tier,
  className = "",
}: {
  tier: BadgeTier;
  className?: string;
}) {
  const style = TIER_STYLES[tier];
  const label = TIER_LABELS[tier];

  return (
    <span
      className={`inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide ${style.bg} ${style.text} ${className}`}
    >
      {label}
    </span>
  );
}
