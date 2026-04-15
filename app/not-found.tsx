import Link from "next/link";
import { GridBackground } from "./components/grid-background";

export default function NotFound() {
  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <GridBackground />
      <div className="relative z-10">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="font-display text-lg font-extrabold tracking-tight">FanShare</span>
            <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs font-medium text-accent">
              devnet
            </span>
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center rounded-lg px-4 text-sm font-medium text-muted transition hover:text-foreground"
          >
            ← Back to Market
          </Link>
        </header>

        <div className="flex min-h-[calc(100vh-72px)] flex-col items-center justify-center px-6 text-center">
          <p className="mb-4 font-mono text-6xl font-bold text-muted/30">404</p>
          <h1 className="mb-2 text-2xl font-bold">Page not found</h1>
          <p className="mb-8 text-sm text-muted">
            This page doesn&apos;t exist. Maybe it was a player ID typo?
          </p>
          <Link
            href="/"
            className="rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground shadow-xs transition hover:bg-accent/90"
          >
            Browse Players
          </Link>
        </div>
      </div>
    </div>
  );
}
