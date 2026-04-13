"use client";

import { useState, useCallback, use, useEffect, useRef } from "react";
import useSWR from "swr";
import { type Address } from "@solana/kit";
import Link from "next/link";
import { toast } from "sonner";
import { useWallet } from "../../lib/wallet/context";
import { useBalance } from "../../lib/hooks/use-balance";
import { useTokenBalance } from "../../lib/hooks/use-token-balance";
import { usePlayerData } from "../../lib/hooks/use-player-markets";
import { useSendTransaction } from "../../lib/hooks/use-send-transaction";
import {
  getBondingCurvePda,
  getAssociatedTokenAccount,
  getBuyWithSolInstruction,
  getCreateAtaIdempotentInstruction,
  getSellInstruction,
  applySlippage,
} from "../../lib/fanshare-instructions";
import { lamportsToSolString } from "../../lib/lamports";
import { GridBackground } from "../../components/grid-background";
import { ClusterSelect } from "../../components/cluster-select";
import { useCluster } from "../../components/cluster-context";
import { WalletButton } from "../../components/wallet-button";
import { BondingCurveChart } from "../../components/bonding-curve-chart";
import { PriceHistoryChart } from "../../components/price-history-chart";
import {
  formatSol,
  calculateSellReturn,
  calculateTokensForSol,
  currentPrice,
} from "../../lib/bonding-curve";
import { type PlayerConfig, DEFAULT_BASE_PRICE, DEFAULT_SLOPE, DEVNET_PLAYERS } from "../../lib/fanshare-program";
import { parseTransactionError } from "../../lib/errors";
import { recordTrade, loadTradesForPlayer, type TradeRecord } from "../../lib/trade-history";
import { recordLocalPrice, loadLocalPriceHistory, mergePriceHistory } from "../../lib/local-price-history";

// Module-level fetcher — stable reference, avoids new function on every render
const jsonFetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(r.statusText);
    return r.json();
  });

type TxStage = "idle" | "signing" | "confirming" | "success" | "failed";

const SLIPPAGE_PCT = 1; // 1% slippage tolerance

