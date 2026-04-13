import Link from "next/link";
import { GridBackground } from "./components/grid-background";

export default function NotFound() {
  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <GridBackground />
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <p className="mb-4 font-mono text-6xl font-bold text-muted/30">404</p>
        <h1 className="mb-2 text-2xl font-bold">Page not found</h1>
        <p className="mb-8 text-sm text-muted">
          This page doesn&apos;t exist. Maybe it was a player ID typo?
        </p>
        <Link
          href="/"
          className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-xs transition hover:bg-primary/90"
        >
          Back to Market
        </Link>
      </div>
    </div>
  );
}
