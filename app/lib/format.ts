/** Format lamports for axis/tooltip labels (compact: 1200 → "1.2k", 2500000 → "2.5M") */
export function formatLamports(lamports: number): string {
  if (lamports >= 1_000_000) return `${(lamports / 1_000_000).toFixed(1)}M`;
  if (lamports >= 1_000) return `${(lamports / 1_000).toFixed(1)}k`;
  return lamports.toFixed(0);
}

/** Format lamports as compact USD for chart axes/tooltips. */
export function formatLamportsAsUsd(lamports: number): string {
  const usd = (lamports / 1_000_000_000) * 150;
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}
