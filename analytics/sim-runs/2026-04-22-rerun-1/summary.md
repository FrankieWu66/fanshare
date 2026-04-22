# Demo 0.5 — Onboarding Sim Summary

**Started:** 2026-04-22T22:38:48.756Z  
**Ended:** 2026-04-22T22:40:38.879Z  
**Base URL:** https://fanshares.xyz  
**Model:** claude-sonnet-4-6  
**Agents:** 15 (12 desktop, 3 mobile)

---

## 1. Top 5 first-impression elements (visual, aggregated across agents)

1. **Big 'Claim $100 →' button — that was the first thing I actually wanted to click** — noticed by 1/15 agents
2. **The LeBron $5.59 vs $4.20 undervalued example — instantly made it real for me** — noticed by 1/15 agents
3. **'No real money · no seed phrase' trust line — that killed my skepticism fast** — noticed by 1/15 agents
4. **Big 'Claim $100 →' button — that's the first thing my eye landed on, it's doing a lot of work** — noticed by 1/15 agents
5. **The 'no real money · no seed phrase' line right under the button — that killed my skepticism immediately** — noticed by 1/15 agents

## 2. Top 5 ignored elements (the page tried to show, agents didn't engage)

1. **'↓Terms explained' link — didn't even consider clicking it** — ignored by 1/15 agents
2. **'💬Feedback' button — not my problem right now** — ignored by 1/15 agents
3. **The 'How it works' anchor link — skimmed it but the page already explained it inline so felt redundant** — ignored by 1/15 agents
4. **The '↓Terms explained' link — I didn't touch it, no real money means I don't care right now** — ignored by 1/15 agents
5. **The 'Thesis' section that says being right early pays better than being right once — I skimmed past it, felt like investor-speak and not relevant to me yet** — ignored by 1/15 agents

## 3. Top 5 confusion points (vocabulary + unclear CTAs)

1. **'fair-value price' vs 'market price' — I get the vibe but I'd want to know exactly what stats go into the fair-value calc, like is it just points or also assists, usage rate, whatever** — flagged by 1 agent(s)
2. **'The gap is your edge' — sounds cool but also kinda vague, what gap, how big does it have to be to matter** — flagged by 1 agent(s)
3. **'AWAITING TIP-OFF' at the top — I noticed it but didn't totally understand if that means trading is locked right now or just that tonight's games haven't started** — flagged by 1 agent(s)
4. **Role player price swing comment — 'can meaningfully move a role player' — so should I be trading bench guys instead of LeBron? That's counterintuitive and I'd probably ignore it and buy LeBron anyway** — flagged by 1 agent(s)
5. **'fair-value price' vs 'market price' — I get the concept but I had to slow down on whether the computer's number or the crowd's number is the one I'm trading against** — flagged by 1 agent(s)

## 4. Aesthetic trust baseline (/invite vision assessments)

| Metric | Mean | Median |
|---|---|---|
| visual_professionalism | 7.2 / 10 | 7.0 |
| trust_signal_strength | 5.1 / 10 | 5.0 |
| would_show_friend | 6.4 / 10 | 6.0 |

## 5. Desktop vs Mobile — funnel split

| Cohort | N | grant_claimed | feedback_opened | tally_submitted |
|---|---|---|---|---|
| Desktop | 12 | 12 | 12 | 1 |
| Mobile | 3 | 3 | 3 | 0 |

## 6. Event firing matrix (6 onboarding-side events)

- `invite_page_viewed`: 15/15 agents
- `terms_expanded`: 3/15 agents
- `about_demo_clicked`: 0/15 agents
- `invite_cta_clicked`: 15/15 agents
- `grant_claimed`: 15/15 agents
- `feedback_opened`: 15/15 agents

## 7. Errors

Total: 2. See errors.csv for details.

## 8. Next step: designer pass

Run `npx tsx scripts/qa/design-pass.ts --dir analytics/sim-runs/2026-04-22-rerun-1` to produce the DESIGN_SYSTEM.md violations report from the captured screenshots.

## 9. Next step: cross-reference

Run `npx tsx scripts/qa/cross-reference.ts --dir analytics/sim-runs/2026-04-22-rerun-1` to join events + journals + Tally submissions by session_id.
