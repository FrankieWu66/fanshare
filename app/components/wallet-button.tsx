"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useWallet } from "../lib/wallet/context";
import { useBalance } from "../lib/hooks/use-balance";
import { formatUsd } from "../lib/oracle-weights";
import { ellipsify } from "../lib/explorer";
import { useCluster } from "./cluster-context";
import { DemoSignin } from "./demo-signin";

export function WalletButton() {
  const {
    connectors,
    connect,
    disconnect,
    wallet,
    status,
    error,
    isDemoMode,
    disconnectDemo,
  } = useWallet();

  const { getExplorerUrl } = useCluster();
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showDemoSignin, setShowDemoSignin] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const address = wallet?.account.address;
  const balance = useBalance(address);

  const open = () => setIsOpen(true);
  const close = () => {
    setIsOpen(false);
    // Return focus to trigger only when closing an open dropdown (keyboard a11y)
    // Never steal focus if the demo modal is open or the dropdown was already closed
    if (isOpen && !showDemoSignin) {
      setTimeout(() => triggerRef.current?.focus(), 0);
    }
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      // Only act when the dropdown is actually open — avoids stealing focus
      // from inputs on the rest of the page on every click
      if (!isOpen) return;
      if (showDemoSignin) return;
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, showDemoSignin]);

  const handleCopy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Disconnected state ────────────────────────────────────────────────────
  if (status !== "connected") {
    return (
      <>
        <div className="relative" ref={ref}>
          <button
            ref={triggerRef}
            onClick={() => (isOpen ? close() : open())}
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            className="min-h-[44px] cursor-pointer rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-xs transition hover:bg-primary/90"
          >
            Connect Wallet
          </button>

          {isOpen && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Choose a wallet"
              className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-border-low bg-card p-3 shadow-lg"
            >
              {/* Real wallets */}
              {connectors.length > 0 && (
                <>
                  <p className="mb-2 text-xs font-medium text-muted">
                    Choose a wallet
                  </p>
                  <div className="space-y-1">
                    {connectors.map((connector) => (
                      <button
                        key={connector.id}
                        onClick={async () => {
                          try {
                            await connect(connector.id);
                            close();
                          } catch {
                            // surfaced via context state
                          }
                        }}
                        disabled={status === "connecting"}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition hover:bg-cream disabled:pointer-events-none disabled:opacity-50"
                      >
                        {connector.icon && (
                          <img
                            src={connector.icon}
                            alt=""
                            className="h-5 w-5 rounded"
                          />
                        )}
                        <span>{connector.name}</span>
                      </button>
                    ))}
                  </div>

                  <div className="my-2 flex items-center gap-2">
                    <div className="h-px flex-1 bg-border-low" />
                    <span className="text-[10px] text-muted/60">or</span>
                    <div className="h-px flex-1 bg-border-low" />
                  </div>
                </>
              )}

              {/* Demo option */}
              <button
                onClick={() => {
                  close();
                  setShowDemoSignin(true);
                }}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border border-accent/30 bg-accent-subtle px-3 py-2.5 text-left transition hover:bg-accent/20"
              >
                <span className="text-base">🏀</span>
                <div>
                  <p className="text-xs font-semibold text-accent">
                    Try Demo
                  </p>
                  <p className="text-[10px] text-muted">
                    No wallet needed
                  </p>
                </div>
              </button>

              {status === "connecting" && (
                <p className="mt-2 text-xs text-muted">Connecting...</p>
              )}
              {error != null && (
                <p className="mt-2 text-xs text-destructive">
                  {error instanceof Error ? error.message : String(error)}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Demo sign-in modal */}
        {showDemoSignin && (
          <DemoSignin onClose={() => setShowDemoSignin(false)} />
        )}
      </>
    );
  }

  // ── Connected state ───────────────────────────────────────────────────────
  const displayName = wallet?.account.label;
  const shortLabel = isDemoMode && displayName
    ? displayName.replace("Demo: ", "")
    : ellipsify(address!, 4);

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        onClick={() => (isOpen ? close() : open())}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={isDemoMode ? `Demo wallet: ${shortLabel}` : `Wallet: ${ellipsify(address!, 4)}`}
        className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-border-low bg-card px-3 py-2 text-xs font-medium transition hover:bg-cream"
      >
        {isDemoMode ? (
          <>
            <span className="text-sm">🏀</span>
            <span className="font-medium">{shortLabel}</span>
            <span className="rounded bg-accent-subtle px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent">
              demo
            </span>
          </>
        ) : (
          <>
            <span className="h-2 w-2 rounded-full bg-positive" />
            <span className="font-mono">{ellipsify(address!, 4)}</span>
          </>
        )}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Wallet details"
          className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-border-low bg-card p-4 shadow-lg"
        >
          {isDemoMode && (
            <div className="mb-3 rounded-lg border border-accent/20 bg-accent-subtle px-3 py-2">
              <p className="text-xs font-semibold text-accent">
                🏀 Demo Mode
              </p>
              <p className="text-[11px] text-muted">
                Trading with fake devnet SOL — nothing is real.
              </p>
            </div>
          )}

          <div className="mb-3">
            <p className="text-xs text-muted">Balance</p>
            <p className="text-lg font-bold tabular-nums">
              {balance.lamports != null
                ? formatUsd(balance.lamports)
                : "\u2014"}
            </p>
          </div>

          <div className="mb-3 rounded-lg border border-border-low bg-cream/50 px-3 py-2">
            <p className="break-all font-mono text-xs">{address}</p>
          </div>

          <div className="mb-2 space-y-1">
            <Link
              href="/portfolio"
              onClick={close}
              className="flex w-full items-center gap-2 rounded-lg border border-border-low bg-card px-3 py-2 text-xs font-medium transition hover:bg-cream"
            >
              <span>📊</span>
              <span>My Portfolio</span>
            </Link>
            <Link
              href="/leaderboard"
              onClick={close}
              className="flex w-full items-center gap-2 rounded-lg border border-border-low bg-card px-3 py-2 text-xs font-medium transition hover:bg-cream"
            >
              <span>🏆</span>
              <span>Leaderboard</span>
            </Link>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="flex-1 cursor-pointer rounded-lg border border-border-low bg-card px-3 py-2 text-xs font-medium transition hover:bg-cream"
            >
              {copied ? "Copied!" : "Copy address"}
            </button>
            {!isDemoMode && (
              <a
                href={getExplorerUrl(`/address/${address}`)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 rounded-lg border border-border-low bg-card px-3 py-2 text-center text-xs font-medium transition hover:bg-cream"
              >
                Explorer
              </a>
            )}
          </div>

          <button
            onClick={() => {
              if (isDemoMode) {
                disconnectDemo();
              } else {
                disconnect();
              }
              close();
            }}
            className="mt-2 w-full cursor-pointer rounded-lg border border-border-low bg-card px-3 py-2 text-xs font-medium text-destructive transition hover:bg-destructive/10"
          >
            {isDemoMode ? "Exit Demo Mode" : "Disconnect"}
          </button>
        </div>
      )}
    </div>
  );
}
