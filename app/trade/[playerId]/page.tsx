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
  getStatsOraclePda,
  getExitTreasuryPda,
  getMarketStatusPda,
  getSharpLeaderboardPda,
  getBuyWithSolInstruction,
  getCreateAtaIdempotentInstruction,
  getSellInstruction,
  applySlippage,
} from "../../lib/fanshare-instructions";
import { formatUsd, SOL_REFERENCE_RATE, calculatePillarBreakdown } from "../../lib/oracle-weights";
import { GridBackground } from "../../components/grid-background";
import { ClusterSelect } from "../../components/cluster-select";
import { useCluster } from "../../components/cluster-context";
import { WalletButton } from "../../components/wallet-button";
import { BondingCurveChart } from "../../components/bonding-curve-chart";
import { CandlestickChart } from "../../components/candlestick-chart";
import {
  calculateSellReturn,
  calculateTokensForSol,
  currentPrice,
} from "../../lib/bonding-curve";
import { type PlayerConfig, DEFAULT_BASE_PRICE, DEFAULT_SLOPE, DEVNET_PLAYERS, PROTOCOL_WALLET, FEE_NUMERATOR, FEE_DENOMINATOR } from "../../lib/fanshare-program";
import { address as toAddress } from "@solana/kit";
import { parseTransactionError } from "../../lib/errors";
import { recordTrade, loadTradesForPlayer, type TradeRecord } from "../../lib/trade-history";
import { recordLocalPrice, loadLocalPriceHistory, mergePriceHistory } from "../../lib/local-price-history";
import { useMarketStatus } from "../../lib/hooks/use-market-status";
import { FrozenMarketBanner } from "../../components/frozen-market-banner";

// Module-level fetcher — stable reference, avoids new function on every render
const jsonFetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(r.statusText);
    return r.json();
  });

type TxStage = "idle" | "signing" | "confirming" | "success" | "failed";

const SLIPPAGE_PCT = 1; // 1% slippage tolerance

