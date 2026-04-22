# Tech TODO

Persistent across sessions. Tech-owned. On session start, scan this before any new work. See `/Users/frankiewu/dev/fanshare/tech/WORKFLOW.md` for the lifecycle.

## Parked CEO handoffs
- [ ] [demo-1-plan] (handoff: /Users/frankiewu/dev/fanshare/ceo/handoffs/2026-04-22-demo-1-plan.md) — added 2026-04-22 — draft the Demo 1 execution plan (scope lock / concurrency target / date / go-no-go gates / monitoring + rollback / data capture). Due 2026-04-24 EOD. Seed sections 1-2 from the Demo 0.5 sim outputs (mental-model report + design-violations + summary). Output resolved 2026-04-22 by Frankie: draft at `/tech/sim/demo-1-execution-plan-draft.md` (tech-owned source of truth); CEO reads from there when layering CEO pieces and relocates into `/ceo/roadmap/demo-1.md`.

## Tech-internal deferrals
- [ ] [trading-functional-verification] — added 2026-04-22 — full trading flow QA (buy/sell, bonding curve math, oracle integration, slippage). BLOCKED on Jerry Zhu finishing index modifications per NBA schedule. No longer a "Demo" event — becomes Tech-internal smoke test once Jerry signals ready. Method/scope TBD then.
- [ ] [demo-0.5-polish-iteration] — added 2026-04-22 — **Round 1 done** (commits `73a7611` + `1d25c30`): 5 P0 copy items shipped, sim rerun trust_signal=5.08 (<5.5 ESCALATE). User-as-CEO chose **C then B** (verbal, 2026-04-22). **Round 2:**
  - **(C) Recalibrate sim instrument** — DONE 2026-04-22. Modified `visionSystemPrompt()` in [scripts/qa/bot-reasoning.ts](scripts/qa/bot-reasoning.ts) with intentional-minimalism anchor + decomposed `trust_inventory_completeness` field. Rerun-2 vs rerun-1 (same page, instrument-only delta): trust_signal_strength 5.08 → 6.9 (+1.82, ~2.6σ). Confirms instrument-mismodeling hypothesis. Report at [sim/demo-0.5-rerun-2-2026-04-22.md](sim/demo-0.5-rerun-2-2026-04-22.md).
  - **(B-tight) Identity signal pass** — IN PROGRESS. Commit `ed7751a` shipped: top-left FanShare wordmark on /invite, footer link nav (About · Methodology · Invite), new /about page (1 paragraph + 3-name team), new /methodology page (4-pillar explainer). Rerun-3 sim launched against B-tight build to measure delta. Target: trust_signal_strength 7.5+, trust_inventory_completeness 5+.
  - **Pending B-tight outcomes:** if cleared (≥7.5) → ship Demo 1; if stalled (<7.5) → escalate to B-medium (real about-page depth, recent-trades preview block, ~3-4 days).
  - **Pending close:** rerun-report upstream handoff at `/ceo/handoffs/2026-04-22-invite-copy-rerun-report.md` stays open (CEO session needs to formally close — user verbal decision recorded in `## Completed` of `invite-copy-p0-implement`).
  - **Cleanup queued:** `npm run reclaim-demo` runs after rerun-3 completes — recovers SOL across baseline + rerun-1 + rerun-2 + rerun-3.
  - Run command: `QA_BASE_URL=https://fanshares.xyz npm run qa:onboarding-sim -- --out-dir <path>` (Sonnet via .env.local for apples-to-apples).