export default function TradePage({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = use(params);
  const { player, isLoading } = usePlayerData(playerId);
  const { wallet, status, isDemoMode } = useWallet();
  const { send } = useSendTransaction();
  const { cluster } = useCluster(); // getExplorerUrl wired post-deploy

  const address = wallet?.account.address;
  const balance = useBalance(address);
  const mintAddress = player?.curve?.mint as Address | undefined;
  const tokenBalance = useTokenBalance(address, mintAddress);

  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [chartView, setChartView] = useState<"curve" | "history">("curve");
  const [solInput, setSolInput] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [txStage, setTxStage] = useState<TxStage>("idle");
  const [txError, setTxError] = useState<string | null>(null);
  const [localTrades, setLocalTrades] = useState<TradeRecord[]>(() => loadTradesForPlayer(playerId));
  const [localPrices, setLocalPrices] = useState(() => loadLocalPriceHistory(playerId));
  const txTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: priceHistory = [] } = useSWR(
    chartView === "history" ? `/api/price-history/${playerId}?cluster=${cluster}` : null,
    jsonFetcher,
    { refreshInterval: 30_000 }
  );

  // Auto-reset from success back to idle after 3s
  useEffect(() => {
    if (txStage === "success") {
      txTimerRef.current = setTimeout(() => {
        setTxStage("idle");
        setSolInput("");
        setTokenInput("");
      }, 3000);
    }
    return () => { if (txTimerRef.current) clearTimeout(txTimerRef.current); };
  }, [txStage]);

  const isBusy = txStage !== "idle";

  // ── Derived curve values ──────────────────────────────────────────────────
  const curve = player?.curve;
  const basePrice = curve?.basePrice ?? DEFAULT_BASE_PRICE;
  const slope = curve?.slope ?? DEFAULT_SLOPE;
  const tokensSold = curve?.tokensSold ?? 0n;
  const totalSupply = curve?.totalSupply ?? 1_000_000n;
  const indexPrice = player?.oracle?.indexPriceLamports ?? 0n;
  const marketPrice = currentPrice(basePrice, slope, tokensSold);

  // How many tokens would buying X SOL get you?
  // Guard against NaN/Infinity from scientific notation inputs (e.g. "1e308")
  const _parsedSol = parseFloat(solInput || "0") * 1e9;
  const solLamports = Number.isFinite(_parsedSol) ? BigInt(Math.floor(_parsedSol)) : 0n;
  const tokensOut = calculateTokensForSol(
    basePrice,
    slope,
    tokensSold,
    solLamports,
    totalSupply
  );

  // How much SOL would selling X tokens return?
  const tokenAmountIn = BigInt(Math.floor(parseFloat(tokenInput || "0")));
  const solOut =
    tokenAmountIn > 0n && tokenAmountIn <= tokensSold
      ? calculateSellReturn(basePrice, slope, tokensSold, tokenAmountIn)
      : 0n;

  // After-trade price preview
  const priceAfterBuy =
    tokensOut > 0n
      ? currentPrice(basePrice, slope, tokensSold + tokensOut)
      : marketPrice;
  const priceAfterSell =
    tokenAmountIn > 0n && tokenAmountIn <= tokensSold
      ? currentPrice(basePrice, slope, tokensSold - tokenAmountIn)
      : marketPrice;

  // Supply bar
  const supplyPct = totalSupply > 0n ? (Number(tokensSold) / Number(totalSupply)) * 100 : 0;

  // Spread signal
  const spread = player?.spreadPercent ?? 0;
  const spreadLabel =
    indexPrice === 0n
      ? null
      : spread < -5
        ? { text: "Undervalued", color: "text-accent", bg: "bg-accent-subtle" }
        : spread > 5
          ? { text: "Overvalued", color: "text-negative", bg: "bg-negative/10" }
          : { text: "Fair value", color: "text-muted", bg: "bg-cream" };

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleBuy = useCallback(async () => {
    if (isBusy || !address || !player || !curve || solLamports === 0n || tokensOut === 0n) return;
    setTxError(null);
    setTxStage("signing");
    try {
      const mint = curve.mint as Address;
      const [bondingCurve, buyerTokenAccount] = await Promise.all([
        getBondingCurvePda(mint),
        getAssociatedTokenAccount(address, mint),
      ]);
      const minTokensOut = applySlippage(tokensOut, SLIPPAGE_PCT);
      const createAtaIx = getCreateAtaIdempotentInstruction({
        payer: address,
        owner: address,
        mint,
        ata: buyerTokenAccount,
      });
      const ix = getBuyWithSolInstruction({
        buyer: address,
        mint,
        bondingCurve,
        buyerTokenAccount,
        solAmount: solLamports,
        minTokensOut,
      });
      const sig = await send({ instructions: [createAtaIx, ix] });
      recordTrade({
        playerId,
        playerName: player.config.displayName,
        type: "buy",
        solAmount: Number(solLamports) / 1e9,
        tokenAmount: Number(tokensOut),
        signature: sig ?? "",
        timestamp: Date.now(),
      });
      recordLocalPrice(playerId, priceAfterBuy);
      setLocalTrades(loadTradesForPlayer(playerId));
      setLocalPrices(loadLocalPriceHistory(playerId));
      setTxStage("success");
      toast.success(`Bought ${tokensOut.toLocaleString()} tokens!`, {
        description: sig ? `Tx: ${sig.slice(0, 8)}…` : undefined,
      });
    } catch (err: unknown) {
      const msg = parseTransactionError(err);
      setTxError(msg);
      setTxStage("failed");
    }
  }, [isBusy, address, player, curve, solLamports, tokensOut, send, playerId]);

  const handleSell = useCallback(async () => {
    if (isBusy || !address || !player || !curve || tokenAmountIn === 0n || solOut === 0n) return;
    setTxError(null);
    setTxStage("signing");
    try {
      const mint = curve.mint as Address;
      const [bondingCurve, buyerTokenAccount] = await Promise.all([
        getBondingCurvePda(mint),
        getAssociatedTokenAccount(address, mint),
      ]);
      const minSolOut = applySlippage(solOut, SLIPPAGE_PCT);
      const ix = getSellInstruction({
        buyer: address,
        mint,
        bondingCurve,
        buyerTokenAccount,
        tokenAmount: tokenAmountIn,
        minSolOut,
      });
      const sig = await send({ instructions: [ix] });
      recordTrade({
        playerId,
        playerName: player.config.displayName,
        type: "sell",
        solAmount: Number(solOut) / 1e9,
        tokenAmount: Number(tokenAmountIn),
        signature: sig ?? "",
        timestamp: Date.now(),
      });
      recordLocalPrice(playerId, priceAfterSell);
      setLocalTrades(loadTradesForPlayer(playerId));
      setLocalPrices(loadLocalPriceHistory(playerId));
      setTxStage("success");
      toast.success(`Sold ${tokenAmountIn.toLocaleString()} tokens for ${formatSol(solOut)} SOL`, {
        description: sig ? `Tx: ${sig.slice(0, 8)}…` : undefined,
      });
    } catch (err: unknown) {
      const msg = parseTransactionError(err);
      setTxError(msg);
      setTxStage("failed");
    }
  }, [isBusy, address, player, curve, tokenAmountIn, solOut, send, playerId]);

  // ── Loading / not found ───────────────────────────────────────────────────
  if (isLoading) {
    const skeletonConfig = DEVNET_PLAYERS.find((p) => p.id === playerId);
    return (
      <div className="relative min-h-screen bg-background text-foreground">
        <GridBackground />
        <div className="relative z-10">
          <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <div className="flex items-center gap-3">
              <Link href="/" className="inline-flex min-h-[44px] items-center text-sm text-muted transition hover:text-foreground">
                ← Market
              </Link>
              {skeletonConfig && (
                <>
                  <span className="text-muted">/</span>
                  <span className="text-sm font-semibold">{skeletonConfig.displayName}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-3">
              <ClusterSelect />
              <WalletButton />
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-6 pb-20">
            {/* Player hero */}
            <div className="mb-6 flex items-start">
              {skeletonConfig ? (
                <div className="flex items-center gap-3">
                  <span className="text-5xl">{skeletonConfig.emoji}</span>
                  <div>
                    <h1 className="font-display text-4xl font-extrabold tracking-tight">{skeletonConfig.displayName}</h1>
                    <div className="mt-1 flex items-center gap-2 text-sm text-muted">
                      <span>{skeletonConfig.position}</span>
                      <span>·</span>
                      <span>{skeletonConfig.team}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-12 w-56 animate-pulse rounded-lg bg-border-low" />
              )}
            </div>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              {/* Stats sidebar skeleton */}
              <div className="order-2 space-y-4 lg:order-1 lg:col-span-3">
                <div className="rounded-xl border border-border-low bg-card p-5">
                  <div className="mb-4 h-3 w-28 animate-pulse rounded bg-border-low" />
                  <div className="space-y-3">
                    {[...Array(5)].map((_, i) => (
                      <div key={i}>
                        <div className="mb-1 flex justify-between">
                          <div className="h-2.5 w-16 animate-pulse rounded bg-border-low" />
                          <div className="h-2.5 w-8 animate-pulse rounded bg-border-low" />
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-border-low" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {/* Chart skeleton */}
              <div className="order-3 space-y-4 lg:order-2 lg:col-span-5">
                <div className="rounded-xl border border-border-low bg-card p-5">
                  <div className="mb-3 h-8 w-36 animate-pulse rounded-lg bg-border-low" />
                  <div className="h-[164px] animate-pulse rounded-lg bg-border-low" />
                  <div className="mt-3 h-1.5 w-full rounded-full bg-border-low" />
                </div>
              </div>
              {/* Trade widget — show immediately with tabs active */}
              <div className="order-1 lg:order-3 lg:col-span-4">
                <div className="rounded-2xl border border-border-low bg-card p-5">
                  <div className="mb-5 flex rounded-xl border border-border-low">
                    <button
                      onClick={() => setTab("buy")}
                      className={`flex-1 cursor-pointer rounded-l-xl py-3 text-sm font-medium transition ${tab === "buy" ? "bg-positive text-background" : "text-muted hover:text-foreground"}`}
                    >
                      Buy
                    </button>
                    <button
                      onClick={() => setTab("sell")}
                      className={`flex-1 cursor-pointer rounded-r-xl py-3 text-sm font-medium transition ${tab === "sell" ? "bg-negative text-background" : "text-muted hover:text-foreground"}`}
                    >
                      Sell
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="trade-input-loading" className="mb-1.5 block text-xs text-muted">
                        {tab === "buy" ? "SOL to spend" : "Tokens to sell"}
                      </label>
                      <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
                        <input
                          id="trade-input-loading"
                          type="number"
                          min="0"
                          placeholder="0.00"
                          disabled
                          className="w-full bg-transparent font-mono text-sm outline-none placeholder:text-muted"
                        />
                        <span className="text-xs text-muted">{tab === "buy" ? "SOL" : "tokens"}</span>
                      </div>
                    </div>
                    <div className="h-10 w-full animate-pulse rounded-xl bg-border-low" />
                    <p className="text-center text-xs text-muted">Loading market data…</p>
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (!player) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
        <p className="text-muted">Player not found: {playerId}</p>
        <Link href="/" className="text-sm underline">
          Back to market
        </Link>
      </div>
    );
  }

  const { config } = player;
  const stats = config.stats;

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
            <span className="text-sm font-semibold">{config.displayName}</span>
          </div>
          <div className="flex items-center gap-3">
            <ClusterSelect />
            <WalletButton />
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 pb-20">
          {/* Player Hero */}
          <div className="mb-6 flex flex-wrap items-start justify-between gap-y-3">
            <div className="flex items-center gap-3">
              <span className="text-4xl md:text-5xl">{config.emoji}</span>
              <div>
                <h1 className="font-display text-3xl font-extrabold tracking-tight md:text-4xl">
                  {config.displayName}
                </h1>
                <div className="mt-1 flex items-center gap-2 text-sm text-muted">
                  <span>{config.position}</span>
                  <span>·</span>
                  <span>{config.team}</span>
                  <span>·</span>
                  <span className="font-mono text-xs">{config.id.replace("Player_", "$")}</span>
                </div>
              </div>
            </div>
            {spreadLabel && (
              <span
                className={`rounded-full px-3 py-1 text-sm font-medium ${spreadLabel.color} ${spreadLabel.bg}`}
              >
                {spreadLabel.text}
                {indexPrice > 0n && (
                  <span className="ml-1 opacity-70">
                    {spread > 0 ? "+" : ""}
                    {spread.toFixed(1)}%
                  </span>
                )}
              </span>
            )}
          </div>

          {/* 3-column layout */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">

            {/* ── Col 1: Player Stats sidebar ──────────────────────────────── */}
            <div className="order-2 space-y-4 lg:order-1 lg:col-span-3">
              {/* Season averages */}
              <div className="rounded-xl border border-border-low bg-card p-5">
                <p className="mb-4 text-xs font-medium uppercase tracking-wide text-muted">
                  Season Averages
                </p>
                <div className="space-y-3">
                  {[
                    { label: "Points", key: "ppg", value: stats.ppg },
                    { label: "Rebounds", key: "rpg", value: stats.rpg },
                    { label: "Assists", key: "apg", value: stats.apg },
                    { label: "Steals", key: "spg", value: stats.spg },
                    { label: "Blocks", key: "bpg", value: stats.bpg },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs text-muted">{label}</span>
                        <span className="font-mono text-sm font-semibold tabular-nums">
                          {value.toFixed(1)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border-low">
                        <div
                          className="h-full rounded-full bg-accent transition-all"
                          style={{ width: `${Math.min((value / 40) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Market prices */}
              <div className="rounded-xl border border-border-low bg-card p-5">
                <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
                  Pricing
                </p>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-muted">Market Price</p>
                    <p className="mt-0.5 font-mono text-xl font-bold tabular-nums">
                      {formatSol(marketPrice)}
                      <span className="ml-1 text-sm font-normal text-muted">SOL</span>
                    </p>
                  </div>
                  {indexPrice > 0n && (
                    <div>
                      <p className="text-xs text-muted">Stats Index</p>
                      <p className="mt-0.5 font-mono text-xl font-bold tabular-nums">
                        {formatSol(indexPrice)}
                        <span className="ml-1 text-sm font-normal text-muted">SOL</span>
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Col 2: Bonding curve chart ───────────────────────────────── */}
            <div className="order-3 space-y-4 lg:order-2 lg:col-span-5">
              <div className="rounded-xl border border-border-low bg-card p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex gap-1 rounded-lg bg-background p-0.5">
                    {(["curve", "history"] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setChartView(v)}
                        className={`min-h-[44px] rounded-md px-3 text-xs font-medium capitalize transition-colors ${
                          chartView === v
                            ? "bg-card text-foreground shadow-sm"
                            : "text-muted hover:text-foreground"
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  <span className="font-mono text-xs text-muted">
                    {supplyPct < 1 && supplyPct > 0 ? supplyPct.toFixed(2) : supplyPct.toFixed(1)}% sold
                  </span>
                </div>

                {chartView === "curve" ? (
                  <BondingCurveChart
                    basePrice={basePrice}
                    slope={slope}
                    tokensSold={tokensSold}
                    totalSupply={totalSupply}
                    indexPriceLamports={indexPrice > 0n ? indexPrice : undefined}
                    inputLamports={tab === "buy" && solLamports > 0n ? solLamports : undefined}
                  />
                ) : (
                  <PriceHistoryChart
                    data={mergePriceHistory(priceHistory, localPrices)}
                    currentPrice={indexPrice > 0n ? Number(indexPrice) : undefined}
                  />
                )}

                {/* Supply bar */}
                <div className="mt-3">
                  <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
                    <span>Supply distributed</span>
                    <span>
                      {tokensSold.toLocaleString()} / {totalSupply.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-border-low">
                    <div
                      className="h-full rounded-full bg-accent/60 transition-all"
                      style={{ width: `${Math.max(supplyPct > 0 ? 1 : 0, Math.min(supplyPct, 100))}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Curve formula — collapsed on mobile to save space */}
              <details className="group rounded-xl border border-border-low bg-card">
                <summary className="flex cursor-pointer items-center justify-between p-5 text-xs font-medium uppercase tracking-wide text-muted [&::-webkit-details-marker]:hidden list-none">
                  <span>Bonding Curve</span>
                  <span className="text-muted transition-transform group-open:rotate-180">▾</span>
                </summary>
                <div className="px-5 pb-5 -mt-2">
                <p className="font-mono text-xs text-foreground/60">
                  price = base + slope × tokens_sold
                </p>
                <p className="mt-1 font-mono text-xs text-foreground/60">
                  = {basePrice.toLocaleString()} + {slope.toLocaleString()} × {tokensSold.toLocaleString()}
                  {" "}= <span className="font-semibold text-foreground">{marketPrice.toLocaleString()} lam</span>
                </p>
                {config.priceFormula.type === "veteran" && (
                  <p className="mt-2 font-mono text-xs text-foreground/40">
                    base = round({stats.ppg}×1k + {stats.rpg}×500 + {stats.apg}×700 + {stats.spg}×800 + {stats.bpg}×800) × 0.5
                    {" "}= {config.priceFormula.score.toLocaleString()} × 0.5 = {Math.round(config.priceFormula.score * 0.5).toLocaleString()}
                  </p>
                )}
                {config.priceFormula.type === "rookie" && (
                  <p className="mt-2 font-mono text-xs text-foreground/40">
                    base = 18,000 × (61 − {config.priceFormula.draftPick}) / 60 = {Math.round(18000 * (61 - config.priceFormula.draftPick) / 60).toLocaleString()}
                  </p>
                )}
                <p className="mt-2 text-xs text-muted">
                  Every buy raises the price. Every sell lowers it.
                </p>
                </div>
              </details>

              {/* Trade preview (visible when inputs are filled) */}
              {tab === "buy" && tokensOut > 0n && (
                <div className="rounded-xl border border-border-low bg-card p-5">
                  <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
                    Trade Preview
                  </p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted">You spend</span>
                      <span className="font-mono font-medium">{formatSol(solLamports)} SOL</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">You receive</span>
                      <span className="font-mono font-medium">{tokensOut.toLocaleString()} tokens</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Price after</span>
                      <span className="font-mono font-medium text-foreground/60">
                        {formatSol(priceAfterBuy)} SOL
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Slippage</span>
                      <span className="font-mono font-medium">{SLIPPAGE_PCT}%</span>
                    </div>
                  </div>
                </div>
              )}

              {tab === "sell" && solOut > 0n && (
                <div className="rounded-xl border border-border-low bg-card p-5">
                  <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
                    Trade Preview
                  </p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted">You sell</span>
                      <span className="font-mono font-medium">{tokenAmountIn.toLocaleString()} tokens</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">You receive</span>
                      <span className="font-mono font-medium">{formatSol(solOut)} SOL</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Price after</span>
                      <span className="font-mono font-medium text-foreground/60">
                        {formatSol(priceAfterSell)} SOL
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Slippage</span>
                      <span className="font-mono font-medium">{SLIPPAGE_PCT}%</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── Col 3: Trade widget (first on mobile for primary action) ── */}
            <div className="order-1 lg:order-3 lg:col-span-4">
              <div className="rounded-2xl border border-border-low bg-card p-5">
                {/* Buy / Sell tabs */}
                <div className="mb-5 flex rounded-xl border border-border-low">
                  <button
                    onClick={() => setTab("buy")}
                    className={`flex-1 cursor-pointer rounded-l-xl py-3 text-sm font-medium transition ${
                      tab === "buy"
                        ? "bg-positive text-background"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    Buy
                  </button>
                  <button
                    onClick={() => setTab("sell")}
                    className={`flex-1 cursor-pointer rounded-r-xl py-3 text-sm font-medium transition ${
                      tab === "sell"
                        ? "bg-negative text-background"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    Sell
                  </button>
                </div>

                {tab === "buy" ? (
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="buy-sol-input" className="mb-1.5 block text-xs text-muted">
                        SOL to spend
                      </label>
                      <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-accent">
                        <input
                          id="buy-sol-input"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={solInput}
                          onChange={(e) => setSolInput(e.target.value)}
                          className="w-full bg-transparent font-mono text-sm outline-none placeholder:text-muted"
                        />
                        <span className="text-xs text-muted">SOL</span>
                      </div>
                      {balance.lamports != null && (
                        <div className="mt-1 flex justify-between text-xs text-muted">
                          <span>Balance: {lamportsToSolString(balance.lamports)} SOL</span>
                          <button
                            onClick={() =>
                              setSolInput(
                                (Number(balance.lamports) / 1e9).toFixed(4)
                              )
                            }
                            className="cursor-pointer underline"
                          >
                            Max
                          </button>
                        </div>
                      )}
                    </div>

                    {tokensOut > 0n && (
                      <div className="rounded-xl bg-accent-subtle px-3 py-2 text-sm">
                        <span className="text-muted">You receive ~</span>
                        <span className="ml-1 font-mono font-semibold">
                          {tokensOut.toLocaleString()}
                        </span>
                        <span className="ml-1 text-muted">tokens</span>
                      </div>
                    )}
                    {solLamports > 0n && tokensOut === 0n && (
                      <p className="text-xs text-negative">
                        Amount too small — enter at least {formatSol(marketPrice)} SOL
                      </p>
                    )}

                    {status !== "connected" ? (
                      <div className="text-center text-sm text-muted">
                        Connect wallet to buy
                      </div>
                    ) : (
                      <div aria-live="polite" aria-atomic="true">
                        <button
                          onClick={handleBuy}
                          disabled={isBusy || solLamports === 0n || tokensOut === 0n}
                          className="w-full cursor-pointer rounded-xl bg-positive py-3 text-sm font-bold text-background transition hover:opacity-90 active:scale-[0.98] active:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {txStage === "signing" && "Approve in wallet..."}
                          {txStage === "confirming" && "Confirming on Solana..."}
                          {txStage === "success" && "Done!"}
                          {txStage === "failed" && "Transaction failed"}
                          {txStage === "idle" && `Buy ${config.displayName}`}
                        </button>
                        {txStage === "failed" && txError && (
                          <p className="mt-1 text-center text-xs text-negative">{txError}</p>
                        )}
                        {txStage === "failed" && (
                          <button
                            onClick={() => setTxStage("idle")}
                            className="mt-1 w-full text-center text-xs text-muted underline"
                          >
                            Dismiss
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="sell-token-input" className="mb-1.5 block text-xs text-muted">
                        Tokens to sell
                      </label>
                      <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-accent">
                        <input
                          id="sell-token-input"
                          type="number"
                          min="0"
                          step="1"
                          placeholder="0"
                          value={tokenInput}
                          onChange={(e) => setTokenInput(e.target.value)}
                          className="w-full bg-transparent font-mono text-sm outline-none placeholder:text-muted"
                        />
                        <span className="text-xs text-muted">tokens</span>
                      </div>
                    </div>

                    {tokenBalance.tokenAmount !== null && (
                      <div className="mt-1 flex justify-between text-xs text-muted">
                        <span>Balance: {tokenBalance.tokenAmount.toLocaleString()} tokens</span>
                        <button
                          onClick={() =>
                            setTokenInput(tokenBalance.tokenAmount!.toString())
                          }
                          className="cursor-pointer underline"
                        >
                          Max
                        </button>
                      </div>
                    )}

                    {tokenAmountIn > 0n && tokenAmountIn > tokensSold && (
                      <p className="text-xs text-muted">
                        Only {tokensSold.toLocaleString()} tokens on curve — enter a smaller amount.
                      </p>
                    )}
                    {solOut > 0n && (
                      <div className="rounded-xl bg-accent-subtle px-3 py-2 text-sm">
                        <span className="text-muted">You receive ~</span>
                        <span className="ml-1 font-mono font-semibold">
                          {formatSol(solOut)}
                        </span>
                        <span className="ml-1 text-muted">SOL</span>
                      </div>
                    )}

                    {status !== "connected" ? (
                      <div className="text-center text-sm text-muted">
                        Connect wallet to sell
                      </div>
                    ) : (
                      <div aria-live="polite" aria-atomic="true">
                        <button
                          onClick={handleSell}
                          disabled={isBusy || tokenAmountIn === 0n || solOut === 0n}
                          className="w-full cursor-pointer rounded-xl bg-negative py-3 text-sm font-bold text-background transition hover:opacity-90 active:scale-[0.98] active:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {txStage === "signing" && "Approve in wallet..."}
                          {txStage === "confirming" && "Confirming on Solana..."}
                          {txStage === "success" && "Done!"}
                          {txStage === "failed" && "Transaction failed"}
                          {txStage === "idle" && "Sell tokens"}
                        </button>
                        {txStage === "failed" && txError && (
                          <p className="mt-1 text-center text-xs text-negative">{txError}</p>
                        )}
                        {txStage === "failed" && (
                          <button
                            onClick={() => setTxStage("idle")}
                            className="mt-1 w-full text-center text-xs text-muted underline"
                          >
                            Dismiss
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Network banner */}
                <p className="mt-4 text-center text-xs text-muted">
                  {cluster === "localnet"
                    ? "Localnet. Program live on local validator."
                    : cluster === "devnet" && isDemoMode
                      ? "Demo mode — fake SOL, nothing is real."
                      : cluster === "devnet"
                        ? "Devnet. Real transactions on Solana devnet."
                        : `${cluster.charAt(0).toUpperCase() + cluster.slice(1)}. Live on Solana.`}
                </p>
              </div>
            </div>

          </div>

          {/* Recent Trades */}
          {localTrades.length > 0 && (
            <div className="mt-8">
              <h2 className="mb-3 text-sm font-semibold text-muted uppercase tracking-wider">
                Your Recent Trades
              </h2>
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted">
                      <th className="px-4 py-2 text-left font-medium">Type</th>
                      <th className="px-4 py-2 text-right font-medium">Tokens</th>
                      <th className="px-4 py-2 text-right font-medium">SOL</th>
                      <th className="px-4 py-2 text-right font-medium hidden sm:table-cell">Time</th>
                      <th className="px-4 py-2 text-right font-medium hidden md:table-cell">Tx</th>
                    </tr>
                  </thead>
                  <tbody>
                    {localTrades.slice(0, 10).map((trade) => (
                      <tr key={trade.id} className="border-b border-border last:border-0 hover:bg-accent-subtle/30">
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                            trade.type === "buy"
                              ? "bg-accent-subtle text-accent"
                              : "bg-negative/10 text-negative"
                          }`}>
                            {trade.type === "buy" ? "Buy" : "Sell"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {trade.tokenAmount.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {trade.solAmount.toFixed(4)}
                        </td>
                        <td className="px-4 py-3 text-right text-muted hidden sm:table-cell">
                          {new Date(trade.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-4 py-3 text-right hidden md:table-cell">
                          {trade.signature ? (
                            <a
                              href={`https://explorer.solana.com/tx/${trade.signature}?cluster=devnet`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-xs text-muted underline hover:text-foreground"
                            >
                              {trade.signature.slice(0, 8)}…
                            </a>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