/** Fire-and-forget: record price + trade data to KV for charts and leaderboard */
function recordPriceToServer(opts: {
  playerId: string;
  price: number;
  tradeData?: {
    signature: string;
    mint: string;
    player_id: string;
    trader: string;
    token_amount: number;
    sol_amount: number;
    is_buy: boolean;
    fee_lamports: number;
    spread_at_buy: number;
  };
}) {
  fetch("/api/price-history/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      playerId: opts.playerId,
      price: opts.price,
      cluster: "devnet",
      tradeData: opts.tradeData,
    }),
  }).catch(() => {/* non-fatal */});
}

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
  const { marketStatus } = useMarketStatus(player?.curve?.mint);

  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [chartView, setChartView] = useState<"curve" | "history">("curve");
  const [solInput, setSolInput] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [txStage, setTxStage] = useState<TxStage>("idle");
  const [txError, setTxError] = useState<string | null>(null);
  // Two-click sell confirm — first click arms, second click sells.
  // Auto-disarms after 5s so a stale armed button doesn't surprise the user.
  const [sellArmed, setSellArmed] = useState(false);
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

  // Auto-disarm sell confirm after 5s of inactivity
  useEffect(() => {
    if (!sellArmed) return;
    const t = setTimeout(() => setSellArmed(false), 5000);
    return () => clearTimeout(t);
  }, [sellArmed]);

  // Disarm when switching tabs or changing token input
  useEffect(() => {
    setSellArmed(false);
  }, [tab, tokenInput]);

  const isBusy = txStage !== "idle";

  // ── Derived curve values ──────────────────────────────────────────────────
  const curve = player?.curve;
  const basePrice = curve?.basePrice ?? DEFAULT_BASE_PRICE;
  const slope = curve?.slope ?? DEFAULT_SLOPE;
  const tokensSold = curve?.tokensSold ?? 0n;
  const totalSupply = curve?.totalSupply ?? 1_000_000n;
  const indexPrice = player?.oracle?.indexPriceLamports ?? 0n;
  const marketPrice = currentPrice(basePrice, slope, tokensSold);

  // Price flash animation on market price change
  const prevMarketPrice = useRef<bigint | null>(null);
  const [priceFlashClass, setPriceFlashClass] = useState("");
  useEffect(() => {
    if (prevMarketPrice.current !== null && prevMarketPrice.current !== marketPrice) {
      const cls = marketPrice > prevMarketPrice.current ? "price-flash-up" : "price-flash-down";
      setPriceFlashClass(cls);
      const t = setTimeout(() => setPriceFlashClass(""), 650);
      prevMarketPrice.current = marketPrice;
      return () => clearTimeout(t);
    }
    prevMarketPrice.current = marketPrice;
  }, [marketPrice]);

  // How many tokens would buying X SOL get you?
  // Guard against NaN/Infinity from scientific notation inputs (e.g. "1e308")
  // and clamp negatives to 0 (type="number" lets users type/paste "-5").
  const _parsedSol = parseFloat(solInput || "0") * 1e9;
  const _parsedSolClamped = Number.isFinite(_parsedSol) ? Math.max(0, _parsedSol) : 0;
  const solLamports = BigInt(Math.floor(_parsedSolClamped));
  const buyInputInvalid = solInput.trim() !== "" && (Number.isNaN(_parsedSol) || _parsedSol < 0);
  // Deduct 1.5% fee before estimating tokens — matches on-chain buy_with_sol logic:
  //   effective_sol = sol_amount * FEE_DENOMINATOR / (FEE_DENOMINATOR + FEE_NUMERATOR)
  const effectiveSolForBuy = solLamports * FEE_DENOMINATOR / (FEE_DENOMINATOR + FEE_NUMERATOR);
  const tokensOut = calculateTokensForSol(
    basePrice,
    slope,
    tokensSold,
    effectiveSolForBuy,
    totalSupply
  );

  // How much SOL would selling X tokens return?
  // Same negative-clamp + NaN-guard story as the buy input.
  const _parsedTokens = parseFloat(tokenInput || "0");
  const _parsedTokensClamped = Number.isFinite(_parsedTokens) ? Math.max(0, _parsedTokens) : 0;
  const tokenAmountIn = BigInt(Math.floor(_parsedTokensClamped));
  const sellInputInvalid = tokenInput.trim() !== "" && (Number.isNaN(_parsedTokens) || _parsedTokens < 0);
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

  // Spread signal — the core thesis of the product ("market price vs fair
  // value"), so it needs visual weight. Styled as a 2-line mini-card, not
  // a footnote pill.
  const spread = player?.spreadPercent ?? 0;
  const spreadLabel =
    indexPrice === 0n
      ? null
      : spread < -5
        ? {
            text: "Undervalued",
            color: "text-accent",
            border: "border-accent/40",
            bg: "bg-accent-subtle",
            pctColor: "text-accent",
          }
        : spread > 5
          ? {
              text: "Overvalued",
              color: "text-negative",
              border: "border-negative/40",
              bg: "bg-negative/10",
              pctColor: "text-negative",
            }
          : {
              text: "Fair value",
              color: "text-foreground",
              border: "border-border",
              bg: "bg-card",
              pctColor: "text-foreground",
            };

  // Frozen market state
  const isFrozen = marketStatus?.isFrozen ?? false;
  const isClosed = isFrozen && Number(marketStatus?.closeTimestamp ?? 0) <= Math.floor(Date.now() / 1000);
  const buyDisabledByFreeze = isFrozen; // buy disabled whenever frozen
  const sellDisabledByFreeze = isFrozen; // sell disabled whenever frozen (full halt)

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleBuy = useCallback(async () => {
    if (isBusy || buyDisabledByFreeze || !address || !player || !curve || solLamports === 0n || tokensOut === 0n) return;
    setTxError(null);
    setTxStage("signing");
    try {
      const mint = curve.mint as Address;
      const [bondingCurve, buyerTokenAccount, statsOracle, exitTreasury, marketStatus, sharpLeaderboard] = await Promise.all([
        getBondingCurvePda(mint),
        getAssociatedTokenAccount(address, mint),
        getStatsOraclePda(mint),
        getExitTreasuryPda(),
        getMarketStatusPda(mint),
        getSharpLeaderboardPda(),
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
        exitTreasury,
        protocolWallet: toAddress(PROTOCOL_WALLET),
        statsOracle,
        marketStatus,
        sharpLeaderboard,
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
      // Record to server KV (price chart + leaderboard indexing)
      recordPriceToServer({
        playerId,
        price: Number(priceAfterBuy),
        tradeData: sig ? {
          signature: sig,
          mint: String(mint),
          player_id: playerId,
          trader: String(address),
          token_amount: Number(tokensOut),
          sol_amount: Number(solLamports),
          is_buy: true,
          fee_lamports: Number(solLamports * FEE_NUMERATOR / FEE_DENOMINATOR),
          spread_at_buy: player.spreadPercent,
        } : undefined,
      });
    } catch (err: unknown) {
      const msg = parseTransactionError(err);
      setTxError(msg);
      setTxStage("failed");
    }
  }, [isBusy, buyDisabledByFreeze, address, player, curve, solLamports, tokensOut, send, playerId, priceAfterBuy]);

  const handleSell = useCallback(async () => {
    if (isBusy || sellDisabledByFreeze || !address || !player || !curve || tokenAmountIn === 0n || solOut === 0n) return;
    setTxError(null);
    setTxStage("signing");
    try {
      const mint = curve.mint as Address;
      const [bondingCurve, buyerTokenAccount, statsOracle, exitTreasury, marketStatus, sharpLeaderboard] = await Promise.all([
        getBondingCurvePda(mint),
        getAssociatedTokenAccount(address, mint),
        getStatsOraclePda(mint),
        getExitTreasuryPda(),
        getMarketStatusPda(mint),
        getSharpLeaderboardPda(),
      ]);
      // min_sol_out must account for fee: on-chain, seller gets sol_return - 1.5% fee
      const afterFee = solOut - solOut * FEE_NUMERATOR / FEE_DENOMINATOR;
      const minSolOut = applySlippage(afterFee, SLIPPAGE_PCT);
      const ix = getSellInstruction({
        buyer: address,
        mint,
        bondingCurve,
        buyerTokenAccount,
        exitTreasury,
        protocolWallet: toAddress(PROTOCOL_WALLET),
        statsOracle,
        marketStatus,
        sharpLeaderboard,
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
      toast.success(`Sold ${tokenAmountIn.toLocaleString()} tokens for ${formatUsd(solOut)}`, {
        description: sig ? `Tx: ${sig.slice(0, 8)}…` : undefined,
      });
      // Record to server KV (price chart + leaderboard indexing)
      recordPriceToServer({
        playerId,
        price: Number(priceAfterSell),
        tradeData: sig ? {
          signature: sig,
          mint: curve.mint as string,
          player_id: playerId,
          trader: String(address),
          token_amount: Number(tokenAmountIn),
          sol_amount: Number(solOut),
          is_buy: false,
          fee_lamports: Number(solOut * FEE_NUMERATOR / FEE_DENOMINATOR),
          spread_at_buy: player.spreadPercent,
        } : undefined,
      });
    } catch (err: unknown) {
      const msg = parseTransactionError(err);
      setTxError(msg);
      setTxStage("failed");
    }
  }, [isBusy, sellDisabledByFreeze, address, player, curve, tokenAmountIn, solOut, send, playerId, priceAfterSell]);

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
                        {tab === "buy" ? "Amount to spend (SOL)" : "Tokens to sell"}
                      </label>
                      <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-3">
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
            <Link
              href="/invite"
              className="inline-flex min-h-[44px] items-center text-xs font-medium text-muted transition hover:text-foreground max-sm:hidden"
            >
              About this demo →
            </Link>
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
              <div
                className={`flex min-w-[128px] flex-col items-end rounded-xl border ${spreadLabel.border} ${spreadLabel.bg} px-4 py-2.5`}
                aria-label={`${spreadLabel.text}: market price is ${spread >= 0 ? "+" : ""}${spread.toFixed(1)}% vs fair value`}
              >
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${spreadLabel.color}`}
                >
                  {spreadLabel.text}
                  <span
                    tabIndex={0}
                    title="Spread: gap between our computer's fair price and what people are actually paying. Big gap = possible trade."
                    aria-label="Spread explained"
                    className="inline-flex h-3 w-3 cursor-help items-center justify-center rounded-full border border-current text-[8px] leading-none opacity-70"
                  >
                    i
                  </span>
                </span>
                <span className={`font-mono text-xl font-bold tabular-nums leading-tight ${spreadLabel.pctColor}`}>
                  {spread >= 0 ? "+" : ""}
                  {spread.toFixed(1)}%
                </span>
                <span className="mt-0.5 text-[10px] text-muted">
                  vs {formatUsd(indexPrice)} fair value
                </span>
              </div>
            )}
          </div>

          {/* Frozen market banner */}
          {marketStatus?.isFrozen && (
            <FrozenMarketBanner marketStatus={marketStatus} />
          )}

          {/* Demo 1 spread warning — fires when market diverges ≥30% from oracle fair value.
              Threshold is a placeholder; will tighten once we have real trade distribution data. */}
          {indexPrice > 0n && Math.abs(spread) >= 30 && (
            <div
              role="alert"
              className="rounded-xl border border-accent/40 bg-accent-subtle px-4 py-3"
            >
              <div className="flex items-start gap-3">
                <svg viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 flex-none text-accent" fill="currentColor" aria-hidden="true">
                  <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 3a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0v-4A.75.75 0 0 1 8 4.5Zm0 7.25a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Z" />
                </svg>
                <div className="flex-1 text-sm">
                  <p className="font-semibold text-accent">
                    Market price is {spread >= 0 ? "above" : "below"} stats-based fair value by {Math.abs(spread).toFixed(1)}%.
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    ±30% is a placeholder threshold for Demo 1 — it will tighten once we have real trade-distribution data.
                  </p>
                </div>
              </div>
            </div>
          )}

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
                    <p className={`mt-0.5 font-mono text-xl font-bold tabular-nums transition-colors ${priceFlashClass}`}>
                      {formatUsd(marketPrice)}
                    </p>
                  </div>
                  {indexPrice > 0n && (
                    <div>
                      <p className="text-xs text-muted">Stats Index</p>
                      <p className="mt-0.5 font-mono text-xl font-bold tabular-nums">
                        {formatUsd(indexPrice)}
                      </p>
                    </div>
                  )}
                  {/* Pillar breakdown — 4-pillar formula from config stats */}
                  {(() => {
                    if (indexPrice === 0n) return null;
                    const pillars = calculatePillarBreakdown(config.stats);
                    const pillarItems = [
                      { label: "Scoring", value: pillars.scoring * 0.12 },
                      { label: "Playmaking", value: pillars.playmaking * 0.12 },
                      { label: "Defense", value: pillars.defense * 0.12 },
                      { label: "Winning", value: pillars.winning * 0.12 },
                    ];
                    const maxPillar = Math.max(...pillarItems.map((p) => Math.abs(p.value)), 0.01);
                    return (
                      <div className="mt-2 pt-3 border-t border-border-low">
                        <p className="mb-2 text-xs text-muted">Index Breakdown</p>
                        <div className="space-y-2">
                          {pillarItems.map(({ label, value }) => (
                            <div key={label}>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-muted">{label}</span>
                                <span className="font-mono font-medium tabular-nums">
                                  {value >= 0 ? "+" : ""}{`$${Math.abs(value).toFixed(2)}`}
                                </span>
                              </div>
                              <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-border-low">
                                <div
                                  className={`h-full rounded-full transition-all ${value >= 0 ? "bg-accent/60" : "bg-negative/40"}`}
                                  style={{ width: `${(Math.abs(value) / maxPillar) * 100}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
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
                  <CandlestickChart
                    data={mergePriceHistory(priceHistory, localPrices)}
                    currentPrice={marketPrice > 0n ? Number(marketPrice) : undefined}
                    fairValuePrice={indexPrice > 0n ? Number(indexPrice) : undefined}
                    height={200}
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

              {/* Curve formula — collapsed on mobile to save space.
                  Shown in USD (not raw lamports) for demo readability. */}
              <details className="group rounded-xl border border-border-low bg-card">
                <summary className="flex cursor-pointer items-center justify-between p-5 text-xs font-medium uppercase tracking-wide text-muted [&::-webkit-details-marker]:hidden list-none">
                  <span>Bonding Curve</span>
                  <span className="text-muted transition-transform group-open:rotate-180">▾</span>
                </summary>
                <div className="space-y-2 px-5 pb-5 -mt-2">
                  <p className="font-mono text-xs text-foreground/60">
                    price = launch price + trade impact
                  </p>
                  <p className="font-mono text-xs text-foreground/60">
                    = <span className="text-foreground">{formatUsd(basePrice)}</span>
                    {" "}+ <span className="text-foreground">{formatUsd(slope * tokensSold)}</span>
                    {" "}= <span className="font-semibold text-foreground">{formatUsd(marketPrice)}</span>
                  </p>
                  <p className="font-mono text-[11px] text-foreground/40">
                    launch price = 4-pillar stats index at market open
                  </p>
                  <p className="text-xs text-muted">
                    {tokensSold.toLocaleString()} tokens traded. Each 1M bought adds{" "}
                    <span className="text-foreground">{formatUsd(slope * 1_000_000n)}</span>
                    {" "}to the price. Every sell reverses it.
                  </p>
                </div>
              </details>

              {/* Trade preview (visible when inputs are filled) */}
              {tab === "buy" && tokensOut > 0n && (() => {
                const feeLamports = solLamports * FEE_NUMERATOR / FEE_DENOMINATOR;
                return (
                <div className="rounded-xl border border-border-low bg-card p-5">
                  <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">
                    Trade Preview
                  </p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted">You spend</span>
                      <span className="font-mono font-medium">{formatUsd(solLamports)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">You receive</span>
                      <span className="font-mono font-medium">{tokensOut.toLocaleString()} tokens</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Fee (1.5%)</span>
                      <span className="font-mono text-xs text-muted">{formatUsd(feeLamports)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Price after</span>
                      <span className="font-mono font-medium text-foreground/60">
                        {formatUsd(priceAfterBuy)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Slippage</span>
                      <span className="font-mono font-medium">{SLIPPAGE_PCT}%</span>
                    </div>
                  </div>
                </div>
                );
              })()}

              {tab === "sell" && solOut > 0n && (() => {
                const feeLamports = solOut * FEE_NUMERATOR / FEE_DENOMINATOR;
                const afterFee = solOut - feeLamports;
                return (
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
                      <span className="font-mono font-medium">{formatUsd(afterFee)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Fee (1.5%)</span>
                      <span className="font-mono text-xs text-muted">{formatUsd(feeLamports)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Price after</span>
                      <span className="font-mono font-medium text-foreground/60">
                        {formatUsd(priceAfterSell)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Slippage</span>
                      <span className="font-mono font-medium">{SLIPPAGE_PCT}%</span>
                    </div>
                  </div>
                </div>
                );
              })()}
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
                        Amount to spend (SOL)
                      </label>
                      <div className={`flex items-center gap-2 rounded-xl border bg-background px-3 py-3 focus-within:border-accent ${buyInputInvalid ? "border-negative" : "border-border"}`}>
                        <input
                          id="buy-sol-input"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={solInput}
                          onChange={(e) => setSolInput(e.target.value)}
                          aria-invalid={buyInputInvalid || undefined}
                          aria-describedby={buyInputInvalid ? "buy-sol-error" : undefined}
                          className="w-full bg-transparent font-mono text-sm outline-none placeholder:text-muted"
                        />
                        <span className="text-xs text-muted">SOL</span>
                      </div>
                      {buyInputInvalid && (
                        <p id="buy-sol-error" role="alert" className="mt-1 text-xs text-negative">
                          Enter a positive amount.
                        </p>
                      )}
                      {balance.lamports != null && (
                        <div className="mt-1 flex justify-between text-xs text-muted">
                          <span>Balance: {formatUsd(balance.lamports)}</span>
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
                        Amount too small — enter at least {formatUsd(marketPrice)}
                      </p>
                    )}

                    {status !== "connected" ? (
                      <div className="text-center text-sm text-muted">
                        Connect wallet to buy
                      </div>
                    ) : buyDisabledByFreeze ? (
                      <div className="text-center">
                        <button
                          disabled
                          className="w-full cursor-not-allowed rounded-xl bg-muted/30 py-3 text-sm font-bold text-muted opacity-60"
                        >
                          {isClosed ? "Market Closed" : "Market Frozen"}
                        </button>
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
                      <div className={`flex items-center gap-2 rounded-xl border bg-background px-3 py-3 focus-within:border-accent ${sellInputInvalid ? "border-negative" : "border-border"}`}>
                        <input
                          id="sell-token-input"
                          type="number"
                          min="0"
                          step="1"
                          placeholder="0"
                          value={tokenInput}
                          onChange={(e) => setTokenInput(e.target.value)}
                          aria-invalid={sellInputInvalid || undefined}
                          aria-describedby={sellInputInvalid ? "sell-token-error" : undefined}
                          className="w-full bg-transparent font-mono text-sm outline-none placeholder:text-muted"
                        />
                        <span className="text-xs text-muted">tokens</span>
                      </div>
                      {sellInputInvalid && (
                        <p id="sell-token-error" role="alert" className="mt-1 text-xs text-negative">
                          Enter a positive number of tokens.
                        </p>
                      )}
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
                          {formatUsd(solOut)}
                        </span>
                      </div>
                    )}

                    {status !== "connected" ? (
                      <div className="text-center text-sm text-muted">
                        Connect wallet to sell
                      </div>
                    ) : sellDisabledByFreeze ? (
                      <div className="text-center">
                        <button
                          disabled
                          className="w-full cursor-not-allowed rounded-xl bg-muted/30 py-3 text-sm font-bold text-muted opacity-60"
                        >
                          {isClosed ? "Market Closed — Claim Exit Instead" : "Market Frozen"}
                        </button>
                      </div>
                    ) : (
                      <div aria-live="polite" aria-atomic="true">
                        {sellArmed && txStage === "idle" && (
                          <p className="mb-2 text-center text-xs text-muted">
                            Selling locks in your P&amp;L against the curve. Sure?
                          </p>
                        )}
                        <button
                          onClick={() => {
                            if (txStage !== "idle") return;
                            if (!sellArmed) {
                              setSellArmed(true);
                              return;
                            }
                            setSellArmed(false);
                            void handleSell();
                          }}
                          disabled={isBusy || tokenAmountIn === 0n || solOut === 0n}
                          className="w-full cursor-pointer rounded-xl bg-negative py-3 text-sm font-bold text-background transition hover:opacity-90 active:scale-[0.98] active:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {txStage === "signing" && "Approve in wallet..."}
                          {txStage === "confirming" && "Confirming on Solana..."}
                          {txStage === "success" && "Done!"}
                          {txStage === "failed" && "Transaction failed"}
                          {txStage === "idle" && (sellArmed ? "Yes, sell" : "Sell tokens")}
                        </button>
                        {sellArmed && txStage === "idle" && (
                          <button
                            onClick={() => setSellArmed(false)}
                            className="mt-1 w-full text-center text-xs text-muted underline"
                          >
                            Cancel
                          </button>
                        )}
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
                      <th className="px-4 py-2 text-right font-medium">Value</th>
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
                          ${(trade.solAmount * SOL_REFERENCE_RATE).toFixed(2)}
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
