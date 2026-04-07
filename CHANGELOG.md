# Changelog

All notable changes to FanShare are documented here.

## [0.1.1.0] - 2026-04-07

### Fixed
- **RPC timeout guard** — `getMultipleAccounts` now rejects after 8s instead of hanging indefinitely, triggering the mock data fallback so the market grid stays usable.
- **Dust amount hint** — entering a SOL amount too small to buy any tokens now shows "Amount too small — enter at least X SOL" instead of silently disabling the Buy button.

## [0.1.0.0] - 2026-04-06

### Added
- **Stats-anchored pricing** — every player's base price is now derived from their
  season stats (`PPG×1000 + RPG×500 + APG×700 + SPG×800 + BPG×800 × 0.5`). Elite
  players visibly cost more from day 1. Formula shown transparently on the trade page.
- **Tier system** — Stars (score ≥ 40k): steeper curve, lower cap. Second (≥ 25k):
  moderate curve. Rising (<25k): gentle curve, full 1M supply. Slope and supply
  computed automatically from stats.
- **Rookie pricing** — draft-order formula (`18,000 × (61 − pick) / 60` lamports) for
  players without NBA stats. Pick 1 approaches lower-tier veterans; Pick 60 near floor.
- **Interactive price impact preview** — typing a SOL amount shows a hollow dot on the
  bonding curve chart at the projected post-buy position.
- **Transaction stage UI** — Buy/Sell button cycles through Approve → Confirming → Done
  with a 3-second success hold. Double-click protected. Simulated pre-deploy; wires to
  real wallet on mainnet.
- **Price history chart** — Curve / History tab switcher on the trade page. History tab
  fetches oracle snapshots from Vercel KV via `/api/price-history/[playerId]`.
- **Vercel KV persistence** — oracle writes `{t, p}` entries to Redis after each
  on-chain update. LTRIM keeps the newest 500 per player. API route serves them with
  30-second edge cache.
- **Season averages sidebar** — stat bars (PPG, RPG, APG, SPG, BPG) on the trade page
  for all 15 devnet players.
- **3-column trade layout** — stats sidebar, price curve, and trade widget in a
  responsive grid (stacks on mobile, side-by-side on desktop).
- **Localnet live data** — frontend reads bonding curve and oracle state directly from
  the local validator via on-chain deserialization.
- **Test coverage** — vitest suite covering bonding curve math (parity vectors,
  calculateBuyCost, calculateSellReturn, calculateTokensForSol, calculateSpread,
  formatSol) and pricing helpers (oracleScore, tierParams, veteranBasePrice,
  rookieBasePrice). 43 tests.

### Changed
- Design system applied: 36px H1, 12px card radius, 44px touch targets, amber accent
  consistent across stat bars, mobile trade widget stacked above stats.
- `PlayerConfig` extended with `priceFormula` field (veteran / rookie / floor) so the
  trade page can show the exact derivation without re-reading stale on-chain state.

### Fixed
- Silent on-chain noise no longer surfaces as UI errors.
- Sell form UX shows a hint when the wallet has no tokens to sell.
- `buy_with_sol` Rust test coverage added; oracle keypair fallback resolved.
