# Tech TODO

Persistent across sessions. Tech-owned. On session start, scan this before any new work. See `/Users/frankiewu/dev/fanshare/tech/WORKFLOW.md` for the lifecycle.

## Parked CEO handoffs
*(empty — no active CEO handoffs assigned to tech)*

## Tech-internal deferrals
- [ ] [trading-functional-verification] — added 2026-04-22 — full trading flow QA (buy/sell, bonding curve math, oracle integration, slippage). BLOCKED on Jerry Zhu finishing index modifications per NBA schedule. No longer a "Demo" event — becomes Tech-internal smoke test once Jerry signals ready. Method/scope TBD then.
- [ ] [demo-0.5-polish-iteration] — added 2026-04-22 — first full run on 2026-04-22 (artifacts committed at analytics/sim-runs/2026-04-22/) surfaced concrete polish targets for /invite before Demo 1: (a) define 'devnet SOL' in copy for NBA-fan personas, (b) explain 'oracle updates' on Diamond Hands badge, (c) specify which stats drive fair-value math, (d) swap amber solid-fill CTA for green Buy-button pattern per DESIGN_SYSTEM.md (spec reserves amber for accents only), (e) ensure DM Sans loads on body text (currently system fallback), (f) ensure Geist Mono on ticker prices, (g) trust_signal_strength baseline 4.8/10 driven by DEVNET badge perception — consider softer wording. Re-run cost with Haiku iteration model: ~$0.50/run to validate each batch of fixes. Run command: `QA_BASE_URL=https://fanshares.xyz ANTHROPIC_MODEL=claude-haiku-4-5-20251001 npm run qa:onboarding-sim` (prod target acceptable while no real users; switch to preview once others signed up).
