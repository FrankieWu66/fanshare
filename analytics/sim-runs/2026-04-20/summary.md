# Game-Night Rehearsal — Summary (sim-2026-04-20-2026-04-20)

**Started:** 2026-04-20T23:33:54.841Z  
**Ended:** 2026-04-21T00:43:59.089Z  
**Seed:** 2026-04-20  
**Base URL:** https://fanshares.xyz  
**Bots registered:** 15 / 15

## System health

| Subsystem | Result |
|---|---|
| Registration | PASS — 15/15 |
| Buys succeeded | 29 |
| Sells succeeded | 10 |
| Failures (any) | 0 |
| Abandoned users | 15 (bot-05, bot-13, bot-08, bot-06, bot-11, bot-14, bot-03, bot-12, bot-04, bot-10, bot-02, bot-07, bot-09, bot-01, bot-15) |
| Tally submission | NOT SUBMITTED |

## PostHog 11-event verification

| Event | Observed |
|---|---|
| `invite_page_viewed` | YES |
| `invite_cta_clicked` | YES |
| `terms_expanded` | YES |
| `about_demo_clicked` | YES |
| `grant_claimed` | YES |
| `first_player_opened` | YES |
| `first_buy_attempted` | YES |
| `first_buy_succeeded` | YES |
| `first_sell_succeeded` | YES |
| `error_shown` | **MISSING** |
| `feedback_opened` | **MISSING** |

**MISSING EVENTS:** error_shown, feedback_opened — open a new observability handoff before Demo 0.5.

## Top 5 copy / clarity issues (from journal rationale)

_No confusion notes flagged._

## Top 3 mental-model errors (from halftime checkpoint)

_No critically-wrong mental models flagged by the model._

## Scope gaps — not covered by this sim

- Invite message receipt / first-click-from-SMS-or-DM moment
- Mobile viewport (bot runs desktop only)
- Slow network / offline mid-transaction
- Safari / iOS quirks (headless Chromium only)
- Screen reader / keyboard-only navigation
- Real 'is this a scam?' gut reaction
- Social dynamics — seeing peers trade, FOMO
- Real-money loss aversion (devnet money doesn't bite)

## Go/no-go for Demo 0.5

**NO-GO** — address blockers listed above, then rerun full game night.
