import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DEVNET_PLAYERS } from "../../lib/fanshare-program";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ playerId: string }>;
}): Promise<Metadata> {
  const { playerId } = await params;
  const config = DEVNET_PLAYERS.find((p) => p.id === playerId);
  if (!config) {
    return { title: "FanShare" };
  }
  return {
    title: `${config.emoji} ${config.displayName} — FanShare`,
    description: `Trade ${config.displayName} player tokens on FanShare. ${config.position} for the ${config.team}.`,
  };
}

export default function TradeLayout({ children }: { children: ReactNode }) {
  return children;
}
