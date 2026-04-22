# Demo 0.5 — Onboarding Sim Summary

**Started:** 2026-04-22T23:14:31.526Z  
**Ended:** 2026-04-22T23:16:23.873Z  
**Base URL:** https://fanshares.xyz  
**Model:** claude-sonnet-4-6  
**Agents:** 15 (12 desktop, 3 mobile)

---

## 1. Top 5 first-impression elements (visual, aggregated across agents)

1. **The LeBron $5.59 vs $4.20 undervalued example — that made it click instantly** — noticed by 1/15 agents
2. **Big 'Claim $100 →' button with 'no real money · no seed phrase' right underneath it** — noticed by 1/15 agents
3. **'AWAITING TIP-OFF' ticker at the top — felt alive, like something's about to happen** — noticed by 1/15 agents
4. **The 'Claim $100' button — big, orange-ish energy, impossible to miss, first thing my eyes went to** — noticed by 1/15 agents
5. **'No account yet — $100 · no real money · no seed phrase' — that no seed phrase line hit different, immediately felt safer than 90 percent of crypto stuff I've seen** — noticed by 1/15 agents

## 2. Top 5 ignored elements (the page tried to show, agents didn't engage)

1. **'↓Terms explained' link — didn't even consider clicking it** — ignored by 1/15 agents
2. **About · Methodology · Invite footer links** — ignored by 1/15 agents
3. **The 'Thesis' one-liner — skimmed past it, sounded corporate** — ignored by 1/15 agents
4. **💬Feedback button** — ignored by 1/15 agents
5. **The 'About' and 'Methodology' links in the footer — not touching those right now, that's homework-mode energy** — ignored by 1/15 agents

## 3. Top 5 confusion points (vocabulary + unclear CTAs)

1. **'fair-value price' vs 'market price' — I get the concept but the math behind how stats become a dollar number is a black box to me** — flagged by 1 agent(s)
2. **'Devnet' in the top bar — I know that's a crypto thing meaning testnet but a casual fan would have no idea** — flagged by 1 agent(s)
3. **'AWAITING TIP-OFF' — cool flavor text but I wasn't sure if that meant the app was broken or just waiting for games to start** — flagged by 1 agent(s)
4. **The 'Thesis' section felt like it was written for a VC deck, not for me** — flagged by 1 agent(s)
5. **'Devnet' in the top bar — I know that's a crypto thing but it felt a little technical for what is otherwise a very friendly page, like who is that label for** — flagged by 1 agent(s)

## 4. Aesthetic trust baseline (/invite vision assessments)

| Metric | Mean | Median |
|---|---|---|
| visual_professionalism | 7.7 / 10 | 8.0 |
| trust_signal_strength | 6.9 / 10 | 7.0 |
| trust_inventory_completeness | 2.8 / 10 | 3.0 |
| would_show_friend | 7.1 / 10 | 7.0 |

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

Run `npx tsx scripts/qa/design-pass.ts --dir /Users/frankiewu/dev/fanshare/tech/analytics/sim-runs/2026-04-22-rerun-3` to produce the DESIGN_SYSTEM.md violations report from the captured screenshots.

## 9. Next step: cross-reference

Run `npx tsx scripts/qa/cross-reference.ts --dir /Users/frankiewu/dev/fanshare/tech/analytics/sim-runs/2026-04-22-rerun-3` to join events + journals + Tally submissions by session_id.
