"use client";

import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { useWallet } from "../lib/wallet/context";
import { track, identifyWallet } from "../lib/analytics/track";

interface Props {
  onClose: () => void;
}

export function DemoSignin({ onClose }: Props) {
  const { connectDemo } = useWallet();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Focus input on open
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    try {
      await connectDemo(trimmed);
      toast.success("$100 landed. Go find a mispriced player.");
      // Grant confirmed on-chain: wallet is provisioned + 0.05 SOL transferred
      // inside the /api/demo/register call. Read the address from localStorage
      // where the wallet context just wrote it (context doesn't return it).
      let wallet: string | null = null;
      try {
        const raw = localStorage.getItem("fanshare_demo");
        if (raw) wallet = (JSON.parse(raw) as { address?: string }).address ?? null;
      } catch {
        /* ignore — event still fires with wallet=null */
      }
      identifyWallet(wallet);
      track("grant_claimed", { wallet });
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong. Try again.";
      setError(msg);
      track("error_shown", {
        source: "demo_signin",
        message: msg.slice(0, 200),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      ref={overlayRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Start demo trading"
    >
      <div className="mx-4 w-full max-w-sm rounded-2xl border border-border-low bg-card p-6 shadow-xl">
        {/* Header */}
        <div className="mb-5">
          <div className="mb-2 text-2xl">🏀</div>
          <h2 className="font-display text-xl font-extrabold tracking-tight">
            Try FanShare
          </h2>
          <p className="mt-1 text-sm text-muted">
            No crypto wallet needed. We&apos;ll set everything up for you.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="demo-name"
              className="mb-1.5 block text-xs font-medium text-muted"
            >
              Your name (so you can find your account)
            </label>
            <input
              ref={inputRef}
              id="demo-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jordan"
              maxLength={32}
              disabled={loading}
              className="w-full rounded-lg border border-border-low bg-cream/50 px-3 py-2.5 text-sm font-medium placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 disabled:opacity-50"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!name.trim() || loading}
            className="w-full cursor-pointer rounded-lg bg-accent px-4 py-3 text-sm font-bold text-accent-foreground transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Setting up your account…
              </span>
            ) : (
              "Start Trading →"
            )}
          </button>
        </form>

        {/* Fine print */}
        <p className="mt-4 text-center text-[11px] text-muted/70">
          Practice mode. No real money, no risk.
        </p>

        {/* Divider + real wallet option */}
        <div className="mt-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-border-low" />
          <span className="text-[11px] text-muted/60">or</span>
          <div className="h-px flex-1 bg-border-low" />
        </div>
        <button
          onClick={onClose}
          className="mt-3 w-full cursor-pointer rounded-lg border border-border-low bg-transparent px-4 py-2.5 text-xs font-medium text-muted transition hover:bg-cream hover:text-foreground"
        >
          I have a Phantom wallet
        </button>
      </div>
    </div>
  );
}
