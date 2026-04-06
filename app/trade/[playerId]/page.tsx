"use client";

import { useState, useCallback, use } from "react";
import { type Address } from "@solana/kit";
import Link from "next/link";
import { toast } from "sonner";
import { useWallet } from "../../lib/wallet/context";
import { useBalance } from "../../lib/hooks/use-balance";
import { useTokenBalance } from "../../lib/hooks/use-token-balance";
import { usePlayerData } from "../../lib/hooks/use-player-markets";
import { useSendTransaction } from "../../lib/hooks/use-send-transaction";
import { lamportsToSolString } from "../../lib/lamports";
import { GridBackground } from "../../components/grid-background";
import { ClusterSelect } from "../../components/cluster-select";
import { useCluster } from "../../components/cluster-context";
import { WalletButton } from "../../components/wallet-button";
import { BondingCurveChart } from "../../components/bonding-curve-chart";
import {
  formatSol,
  // calculateBuyCost — used in POST-DEPLOY buy instruction (commented out below)
  calculateSellReturn,
  calculateTokensForSol,
  currentPrice,
} from "../../lib/bonding-curve";

const SLIPPAGE_PCT = 1; // 1% slippage tolerance

export default function TradePage({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = use(params);
  const { player, isLoading } = usePlayerData(playerId);
  const { wallet, status } = useWallet();
  const { isSending } = useSendTransaction();
  useCluster(); // will destructure getExplorerUrl post-deploy

  const address = wallet?.account.address;
  const balance = useBalance(address);
  const mintAddress = player?.curve?.mint as Address | undefined;
  const tokenBalance = useTokenBalance(address, mintAddress);

  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [solInput, setSolInput] = useState("");
  const [tokenInput, setTokenInput] = useState("");

  // ── Derived curve values ──────────────────────────────────────────────────
  const curve = player?.curve;
  const basePrice = curve?.basePrice ?? 1000n;
  const slope = curve?.slope ?? 10n;
  const tokensSold = curve?.tokensSold ?? 0n;
  const totalSupply = curve?.totalSupply ?? 1_000_000n;
  const indexPrice = player?.oracle?.indexPriceLamports ?? 0n;
  const marketPrice = currentPrice(basePrice, slope, tokensSold);

  // How many tokens would buying X SOL get you?
  const solLamports = BigInt(Math.floor(parseFloat(solInput || "0") * 1e9));
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
    tokenAmountIn > 0n
      ? currentPrice(basePrice, slope, tokensSold - tokenAmountIn)
      : marketPrice;

  // Supply bar
  const supplyPct = Number((tokensSold * 100n) / totalSupply);

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
    if (!address || !player || !curve || solLamports === 0n || tokensOut === 0n) return;

    // PRE-DEPLOY: Show mock success (no real program on devnet yet)
    toast.info("Devnet program not yet deployed — showing preview only.");
    return;

    /* POST-DEPLOY: uncomment when program is live
    try {
      const bondingCurvePda = await getBondingCurvePda(address(curve.mint));
      const buyerAta = await getAssociatedTokenAccount(address(address), address(curve.mint));
      const minTokensOut = (tokensOut * BigInt(100 - SLIPPAGE_PCT)) / 100n;

      const ix = getBuyWithSolInstruction({
        buyer: address(address),
        mint: address(curve.mint),
        bondingCurve: bondingCurvePda,
        buyerTokenAccount: buyerAta,
        solAmount: solLamports,
        minTokensOut,
      });

      const sig = await send({ instructions: [ix] });
      toast.success(`Bought ${tokensOut.toLocaleString()} tokens!`, {
        description: <a href={getExplorerUrl(`/tx/${sig}`)} target="_blank" rel="noopener noreferrer" className="underline">View tx</a>,
      });
      setSolInput("");
    } catch (err) {
      toast.error(parseTransactionError(err));
    }
    */
  }, [address, player, curve, solLamports, tokensOut]);

  const handleSell = useCallback(async () => {
    if (!address || !player || !curve || tokenAmountIn === 0n || solOut === 0n) return;

    // PRE-DEPLOY: Show mock success
    toast.info("Devnet program not yet deployed — showing preview only.");
    return;
  }, [address, player, curve, tokenAmountIn, solOut]);

  // ── Loading / not found ───────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
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
              className="text-sm text-muted transition hover:text-foreground"
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
          <div className="mb-6 flex items-start justify-between">
            <div className="flex items-center gap-3">
              <span className="text-5xl">{config.emoji}</span>
              <div>
                <h1 className="font-display text-3xl font-extrabold tracking-tight">
                  {config.displayName}
                </h1>
                <div className="mt-1 flex items-center gap-2 text-sm text-muted">
                  <span>{config.position}</span>
                  <span>·</span>
                  <span>{config.team}</span>
                  <span>·</span>
                  <span className="font-mono text-xs">{config.id}</span>
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
              <div className="rounded-2xl border border-border-low bg-card p-5">
                <p className="mb-4 text-xs font-medium uppercase tracking-wide text-muted">
                  Season Averages
                </p>
                <div className="space-y-3">
                  {[
                    { label: "Points", key: "ppg", value: stats.ppg, color: "bg-accent" },
                    { label: "Rebounds", key: "rpg", value: stats.rpg, color: "bg-positive" },
                    { label: "Assists", key: "apg", value: stats.apg, color: "bg-accent" },
                    { label: "Steals", key: "spg", value: stats.spg, color: "bg-positive" },
                    { label: "Blocks", key: "bpg", value: stats.bpg, color: "bg-muted/40" },
                  ].map(({ label, value, color }) => (
                    <div key={label}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs text-muted">{label}</span>
                        <span className="font-mono text-sm font-semibold tabular-nums">
                          {value.toFixed(1)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border-low">
                        <div
                          className={`h-full rounded-full ${color} transition-all`}
                          style={{ width: `${Math.min((value / 40) * 100, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Market prices */}
              <div className="rounded-2xl border border-border-low bg-card p-5">
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
              <div className="rounded-2xl border border-border-low bg-card p-5">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">
                    Price Curve
                  </p>
                  <span className="font-mono text-xs text-muted">
                    {supplyPct.toFixed(1)}% sold
                  </span>
                </div>

                <BondingCurveChart
                  basePrice={basePrice}
                  slope={slope}
                  tokensSold={tokensSold}
                  totalSupply={totalSupply}
                  indexPriceLamports={indexPrice > 0n ? indexPrice : undefined}
                />

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
                      style={{ width: `${Math.min(supplyPct, 100)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Curve formula */}
              <div className="rounded-2xl border border-border-low bg-card p-5">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                  Bonding Curve
                </p>
                <p className="font-mono text-xs text-foreground/60">
                  price = {basePrice.toLocaleString()} + {slope.toLocaleString()} × tokens_sold
                </p>
                <p className="mt-1 font-mono text-xs text-foreground/60">
                  = {basePrice.toLocaleString()} + {slope.toLocaleString()} × {tokensSold.toLocaleString()}
                  {" "}= <span className="font-semibold text-foreground">{marketPrice.toLocaleString()} lam</span>
                </p>
                <p className="mt-2 text-xs text-muted">
                  Every buy raises the price. Every sell lowers it.
                </p>
              </div>

              {/* Trade preview (visible when inputs are filled) */}
              {tab === "buy" && tokensOut > 0n && (
                <div className="rounded-2xl border border-border-low bg-card p-5">
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
                <div className="rounded-2xl border border-border-low bg-card p-5">
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
                    className={`flex-1 cursor-pointer rounded-l-xl py-2 text-sm font-medium transition ${
                      tab === "buy"
                        ? "bg-accent text-accent-foreground"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    Buy
                  </button>
                  <button
                    onClick={() => setTab("sell")}
                    className={`flex-1 cursor-pointer rounded-r-xl py-2 text-sm font-medium transition ${
                      tab === "sell"
                        ? "bg-accent text-accent-foreground"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    Sell
                  </button>
                </div>

                {tab === "buy" ? (
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-xs text-muted">
                        SOL to spend
                      </label>
                      <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-accent">
                        <input
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

                    {status !== "connected" ? (
                      <div className="text-center text-sm text-muted">
                        Connect wallet to buy
                      </div>
                    ) : (
                      <button
                        onClick={handleBuy}
                        disabled={isSending || solLamports === 0n || tokensOut === 0n}
                        className="w-full cursor-pointer rounded-xl bg-positive py-3 text-sm font-bold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isSending ? "Buying..." : `Buy ${config.displayName}`}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-xs text-muted">
                        Tokens to sell
                      </label>
                      <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-accent">
                        <input
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
                      <button
                        onClick={handleSell}
                        disabled={
                          isSending || tokenAmountIn === 0n || solOut === 0n
                        }
                        className="w-full cursor-pointer rounded-xl bg-negative py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {isSending ? "Selling..." : "Sell tokens"}
                      </button>
                    )}
                  </div>
                )}

                {/* Devnet banner */}
                <p className="mt-4 text-center text-xs text-muted">
                  Localnet. Program live on local validator.
                </p>
              </div>
            </div>

          </div>
        </main>
      </div>
    </div>
  );
}
