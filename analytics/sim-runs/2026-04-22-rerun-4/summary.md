# Demo 0.5 — Onboarding Sim Summary

**Started:** 2026-04-22T23:22:54.183Z  
**Ended:** 2026-04-22T23:49:47.418Z  
**Base URL:** https://fanshares.xyz  
**Model:** claude-sonnet-4-6  
**Agents:** 15 (12 desktop, 3 mobile)

---

## 1. Top 5 first-impression elements (visual, aggregated across agents)

1. **Big 'Claim $100 →' button — that's the first thing my eyes went to, orange energy** — noticed by 1/15 agents
2. **The LeBron price example ($5.59 vs $4.20) — instantly made it real for me** — noticed by 1/15 agents
3. **'No real money, no seed phrase' badge — that killed my hesitation fast** — noticed by 1/15 agents
4. **Big bold 'Trade player tokens that move with real stats' headline — felt premium and direct** — noticed by 1/15 agents
5. **'Claim $100 →' button — that's the first thing my eye went to after the headline, it's doing a lot of work** — noticed by 1/15 agents

## 2. Top 5 ignored elements (the page tried to show, agents didn't engage)

1. **'↓Terms explained' link — didn't even register it was there** — ignored by 2/15 agents
2. **💬Feedback button** — ignored by 2/15 agents
3. **About · Methodology · Invite footer links — skipped completely** — ignored by 1/15 agents
4. **The 'Thesis' section — saw the word, kept scrolling** — ignored by 1/15 agents
5. **The 'Thesis' section with 'Being right early — and staying right — pays better than being right once' — saw it, skimmed past it** — ignored by 1/15 agents

## 3. Top 5 confusion points (vocabulary + unclear CTAs)

1. **'fair-value price' vs 'market price' — I get the concept but I'm not 100% sure how the computer calculates the fair-value number, feels like a black box** — flagged by 1 agent(s)
2. **'Devnet' in the header — I know that's a blockchain test environment but a non-crypto person would have zero idea what that means** — flagged by 1 agent(s)
3. **'AWAITING TIP-OFF' — cute but I wasn't sure if that meant the app was broken or just waiting for tonight's games** — flagged by 1 agent(s)
4. **The 'gap is your edge' line — sounds cool but it's doing a lot of work without explaining the actual mechanism** — flagged by 1 agent(s)
5. **'The gap is your edge' — sounds cool but took me a second to parse what 'gap' actually means in practice** — flagged by 1 agent(s)

## 4. Aesthetic trust baseline (/invite vision assessments)

| Metric | Mean | Median |
|---|---|---|
| visual_professionalism | 6.9 / 10 | 7.0 |
| trust_signal_strength | 4.7 / 10 | 5.0 |
| trust_inventory_completeness | 3.1 / 10 | 3.0 |
| would_show_friend | 5.9 / 10 | 6.0 |

## 5. Desktop vs Mobile — funnel split

| Cohort | N | grant_claimed | feedback_opened | tally_submitted |
|---|---|---|---|---|
| Desktop | 12 | 12 | 12 | 0 |
| Mobile | 3 | 3 | 3 | 0 |

## 6. Event firing matrix (6 onboarding-side events)

- `invite_page_viewed`: 15/15 agents
- `terms_expanded`: 3/15 agents
- `about_demo_clicked`: 0/15 agents
- `invite_cta_clicked`: 15/15 agents
- `grant_claimed`: 15/15 agents
- `feedback_opened`: 15/15 agents

## 7. Errors

_no errors recorded_

## 8. Next step: designer pass

Run `npx tsx scripts/qa/design-pass.ts --dir /Users/frankiewu/dev/fanshare/tech/analytics/sim-runs/2026-04-22-rerun-4` to produce the DESIGN_SYSTEM.md violations report from the captured screenshots.

## 9. Next step: cross-reference

Run `npx tsx scripts/qa/cross-reference.ts --dir /Users/frankiewu/dev/fanshare/tech/analytics/sim-runs/2026-04-22-rerun-4` to join events + journals + Tally submissions by session_id.
