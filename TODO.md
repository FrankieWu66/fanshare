# Tech TODO

Persistent across sessions. Tech-owned. On session start, scan this before any new work. See `/Users/frankiewu/dev/fanshare/tech/WORKFLOW.md` for the lifecycle.

## Parked CEO handoffs
- [ ] [demo-1-plan] (handoff: /Users/frankiewu/dev/fanshare/ceo/handoffs/2026-04-22-demo-1-plan.md) — added 2026-04-22 — draft the Demo 1 execution plan (scope lock / concurrency target / date / go-no-go gates / monitoring + rollback / data capture). Due 2026-04-24 EOD. Seed sections 1-2 from the Demo 0.5 sim outputs (mental-model report + design-violations + summary). Output resolved 2026-04-22 by Frankie: draft at `/tech/sim/demo-1-execution-plan-draft.md` (tech-owned source of truth); CEO reads from there when layering CEO pieces and relocates into `/ceo/roadmap/demo-1.md`.

## Tech-internal deferrals
- [ ] [trading-functional-verification] — added 2026-04-22 — full trading flow QA (buy/sell, bonding curve math, oracle integration, slippage). BLOCKED on Jerry Zhu finishing index modifications per NBA schedule. No longer a "Demo" event — becomes Tech-internal smoke test once Jerry signals ready. Method/scope TBD then.
- [ ] [demo-0.5-polish-iteration] — added 2026-04-22 — **Round 1 done** (commits `73a7611` + `1d25c30`): 5 P0 copy items shipped, sim rerun trust_signal=5.08 (<5.5 ESCALATE). User-as-CEO chose **C then B** (verbal, 2026-04-22). **Round 2 active:**
  - **(C) Recalibrate sim instrument** — modify `visionSystemPrompt()` in [scripts/qa/bot-reasoning.ts](scripts/qa/bot-reasoning.ts):310 with anchor for intentionally-minimal pages ("rate quality of what's there, not penalize for missing logo/nav/social-proof if the page is purposefully a single-CTA conversion landing"). Re-run post-P0 build, decompose trust into copy-vs-visual signals if useful. Cost ~$2, ~5 min.
  - **(B) Invest in visual trust infrastructure** — scope TBD with user after C surfaces. Likely: add logo + nav, short team/about section, fill below-fold (leaderboard preview, recent-trades stream). ~1 week slip on Demo 1 timeline. Will draft scope-options into `/tech/sim/demo-0.5-round-2-b-plan.md` for user review before implementing.
  - **Pending close:** rerun-report upstream handoff at `/ceo/handoffs/2026-04-22-invite-copy-rerun-report.md` stays open (CEO session needs to formally close — user verbal decision recorded in `## Completed` of `invite-copy-p0-implement`).
  - **Cleanup parked:** `npm run reclaim-demo` deferred until C run completes (saves a second cleanup cycle).
  - Run command (unchanged): `QA_BASE_URL=https://fanshares.xyz npm run qa:onboarding-sim` (Sonnet via .env.local for apples-to-apples vs baseline + rerun 1).
