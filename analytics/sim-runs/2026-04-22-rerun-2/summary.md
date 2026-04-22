# Demo 0.5 — Onboarding Sim Summary

**Started:** 2026-04-22T22:59:02.912Z  
**Ended:** 2026-04-22T23:01:32.621Z  
**Base URL:** https://fanshares.xyz  
**Model:** claude-sonnet-4-6  
**Agents:** 15 (12 desktop, 3 mobile)

---

## 1. Top 5 first-impression elements (visual, aggregated across agents)

1. **LeBron $5.59 vs $4.20 undervalued example — that grabbed me immediately** — noticed by 1/15 agents
2. **Big 'Claim $100 →' button with 'no real money · no seed phrase' right underneath it** — noticed by 1/15 agents
3. **'AWAITING TIP-OFF' countdown energy at the top — made it feel live and urgent** — noticed by 1/15 agents
4. **The 'Claim $100 →' button — big, obvious, first thing I wanted to click** — noticed by 1/15 agents
5. **'AWAITING TIP-OFF' banner because it felt live and real-time, like something was actually about to happen** — noticed by 1/15 agents

## 2. Top 5 ignored elements (the page tried to show, agents didn't engage)

1. **'💬Feedback' button — completely invisible to me** — ignored by 2/15 agents
2. **'↓Terms explained' link — didn't even look at it** — ignored by 1/15 agents
3. **'💬Feedback' button — zero interest right now** — ignored by 1/15 agents
4. **The 'How it works' anchor link — I just read the page, didn't need to jump anywhere** — ignored by 1/15 agents
5. **The '↓Terms explained' link — I saw it but did not read it, I trust the 'no real money' line enough** — ignored by 1/15 agents

## 3. Top 5 confusion points (vocabulary + unclear CTAs)

1. **'fair-value price' — I get the concept but who's the 'computer' setting it? Feels hand-wavy** — flagged by 1 agent(s)
2. **'The gap is your edge' — sounds slick but I want to know if the gap can just... never close** — flagged by 1 agent(s)
3. **'Buying raises the price for the next person' — wait, is this an AMM thing? Bonding curve? They didn't say that explicitly and now I'm side-eyeing it a little** — flagged by 1 agent(s)
4. **'fair-value price' vs 'market price' distinction felt clear in the example but I'm still fuzzy on exactly what stat formula they're running — like is it PPG only or full box score?** — flagged by 1 agent(s)
5. **'Buying raises the price for the next person' — so is this a bonding curve thing? That part went over my head a little and I didn't fully process the implication** — flagged by 1 agent(s)

## 4. Aesthetic trust baseline (/invite vision assessments)

| Metric | Mean | Median |
|---|---|---|
| visual_professionalism | 7.9 / 10 | 8.0 |
| trust_signal_strength | 6.9 / 10 | 7.0 |
| trust_inventory_completeness | 2.0 / 10 | 2.0 |
| would_show_friend | 7.3 / 10 | 7.0 |

## 5. Desktop vs Mobile — funnel split

| Cohort | N | grant_claimed | feedback_opened | tally_submitted |
|---|---|---|---|---|
| Desktop | 12 | 12 | 12 | 1 |
| Mobile | 3 | 2 | 2 | 0 |

## 6. Event firing matrix (6 onboarding-side events)

- `invite_page_viewed`: 15/15 agents
- `terms_expanded`: 3/15 agents
- `about_demo_clicked`: 0/15 agents
- `invite_cta_clicked`: 14/15 agents
- `grant_claimed`: 14/15 agents
- `feedback_opened`: 14/15 agents

## 7. Errors

Total: 3. See errors.csv for details.

## 8. Next step: designer pass

Run `npx tsx scripts/qa/design-pass.ts --dir /Users/frankiewu/dev/fanshare/tech/analytics/sim-runs/2026-04-22-rerun-2` to produce the DESIGN_SYSTEM.md violations report from the captured screenshots.

## 9. Next step: cross-reference

Run `npx tsx scripts/qa/cross-reference.ts --dir /Users/frankiewu/dev/fanshare/tech/analytics/sim-runs/2026-04-22-rerun-2` to join events + journals + Tally submissions by session_id.
