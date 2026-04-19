"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { type Address } from "@solana/kit";
import { GridBackground } from "../components/grid-background";
import { ClusterSelect } from "../components/cluster-select";
import { WalletButton } from "../components/wallet-button";
import { useWallet } from "../lib/wallet/context";
import { usePlayerMarkets } from "../lib/hooks/use-player-markets";
import { usePortfolioBalances } from "../lib/hooks/use-portfolio-balances";
import { formatUsd } from "../lib/oracle-weights";

export default function PortfolioPage() {
  const { wallet, status, isDemoMode } = useWallet();
  const { players, isLoading: marketsLoading } = usePlayerMarkets();
  const address = wallet?.account.address as Address | undefined;

  const { balances, isLoading: balancesLoading } = usePortfolioBalances(address);
  const [search, setSearch] = useState("");

  // Cross-reference player mints with token balances
  const holdings = useMemo(() => {
    return players
      .filter((p) => {
        const mint = p.curve?.mint;
        return mint && !mint.startsWith("mock-") && balances.has(mint);
      })
      .map((p) => ({
        player: p,
        tokenAmount: balances.get(p.curve!.mint)!,
      }))
      .sort((a, b) => (a.player.config.displayName < b.player.config.displayName ? -1 : 1));
  }, [players, balances]);

  const filteredHoldings = useMemo(() => {
    if (!search.trim()) return holdings;
    const q = search.toLowerCase();
    return holdings.filter(
      ({ player }) =>
        player.config.displayName.toLowerCase().includes(q) ||
        player.config.team.toLowerCase().includes(q)
    );
  }, [holdings, search]);

  const isLoading = marketsLoading || balancesLoading;

  const header = (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
      <div className="flex items-center gap-3">
        <Link href="/" className="inline-flex min-h-[44px] items-center text-sm text-muted transition hover:text-foreground">
          ← Market
        </Link>
        <span className="text-muted">/</span>
        <span className="text-sm font-semibold">Portfolio</span>
      </div>
      <div className="flex items-center gap-3">
        <ClusterSelect />
        <WalletButton />
      </div>
    </header>
  );

  if (status !== "connected") {
    return (
      <div className="relative min-h-screen bg-background text-foreground">
        <GridBackground />
        <div className="relative z-10">
          {header}
          <main className="mx-auto max-w-6xl px-6 pb-20">
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <p className="text-4xl mb-4">🏀</p>
              <h1 className="mb-2 text-xl font-bold">Connect your wallet</h1>
              <p className="text-sm text-muted">Sign in to see your player token holdings.</p>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <GridBackground />
      <div className="relative z-10">
        {header}

        <main className="mx-auto max-w-6xl px-6 pb-20">
          <div className="mb-6">
            <h1 className="text-2xl font-bold">My Portfolio</h1>
            {isDemoMode && (
              <p className="mt-1 text-sm text-muted">Demo mode — fake SOL, nothing is real.</p>
            )}
          </div>

          {holdings.length > 0 && (
            <div className="mb-4">
              <input
                type="text"
                placeholder="Search players…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm placeholder:text-muted focus:border-accent focus:outline-none sm:w-64"
              />
            </div>
          )}

          {isLoading ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted">
              Loading holdings…
            </div>
          ) : holdings.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <p className="mb-1 text-2xl">📭</p>
              <p className="text-sm font-medium">No positions yet.</p>
              <p className="mt-1 text-sm text-muted">
                Your edge starts with one trade.
              </p>
              <Link href="/" className="mt-4 inline-block text-sm text-accent underline hover:opacity-80">
                Browse players
              </Link>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted">
                    <th className="px-4 py-3 text-left font-medium">Player</th>
                    <th className="px-4 py-3 text-right font-medium">Tokens</th>
                    <th className="px-4 py-3 text-right font-medium max-sm:hidden">Price</th>
                    <th className="px-4 py-3 text-right font-medium">Est. Value</th>
                    <th className="px-4 py-3 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHoldings.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted">
                        No players match &ldquo;{search}&rdquo;
                      </td>
                    </tr>
                  ) : null}
                  {filteredHoldings.map(({ player, tokenAmount }) => {
                    // Est. value: tokens * current price in lamports
                    const valueLamports = (tokenAmount * player.currentPrice) / 1_000_000_000n;

                    return (
                      <tr key={player.config.id} className="border-b border-border last:border-0 hover:bg-accent-subtle/20">
                        <td className="px-4 py-3">
                          <Link href={`/trade/${player.config.id}`} className="flex items-center gap-2 transition hover:opacity-80">
                            <span className="text-xl">{player.config.emoji}</span>
                            <div>
                              <p className="font-semibold">{player.config.displayName}</p>
                              <p className="text-xs text-muted">{player.config.team} · {player.config.position}</p>
                            </div>
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {tokenAmount.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-muted max-sm:hidden">
                          {formatUsd(player.currentPrice)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold">
                          ~{formatUsd(valueLamports)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/trade/${player.config.id}`}
                            className="rounded-lg border border-border-low bg-card px-3 py-1.5 text-xs font-medium transition hover:bg-cream"
                          >
                            Trade
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
