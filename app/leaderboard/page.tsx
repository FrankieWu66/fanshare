"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { GridBackground } from "../components/grid-background";
import { ClusterSelect } from "../components/cluster-select";
import { WalletButton } from "../components/wallet-button";
import { Badge } from "../components/badge";
import { useWallet } from "../lib/wallet/context";
import { ellipsify } from "../lib/explorer";
import { formatLeaderboardScore } from "../lib/leaderboard-format";

type Tab = "top-traders" | "sharp-calls";

interface TopTraderEntry {
  rank: number;
  wallet: string;
  score: number;
  trade_count: number;
}

interface SharpCallEntry {
  rank: number;
  wallet: string;
  score: number;
  qualifying_calls: number;
}


export default function LeaderboardPage() {
  const { wallet } = useWallet();
  const currentWallet = wallet?.account.address;

  const [tab, setTab] = useState<Tab>("top-traders");
  const [topTraders, setTopTraders] = useState<TopTraderEntry[]>([]);
  const [sharpCalls, setSharpCalls] = useState<SharpCallEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchLeaderboard() {
      setIsLoading(true);
      setError(null);

      const url =
        tab === "top-traders"
          ? "/api/leaderboard/top-traders"
          : "/api/leaderboard/sharp-calls";

      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;

        if (tab === "top-traders") {
          setTopTraders(data.leaderboard ?? []);
        } else {
          setSharpCalls(data.leaderboard ?? []);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchLeaderboard();
    // Refresh every 30s
    const interval = setInterval(fetchLeaderboard, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tab]);

  const entries = tab === "top-traders" ? topTraders : sharpCalls;

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <GridBackground />
      <div className="relative z-10">
        {/* Header */}
        <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center text-sm text-muted transition hover:text-foreground"
            >
              ← Market
            </Link>
            <span className="text-muted">/</span>
            <span className="text-sm font-semibold">Leaderboard</span>
          </div>
          <div className="flex items-center gap-3">
            <ClusterSelect />
            <WalletButton />
          </div>
        </header>

        <main className="mx-auto max-w-3xl px-6 pb-20">
          {/* Page title */}
          <div className="mb-6">
            <h1 className="font-display text-3xl font-extrabold tracking-tight md:text-4xl">
              Leaderboard
            </h1>
            <p className="mt-1 text-sm text-muted">
              Top performers ranked by trading skill and sharp calls.
            </p>
          </div>

          {/* Tabs */}
          <div className="mb-6 flex rounded-xl border border-border-low">
            <button
              onClick={() => { setIsLoading(true); setTab("top-traders"); }}
              className={`flex-1 cursor-pointer rounded-l-xl py-3 text-sm font-medium transition ${
                tab === "top-traders"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Top Traders
            </button>
            <button
              onClick={() => { setIsLoading(true); setTab("sharp-calls"); }}
              className={`flex-1 cursor-pointer rounded-r-xl py-3 text-sm font-medium transition ${
                tab === "sharp-calls"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Sharp Calls
            </button>
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-xl border border-border-low bg-card">
            {isLoading ? (
              <div className="space-y-0">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-4 border-b border-border-low px-4 py-3 last:border-0"
                  >
                    <div className="h-5 w-6 animate-pulse rounded bg-border-low" />
                    <div className="h-4 w-32 animate-pulse rounded bg-border-low" />
                    <div className="ml-auto h-4 w-20 animate-pulse rounded bg-border-low" />
                    <div className="h-4 w-12 animate-pulse rounded bg-border-low" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="px-4 py-12 text-center text-sm text-muted">
                Failed to load leaderboard. Try again later.
              </div>
            ) : entries.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="text-sm text-muted">
                  No {tab === "top-traders" ? "traders" : "sharp calls"} yet.
                </p>
                <p className="mt-1 text-xs text-muted/60">
                  Start trading to appear on the leaderboard.
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-low text-xs text-muted">
                    <th className="px-4 py-2.5 text-left font-medium w-12">
                      Rank
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium">
                      Wallet
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      {tab === "top-traders" ? "PnL (USD)" : "Score"}
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      {tab === "top-traders" ? "Trades" : "Calls"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const isCurrentUser = currentWallet === entry.wallet;
                    const count =
                      tab === "top-traders"
                        ? (entry as TopTraderEntry).trade_count
                        : (entry as SharpCallEntry).qualifying_calls;
                    const scoreColor =
                      tab === "top-traders"
                        ? entry.score >= 0
                          ? "text-positive"
                          : "text-negative"
                        : "text-foreground";

                    return (
                      <tr
                        key={entry.wallet}
                        className={`border-b border-border-low last:border-0 transition ${
                          isCurrentUser
                            ? "bg-accent-subtle"
                            : "hover:bg-accent-subtle/30"
                        }`}
                      >
                        <td className="px-4 py-3">
                          <span
                            className={`font-mono text-sm font-semibold tabular-nums ${
                              entry.rank <= 3 ? "text-accent" : "text-muted"
                            }`}
                          >
                            #{entry.rank}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs">
                              {ellipsify(entry.wallet, 4)}
                            </span>
                            <Badge wallet={entry.wallet} />
                            {isCurrentUser && (
                              <span className="rounded-sm bg-accent-subtle px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
                                you
                              </span>
                            )}
                          </div>
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono font-medium tabular-nums ${scoreColor}`}
                        >
                          {formatLeaderboardScore(entry.score, tab)}
                          {tab === "sharp-calls" && (
                            <span className="ml-1 text-xs font-normal text-muted">
                              pts
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-muted">
                          {count ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Legend */}
          <div className="mt-4 text-xs text-muted">
            {tab === "top-traders" ? (
              <p>
                Ranked by realized PnL (value received from sells minus value spent on buys).
              </p>
            ) : (
              <p>
                Sharp call = buying when undervalued and selling at profit.
                Score = profit % x spread at buy. Higher is better.
              </p>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
