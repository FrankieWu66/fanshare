"use client";

import { useState } from "react";
import { lamports as sol } from "@solana/kit";
import { toast } from "sonner";
import { useWallet } from "./lib/wallet/context";
import { useBalance } from "./lib/hooks/use-balance";
import { usePlayerMarkets } from "./lib/hooks/use-player-markets";
import { lamportsToSolString } from "./lib/lamports";
import { useSolanaClient } from "./lib/solana-client-context";
import { ellipsify } from "./lib/explorer";
import { PlayerCard } from "./components/player-card";
import { GridBackground } from "./components/grid-background";
import { ClusterSelect } from "./components/cluster-select";
import { WalletButton } from "./components/wallet-button";
import { useCluster } from "./components/cluster-context";

export default function Home() {
  const { wallet, status } = useWallet();
  const { cluster, getExplorerUrl } = useCluster();
  const client = useSolanaClient();
  const { players, isLoading } = usePlayerMarkets();

  const address = wallet?.account.address;
  const balance = useBalance(address);
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState<"all" | "undervalued">("all");

  const filteredPlayers =
    filter === "undervalued"
      ? players.filter((p) => p.spreadPercent < 0)
      : players;

  const handleCopy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAirdrop = async () => {
    if (!address) return;
    try {
      toast.info("Requesting airdrop...");
      const sig = await client.airdrop(address, sol(1_000_000_000n));
      toast.success("Airdrop received!", {
        description: sig ? (
          <a
            href={getExplorerUrl(`/tx/${sig}`)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            View transaction
          </a>
        ) : undefined,
      });
    } catch (err) {
      console.error("Airdrop failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimited =
        msg.includes("429") || msg.includes("Internal JSON-RPC error");
      toast.error(
        isRateLimited
          ? "Devnet faucet rate-limited. Use the web faucet instead."
          : "Airdrop failed. Try again later.",
        isRateLimited
          ? {
              description: (
                <a
                  href="https://faucet.solana.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Open faucet.solana.com
                </a>
              ),
            }
          : undefined
      );
    }
  };

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <GridBackground />

      <div className="relative z-10">
        {/* Header */}
        <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-sm font-bold tracking-tight">
            FanShare
            <span className="ml-1 rounded bg-accent-subtle px-1.5 py-0.5 text-[10px] font-medium text-accent">
              {cluster}
            </span>
          </span>
          <div className="flex items-center gap-3">
            <ClusterSelect />
            <WalletButton />
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6">
          {/* Hero */}
          <section className="pt-6 pb-12 md:pt-8 md:pb-16">
            <div className="flex flex-col gap-4">
              <h1 className="font-display font-extrabold tracking-tight text-foreground">
                <span className="block text-5xl md:text-6xl">
                  Stock Market
                </span>
                <span className="block text-5xl md:text-6xl text-muted">
                  for Human Performance
                </span>
              </h1>
              <p className="max-w-xl text-base leading-relaxed text-foreground/50">
                Trade tokens pegged to NBA player performance. Price moves with
                supply and demand. Stats index shows what each player is actually
                worth.
              </p>
            </div>
          </section>

          {/* Wallet Balance */}
          {status === "connected" && address && (
            <section className="relative mb-8 w-full overflow-hidden rounded-2xl border border-border-low bg-card px-5 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">Balance</span>
                  <button
                    onClick={handleCopy}
                    className="flex cursor-pointer items-center gap-1.5 font-mono text-xs text-muted transition hover:text-foreground"
                  >
                    {ellipsify(address, 4)}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-3 w-3"
                    >
                      {copied ? (
                        <path d="M20 6 9 17l-5-5" />
                      ) : (
                        <>
                          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <p className="font-mono text-2xl font-bold tabular-nums tracking-tight">
                    {balance.lamports != null
                      ? lamportsToSolString(balance.lamports)
                      : "\u2014"}
                    <span className="ml-1 text-sm font-normal text-muted">SOL</span>
                  </p>
                  {cluster !== "mainnet" && (
                    <button
                      onClick={handleAirdrop}
                      className="cursor-pointer rounded-lg border border-border-low px-3 py-1.5 text-xs font-medium transition hover:bg-cream"
                    >
                      Airdrop
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* Market Filter */}
          <div className="mb-6 flex items-center gap-3">
            <h2 className="text-lg font-semibold">Player Tokens</h2>
            <div className="flex rounded-lg border border-border-low">
              <button
                onClick={() => setFilter("all")}
                className={`cursor-pointer px-3 py-1 text-xs font-medium transition ${
                  filter === "all"
                    ? "bg-foreground text-background"
                    : "text-muted hover:text-foreground"
                } rounded-l-lg`}
              >
                All
              </button>
              <button
                onClick={() => setFilter("undervalued")}
                className={`cursor-pointer px-3 py-1 text-xs font-medium transition ${
                  filter === "undervalued"
                    ? "bg-accent text-accent-foreground"
                    : "text-muted hover:text-foreground"
                } rounded-r-lg`}
              >
                Undervalued
              </button>
            </div>
          </div>

          {/* Player Grid */}
          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 pb-20 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-48 animate-pulse rounded-2xl border border-border-low bg-card"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 pb-20 md:grid-cols-2 lg:grid-cols-3">
              {filteredPlayers.map((player) => (
                <PlayerCard key={player.config.id} player={player} />
              ))}
              {filteredPlayers.length === 0 && (
                <p className="col-span-full text-center text-muted py-12">
                  No {filter === "undervalued" ? "undervalued " : ""}players found.
                </p>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
