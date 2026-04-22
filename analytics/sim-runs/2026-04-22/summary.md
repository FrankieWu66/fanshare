# Demo 0.5 — Onboarding Sim Summary

**Started:** 2026-04-22T20:52:19.044Z  
**Ended:** 2026-04-22T20:54:12.744Z  
**Base URL:** https://fanshares.xyz  
**Model:** claude-sonnet-4-6  
**Agents:** 15 (12 desktop, 3 mobile)

---

## 1. Top 5 first-impression elements (visual, aggregated across agents)

1. **$LBJ $5.59 in the live ticker — Lakers fan, I clocked that immediately** — noticed by 1/15 agents
2. **Big 'Claim $100 →' button — high contrast, impossible to miss** — noticed by 1/15 agents
3. **'No wallet yet · no real money · no seed phrase' trust strip under the button** — noticed by 1/15 agents
4. **The scrolling live ticker with player tickers like $LBJ and $KD — felt like Bloomberg for basketball and I was immediately intrigued** — noticed by 1/15 agents
5. **The big 'Claim $100 →' button — hard to miss, and '$100' is a number my brain just locks onto** — noticed by 1/15 agents

## 2. Top 5 ignored elements (the page tried to show, agents didn't engage)

1. **'↓Terms explained' section at the bottom** — ignored by 2/15 agents
2. **'💬Feedback' link** — ignored by 2/15 agents
3. **The 'Thesis' one-liner ('Being right early...')** — ignored by 1/15 agents
4. **The '💬Feedback' button** — ignored by 1/15 agents
5. **Badge unlock conditions — saw the badges, skimmed the unlock text** — ignored by 1/15 agents

## 3. Top 5 confusion points (vocabulary + unclear CTAs)

1. **'devnet SOL' — I know what devnet is but casual fans will not, needs one more word of explanation** — flagged by 1 agent(s)
2. **'oracle updates' in the Diamond Hands badge — what's an oracle here, how often does it update?** — flagged by 1 agent(s)
3. **'fair-value price (from stats)' — which stats exactly? PER? Points only? Box score? Matters for my strategy** — flagged by 1 agent(s)
4. **0.667 SOL · $100 — why show the SOL amount at all if it's fake? Slightly confusing pairing** — flagged by 1 agent(s)
5. **The ticker shows '0.0%' for everything — is the market not open yet or is this just a dead demo?** — flagged by 1 agent(s)

## 4. Aesthetic trust baseline (/invite vision assessments)

| Metric | Mean | Median |
|---|---|---|
| visual_professionalism | 6.9 / 10 | 7.0 |
| trust_signal_strength | 4.8 / 10 | 5.0 |
| would_show_friend | 6.5 / 10 | 7.0 |

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

Run `npx tsx scripts/qa/design-pass.ts --dir /Users/frankiewu/dev/fanshare/tech/analytics/sim-runs/2026-04-22` to produce the DESIGN_SYSTEM.md violations report from the captured screenshots.

## 9. Next step: cross-reference

Run `npx tsx scripts/qa/cross-reference.ts --dir /Users/frankiewu/dev/fanshare/tech/analytics/sim-runs/2026-04-22` to join events + journals + Tally submissions by session_id.
