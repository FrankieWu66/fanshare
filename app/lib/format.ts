/** Format lamports for axis/tooltip labels (compact: 1200 → "1.2k", 2500000 → "2.5M") */
export function formatLamports(lamports: number): string {
  if (lamports >= 1_000_000) return `${(lamports / 1_000_000).toFixed(1)}M`;
  if (lamports >= 1_000) return `${(lamports / 1_000).toFixed(1)}k`;
  return lamports.toFixed(0);
}
