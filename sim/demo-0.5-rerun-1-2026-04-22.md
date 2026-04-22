# Demo 0.5 — Sim Rerun 1 Report (Round 1 copy changes applied)
*Generated 2026-04-22. Baseline run 2026-04-22. Round 1 P0 copy changes shipped in commit 73a7611.*

## Headline scores

| Metric | Baseline | Rerun 1 | Δ | Marketing's predicted landing |
|---|---|---|---|---|
| visual_professionalism | 6.92 | **7.15** | +0.23 | — |
| **trust_signal_strength** | **4.85** | **5.08** | **+0.23** | **6.0–6.8** |
| would_show_friend | 6.54 | 6.38 | −0.15 | — |

N=13 (2 vision-call rate-limit errors on Tier 1 quota, same in both runs).

## Decision-tree outcome

Per [invite-copy-p0-implement handoff](../../../ceo/handoffs/2026-04-22-invite-copy-p0-implement.md):

- ≥6.0 → Demo 0.5 exit CLEARED
- 5.5 ≤ score < 6.0 → Round 2 P1 items
- **< 5.5 → ESCALATE** (marketing flagged this as instrument-mismodeling territory — don't iterate further)

**Result: 5.08 < 5.5 → ESCALATE.** Stop iterating on copy. File upstream with scores + hypotheses. CEO decides next step.

## What the P0 changes accomplished

Five P0 changes shipped in commit `73a7611`, all visible live on prod:

| # | Change | Measurable effect in rerun |
|---|---|---|
| 1 | `DEVNET`/`INVITE`/`DEMO 1` cluster → single "Practice mode" | `DEVNET` flagged as confusion point 0/15 times in rerun (was 10+ in baseline). The label rename worked. |
| 2 | `0.0%` ticker → "AWAITING TIP-OFF" | One agent still flagged the new copy as not-totally-understood ("does it mean trading is locked right now or just that tonight's games haven't started"). Improvement, not a full fix. |
| 3 | `SOL` scrubbed from user-facing copy | `0.667 SOL · $100` confusion flagged 0/15 times (was 5+ in baseline). Clean win. |
| 4 | LeBron guardrail sentence "Catching the gap is the skill. The outcome isn't guaranteed." | **bot-11 (the newbie who made the dangerous mental-model error in baseline) did NOT recur it in rerun.** Checkpoint answer rerun: "Fair value is basically what the computer says the player is actually worth based on his stats — that's like the true price..." — accurate, not a guarantee framing. Guardrail landed. |
| 5 | Badges section cut | `oracle updates` confusion flagged 0/15 times in rerun (was 8+ in baseline). Side-effect of the cut, as marketing predicted. |

## Why trust moved only +0.23 despite clean wins on all 5 P0s

Rerun vision notes aggregated — the #1 trust-killer pattern shifted from copy to visual inventory:

**7 of 13 agents specifically flagged missing visual trust anchors:**

> bot-07 (value): *"The dark theme with grid lines reads like a legit fintech product — clean hierarchy, good use of weight contrast in the headline. The trust floor is low though: no logo visible, no nav, no social proof imagery, nothing that signals an established brand behind this."*

> bot-14 (skeptic): *"The dark theme and typography hierarchy are competent — someone who knows design touched this. But the 'Claim $100' button on a page with zero logos, no nav, no visible brand identity reads like a squeeze page, and that makes me suspicious before I've even processed the copy."*

> bot-05 (value): *"The dark grid + orange palette is coherent and communicates 'serious trading tool' rather than a casual game, which earns partial trust visually. However, there are no logos, badges, partner marks, or UI previews visible — nothing that signals an actual product exists behind this."*

> bot-12 (skeptic): *"Dark theme is competent but not distinctive — looks like a crypto project that learned from its mistakes, which is either reassuring or suspicious. The 'no real money · no seed phrase' micro-copy below the CTA is doing real trust work visually, but it's tiny and grey when it should be prominent."*

**6 of 13 agents flagged "sparse below the fold / empty dead space":**

> bot-04 (hype): *"Page feels a bit sparse below the fold though — not much going on, no charts, no price action, nothing moving. Where's the product?"*

> bot-06 (value): *"there's a lot of empty real estate below the fold that makes it feel like a landing page stub rather than a finished product"*

> bot-11 (newbie): *"The page feels a little sparse below the fold though, like there's a lot of empty dark space before that explanation box"*

These are **visual inventory gaps**, not copy gaps. Copy can't create a logo or fill a below-fold with product screenshots. Round 2 P1 items (stats-pillar hero anchor, amber CTA spec update) don't address these either.

## Hypotheses for why the instrument landed 1.0 below marketing's prediction

Marketing predicted 6.0–6.8; we landed at 5.08. Three non-exclusive hypotheses:

1. **Baseline report underweighted visual-inventory gaps.** The Tech-authored mental-model report surfaced copy/vocabulary gaps prominently. The "no logo / no nav / no social proof" signal was present in baseline vision notes but didn't get front-page treatment, so marketing scoped around copy only. In retrospect, logo + nav + social proof is in the same tier of importance as the top 5 P0 copy items.
2. **Sonnet 4.6 vision has a structural trust floor around 5/10 for demo-state products.** Any page that honestly discloses "practice mode · no real money" gets anchored near 5 regardless of the rest. This would be true of any AI-vision instrument reading trust off a visual screenshot of a demo page. If so, the sim is directionally useful (5→5.08 means *something* improved) but the absolute number can't cross a threshold without structural product changes (logo, nav, social proof).
3. **Sample variance.** N=13 with individual scores 4–7 has natural standard deviation ≈0.7. A 0.23 delta is ~0.3σ — inside the noise band. True effect size may be indistinguishable from zero.

Most likely a combination of (1) and (2).

## What copy WINS look like (independent of trust score)

Worth calling out because the decision tree risks reading like "all that work for nothing":

- **The dangerous mental-model error is FIXED.** bot-11 no longer reads the LeBron example as a price guarantee. This was the highest-stakes finding from baseline and the fix stuck.
- **DEVNET, SOL, oracle-updates confusion ALL went to zero** in rerun. Three P0 items cleanly resolved their target signal.
- **visual_professionalism moved up** (+0.23) — agents perceive the page as more finished/intentional post-cleanup even though trust didn't crack the next threshold.

If the success criterion for copy polish is "agents understand the product without dangerous misinterpretations," Round 1 succeeded. If the success criterion is "trust score ≥ 6.0," Round 1 is directionally correct but structurally blocked by non-copy factors.

## Recommended paths forward (for CEO)

Marketing's protocol says CEO decides; tech does not pre-empt. Three options framed:

**Option A — Accept 5.08, ship Demo 1 as-is.** Real humans give real signal. If friends report trust issues, we know visual-infrastructure is the gap and invest then. If friends don't flag trust, the AI sim over-penalized.

**Option B — Invest in visual trust infrastructure before Demo 1.** Add logo to nav, add a short team/about section, fill below-fold with live content (leaderboard preview, recent-trades stream, etc.), resolve the "squeeze page" read. Push Demo 1 by ~1 week. Likely moves trust to 6+ range.

**Option C — Recalibrate the instrument first.** Tech tweak the persona prompt to weight copy vs visuals differently, re-run baseline, see what the persona-reweighted scores look like. Cheap (<$2), fast (~5 min). Tells us whether hypothesis (2) above is correct before spending human time on either A or B.

## Deliverables from this rerun

- Run artifacts: [`analytics/sim-runs/2026-04-22-rerun-1/`](../analytics/sim-runs/2026-04-22-rerun-1/)
  - `summary.md` — the auto-generated deliverable
  - 15 journals, `events.csv`, `errors.csv`
  - Screenshots gitignored (7MB, regenerable)
- This report: `sim/demo-0.5-rerun-1-2026-04-22.md`
- Upstream handoff to CEO: `/ceo/handoffs/2026-04-22-invite-copy-rerun-report.md`

## Commits referenced

- `73a7611` — the 5 P0 copy changes + DESIGN_SYSTEM.md amber-CTA pattern
- Baseline: `cb97802` (the infrastructure + first run)
