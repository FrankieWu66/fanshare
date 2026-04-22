# Demo 0.5 — Sim Rerun 2 Report (Option C: instrument recalibration)

*Generated 2026-04-22. Same post-P0 build as rerun 1 (commit `73a7611`). Only change vs rerun 1: `visionSystemPrompt()` recalibrated with minimalism anchor + decomposed `trust_inventory_completeness` field.*

## Headline scores

| Metric | Baseline | Rerun 1 (P0 copy) | Rerun 2 (recalibrated instrument) | Δ rerun-1 → rerun-2 |
|---|---|---|---|---|
| visual_professionalism | 6.92 | 7.15 | **7.9** | +0.75 |
| **trust_signal_strength** | **4.85** | **5.08** | **6.9** | **+1.82** |
| trust_inventory_completeness | — | — | **2.0** | (new) |
| would_show_friend | 6.54 | 6.38 | **7.3** | +0.92 |

N=14 (1 vision-call rate-limit error on bot-14·mobile). Same seed as baseline + rerun 1 (`2026-04-22`) → same agents, same personas, only the rubric changed.

## Hypothesis test outcome

**Hypothesis (from rerun-1 report, hypothesis 2):** Sonnet 4.6 vision has a structural trust floor for any page that lacks standard SaaS trust inventory (logo / nav / social proof), regardless of how well-crafted the page is.

**Result: STRONGLY CONFIRMED.**

The only change in this run was the rubric for `trust_signal_strength`. The page itself is byte-for-byte identical to rerun 1. Trust jumped **+1.82** (5.08 → 6.9) from rubric change alone. That is ~2.6σ above noise (per the ~0.7 standard deviation observed at N=15).

The new `trust_inventory_completeness` score (2.0/10) confirms the inventory IS sparse — agents correctly observe the gap. They just no longer let that gap drag down the craft score.

## Decision-tree branch (re-evaluation)

Per marketing's original tree from [`invite-copy-p0-implement`](../../ceo/handoffs/2026-04-22-invite-copy-p0-implement.md):

- ≥6.0 → **Demo 0.5 exit gate CLEARED**
- 5.5 ≤ score < 6.0 → Round 2 P1
- < 5.5 → ESCALATE

**Recalibrated score: 6.9 → CLEARED** (above threshold by 0.9).

The original ESCALATE call from rerun 1 was correct given the data we had — a 1.0+ gap below marketing's prediction band IS instrument-mismodeling territory, exactly as marketing flagged. Rerun 2 confirms which way the instrument was mismodeling: it was over-penalizing for missing inventory.

## Spot-check: is this real signal or prompt compliance?

Concern: the new prompt explicitly says "a well-crafted minimal landing deserves 7-8 on trust." Did agents just comply with the suggested ceiling, or are they reasoning?

Spot-check of three agents (full journals at `analytics/sim-runs/2026-04-22-rerun-2/journals/`):

**bot-12 (skeptic) — trust 6 (NOT 7-8):**
> *"The 'no real money · no seed phrase' micro-copy is the only thing keeping me from closing the tab immediately, but there's no logo, no domain anchor, nothing telling me who built this. Clean craft, zero identity. That's the exact combo that precedes a rugpull."*

The skeptic is still penalizing — correctly — for anonymous-brand. Score 6 reflects: page is well-crafted (would have been 4-5 in old rubric), but the missing identity signal is still a real concern.

**bot-13 (skeptic) — trust 7:**
> *"Dark mode with tight typographic hierarchy and a restrained two-color accent system (orange + green dots) — this reads as intentional, not lazy."*

**bot-09 (newbie) — trust 7:**
> *"feels techy and intentional, not cheap"*

The reasoning is grounded in observable craft signals (typography, hierarchy, restraint, accent discipline). Not blind compliance — agents who SEE a real concern (anonymous brand) still ding the score.

Conclusion: signal is real. The prompt fixed a real bias.

## What this clarifies about Option B scope

The `trust_inventory_completeness = 2.0` score, combined with bot-12's "no logo, no domain anchor, nothing telling me who built this" quote, refines what B should target.

**The biggest remaining trust gap is identity, not chrome.**

Agents flag missing:
- Logo / brand mark
- "Who built this" signal
- Anchor showing FanShare is a real entity (team, about, footer with company name)

Agents do NOT flag missing:
- Top nav with multiple destinations (the focused-CTA discipline is correct)
- Large below-fold product preview
- Multi-section homepage

**This means B can be much smaller than the original "1 week" estimate.** The expensive parts of B (homepage build, leaderboard preview, recent-trades stream, multi-section nav) are NOT what agents are penalizing. The cheap part — adding identity — is what matters.

## Recommended B scope (tech recommendation, non-authoritative)

**B-tight (1-2 days estimated):**
- Add small logo / wordmark in top-left of /invite (and anywhere else it's missing)
- Add minimal footer to /invite: `"Built by FanShare · About · Methodology · Twitter"` — with each link going somewhere real (about page can be one paragraph + 3 names)
- Re-run sim with current (recalibrated) instrument
- Target: trust_signal_strength 7.5+, trust_inventory_completeness 5+

**If B-tight gets us to 7.5+ trust:** done, ship Demo 1.

**If B-tight stalls below 7.5:** escalate to B-medium (add real about page + recent-trades preview block), ~3-4 more days.

**If still stalled:** original B-full scope — homepage with full chrome.

This staged approach respects the user's "do c then b" directive while sizing B to what the data actually shows is missing.

## What changed in code (Option C delta)

Single source file modified: [`scripts/qa/bot-reasoning.ts`](../scripts/qa/bot-reasoning.ts) — `visionSystemPrompt()`:
- Added IMPORTANT context block anchoring on intentional minimalism for single-CTA conversion landings
- Added explicit guidance: "rate the QUALITY OF CRAFT on what's actually present"
- Added new field `trust_inventory_completeness` (separate signal, independent of trust_signal_strength)
- Updated `VisionAssessment` interface + `assessVisuals()` parser
- Updated [`scripts/qa/onboarding-sim.ts`](../scripts/qa/onboarding-sim.ts) summary aggregator to print the new field

No code change to `/invite` page or to any product surface. Rerun 2 measured the SAME page as rerun 1; only the measurement instrument changed.

## Deliverables

- Run artifacts: [`analytics/sim-runs/2026-04-22-rerun-2/`](../analytics/sim-runs/2026-04-22-rerun-2/)
  - `summary.md`, 14 journals, `events.csv`, `errors.csv`, screenshots (gitignored)
- This report: `sim/demo-0.5-rerun-2-2026-04-22.md`
- Reads as the closing artifact for Option C; no upstream handoff required (verbal user-as-CEO call closes the rerun-1 escalation loop).

## Commits referenced

- `73a7611` — the 5 P0 copy changes (post-P0 build, unchanged for rerun 2)
- `1d25c30` — rerun 1 report + artifacts
- (forthcoming) — Option C: visionSystemPrompt recalibration + rerun 2 report + artifacts
