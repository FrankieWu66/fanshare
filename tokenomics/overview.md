# FanShare Tokenomics — Master Overview
*Devnet only. Mainnet decisions deferred.*
*Last updated: April 2026*

---

## Reporting Rule

**Eng briefs are chat-only, never filed.** When decisions are sent to engineering, only Demo 1 parameters are included. Demo 2 parameters are noted here for reference but never sent until Demo 1 results are reviewed and Demo 2 is confirmed.

---

## Demo Definitions

| | Demo 1 | Demo 2 |
|---|---|---|
| Users | 10–15 (friends, controlled) | 100–300 (public devnet beta) |
| Status | **Current focus — designing now** | Planned after Demo 1 results |
| Parameters | Finalized here before build | Noted here, revised after Demo 1 |

---

## What This Folder Is

Single source of truth for all tokenomics design decisions. Each topic gets its own file when settled. Nothing goes to engineering until it appears here marked **FINALIZED**.

---

## Status Board

| # | Topic | Demo 1 Status | Demo 2 Status | File |
|---|---|---|---|---|
| 1 | Base price formula (oracle) | ✅ FINALIZED | ⬜ REVISIT — career-stats base price | [base-price-formula.md](base-price-formula.md) |
| 2 | Price structure (curve shape) | ✅ FINALIZED | ✅ same | [price-structure.md](price-structure.md) |
| 3 | Token value proposition | ✅ FINALIZED | ✅ same | [token-value-prop.md](token-value-prop.md) |
| 4 | Total token supply per player | ✅ FINALIZED | ✅ FINALIZED | see below |
| 5 | Slope value (lamports/token) | ✅ FINALIZED | ✅ FINALIZED | see below |
| 6 | Protocol pre-seed size & strategy | ✅ NOT NEEDED | ✅ NOT NEEDED | see below |
| 7 | Demo user SOL grant | ✅ FINALIZED | ⬜ UNSETTLED | see below |
| 8 | Trading fee rate | ✅ FINALIZED | ✅ FINALIZED | see below |
| 9 | Fee split (who gets what) | ✅ FINALIZED | ✅ FINALIZED | see below |
| 10 | Exit treasury | ✅ FINALIZED | ✅ FINALIZED | see below |
| 11 | Inactive player mechanism | ⬜ DEFERRED TO DEMO 2 | ✅ FINALIZED (design) | see below |
| 11a | Season / off-season detection | ⬜ DEFERRED TO DEMO 2 | ✅ FINALIZED (design) | see below |
| 11b | Retirement state machine | ⬜ DEFERRED TO DEMO 2 | ✅ FINALIZED (design) | see below |
| 12 | Anti-manipulation controls | ✅ FINALIZED | ⬜ UNSETTLED | see below |
| 13 | Pump & dump protection | ✅ FINALIZED | ⬜ UNSETTLED | see below |
| 14 | Leaderboard system | ✅ FINALIZED | ✅ FINALIZED | see below |
| 15 | Utility & rewards | ✅ FINALIZED | ⬜ UNSETTLED | see below |
| 16 | Season / off-season handling | ✅ FINALIZED | ✅ FINALIZED | see below |
| 17 | Supply cap behavior (at max) | ✅ FINALIZED | ✅ FINALIZED | see below |
| 18 | Oracle update cadence | ✅ FINALIZED | ✅ FINALIZED | see below |
| 19 | Demo 1 telemetry + invite onboarding | ✅ FINALIZED | ⬜ revisit after Demo 1 | see below |

---

## Settled Decisions

**#4 — Total Token Supply Per Player**
- Demo 1: **5,000 tokens** — meaningful ownership feel (~0.5% per user grant), visible % distributed with 10–15 users
- Demo 2: **50,000 tokens** — handles 300 users without ceiling pressure, active market feel without cornering risk
- Rationale: supply cap is a UX/behavioral decision, not a price mechanic. Scarcity signal and ownership identity matter. Slope handles price sensitivity independently.

**#5 — Slope (tiered by base price)**
A single uniform slope cannot deliver consistent % spread impact across a base price range of $0.25–$7.82. At uniform 100k lamports, a $100 grant moves a $1 base-price player ~93% but Durant only ~3%. Slope must scale with base price so the behavioral target ("one $100 grant ≈ ~6% spread move") holds across the roster.

- Demo 1 — tiered slope, set at market init from base price:

| Base price range | Slope (lamports/token) | Example players | % move on full $100 grant |
|---|---|---|---|
| $5.00+ | **150,000** | Jokić, SGA, Giannis, Wemby, AD, Tatum, Luka, Haliburton | ~5–7% |
| $2.50 – $4.99 | **50,000** | Durant, Curry, LeBron, Cade, Booker, Trae, Harden, Brown | ~5–7% |
| $0.25 – $2.49 | **8,000** | Jalen Green, stat-padders, floor players | ~5–8% |

- Demo 2: Revisit — consider continuous formula `slope = k × base_price²` so every player behaves identically. Decision deferred until Demo 1 behavioral data is in.
- Rationale: Engineer (Phase 1) flagged that uniform 100k slope produces explosive price moves on cheap players and barely-visible moves on stars. Tiering keeps the "visible but non-explosive" behavioral intent consistent across all player markets. Slope is set once at market init from each player's base price, no on-chain logic change required.

**#6 — Protocol Pre-Seed**
- Demo 1: **Not needed**
- Demo 2: **Not needed**
- Rationale: Bonding curve is self-funding from trade one. Treasury builds endogenously from user buys. Fee on sells means treasury only ever grows. On-chain supply and treasury balance displayed live on UI for transparency.

**#7 — Demo User SOL Grant**
- Demo 1: **0.667 SOL = $100 at $150/SOL fixed rate**
- Demo 2: TBD after Demo 1 results
- Rationale: Consistent with all prior slope and spread calculations. At $100/user and Demo 1 slope, one full grant into one player moves spread ~6%.

**#8 — Trading Fee Rate**
- Demo 1: **1.5% per trade (buy and sell)**
- Demo 2: **1.5% per trade**
- Rationale: Low enough not to deter trades, high enough to feel real and teach correct user habits. Reference: pump.fun 1.25%, friend.tech 10% (killed platform), Uniswap 0.3%.

**#9 — Fee Split**
- Demo 1 & 2: **1.0% → protocol wallet | 0.5% → exit treasury**
- Rationale: Exit treasury ring-fenced for inactive player backstop only. No fee revenue distributed to users — avoids securities risk. Consistent split applied to devnet for realism and mainnet intent.

**#10 — Exit Treasury**
- Structure: **Global singleton PDA** — one shared pool across all player markets
- Funded by: 0.5% of every trade, all players, accumulated over time
- Purpose: covers shortfall when retired player's curve can't fully pay out all holders
- Rationale: global pool is more robust than per-player — popular player volume subsidizes protection for low-volume players

**#11 — Inactive Player Mechanism**
**Demo 1: DEFERRED.** Engineer (Phase 2 review) flagged that 14-day trigger / 2-season retirement / off-season NBA calendar logic cannot fire in a 1–2 day in-season demo with 15 users. Building ~40–60% of total effort for dead code paths is poor ROI. The existing manual `freeze_market` instruction stays in the codebase — if a demo user asks about injury/inactive handling, we flip a market manually to show the UI state.

**Demo 2: Design below is finalized, build when Demo 2 scope is confirmed.**

Two-tier system. Injury ≠ retirement.

| State | Trigger | Effect |
|---|---|---|
| Normal | Playing regularly during active season | Full trading, oracle updates live |
| Freeze | 14 consecutive days no games during active season | Both buys AND sells halted (stock market halt model — prevents asymmetric exit) |
| Unfreeze | Player plays any game | Automatic, full trading resumes immediately |
| Off-season | Official NBA off-season per NBA calendar | Oracle pauses, trading continues freely, UI shows "Off-Season — Stats resume [date]" |
| Retirement | Frozen for 2 consecutive full active seasons | Permanent market close, exit payout triggered from global exit treasury |

- Off-season dates: follow **official NBA calendar**, not fixed calendar dates
- Retirement payout: sell-only window opens, exit treasury covers any shortfall between curve value and holder cost basis

**#12 — Anti-Manipulation Controls**
- Demo 1: **No hard limits. Spread warning banner at >30% spread only** (informational, not a block)
- Demo 2: Revisit after Demo 1 behavioral data — determine if manipulation is actually occurring before adding friction
- Rationale: slope is the structural protection — large buyers pay progressively more per token. Hard per-wallet limits are easily bypassed with multiple wallets. Demo 1 users are known friends, real risk is zero.

**#13 — Pump & Dump Protection**
- Demo 1: **No additional mechanism needed.** Covered by four existing layers:
  1. Oracle spread always visible — high spread signals risk to analytical users, not opportunity
  2. Spread warning banner at >30% — explicit flag on crowded markets
  3. No instant profit on round-trip — buy then sell immediately = guaranteed fee loss (~3%)
  4. 1.5% fee on sells — repeated pump-dump cycles progressively more expensive
- Demo 2: Revisit with real behavioral data from Demo 1

**#14 — Leaderboard System**
- Demo 1 & 2: **Both already live on website** — Top Traders (total realized profit) + Sharp Calls (profit % × |spread at buy|)
- Engineering check: confirm `spread_at_buy` is captured on-chain in trade event at buy execution time — required for Sharp Calls scoring to be accurate

**#15 — Utility & Rewards**
- Demo 1: **Display badge system as UI concept only** — show Sharp badge tiers (Sharp: 5+ calls, Elite: 20+, Oracle: 50+) and early market access as visible goals, not yet earnable
- Demo 2: Make badges fully earnable, early market access functional — utility becomes real when 300 strangers need a reason to return
- Rationale: Demo 1 is mechanics testing with known friends, not retention. Utility is a retention tool. No engineering time needed on badges for Demo 1.

**#16 — Season / Off-Season Handling**
- Demo 1 & 2: Oracle pauses during official NBA off-season. Trading continues freely. Spread frozen at last active season value with label: "Spread as of [last game date]"
- UI: player cards display "Off-Season — Stats resume [next season start date]"
- Off-season dates: official NBA calendar, not fixed dates
- Rationale: honest and informative — users can still trade, they know oracle isn't updating

**#17 — Supply Cap Behavior**
- Demo 1 & 2: **Hard stop with clear UI message** — "This market is at full capacity. You can only sell."
- No dynamic cap raise — undermines scarcity signal and requires governance overhead
- Rationale: practically unreachable at current slope and price levels. Spread warning banner at 30% fires long before cap is approached. Edge case only.

**#18 — Oracle Update Cadence**
- Demo 1 & 2: **Rolling 5-game average, updated within 30 min of each game ending**
- Rationale: smooths single-game outliers (one 50-point game shouldn't spike the index), maintains per-game engagement rhythm, harder to front-run than daily batch or direct per-game stats
- Front-running mitigation: 5-game rolling average dilutes the predictable impact of any one game

---

## Topic Descriptions — What Each Decision Requires

**4. Total token supply per player**
How many tokens exist per player market? Currently 1,000,000 — but this was never justified. Affects: how much SOL it takes to move price meaningfully, how concentrated any single holder can get, and what the theoretical market cap ceiling is.

**5. Slope value**
The `slope` in `price = base + slope × n`. Determines how much price moves per token bought. Too flat = spread never shows. Too steep = one person dominates. Currently broken at 1 lamport. Must be settled before pre-seed or demo.

**6. Protocol pre-seed size & strategy**
Protocol buys into each player curve at launch to fund treasury (enables first sell). Questions: how much per player? flat or tiered? which players get heavier seed? Do we want artificial spread at launch or zero spread?

**7. Demo user SOL grant**
How much devnet SOL does each demo user receive? Currently 0.667 SOL ($100). Affects how many trades each user can make and whether individual trades visibly move spread. Depends on slope being settled first.

**8. Trading fee rate**
% charged on every buy and sell. Currently 1.5% in eng-brief but not re-confirmed. Reference: pump.fun = 1.25%, friend.tech = 10% (killed the platform).

**9. Fee split**
Where do collected fees go? Options: 100% protocol, split protocol/exit-treasury, split protocol/rewards pool. Affects revenue model and what funds the exit backstop.

**10. Exit treasury**
Do we need a ring-fenced fund to backstop sellers when a player retires? If yes: global singleton or per-player? Funded by % of fees or separately? For devnet (fake SOL), this is low stakes but the structure should match what mainnet will look like.

**11. Inactive player mechanism**
What triggers "player is inactive"? What happens to their market? Sequence of events, timeline for sell window, how exit funds are distributed. Relevant even on devnet to test the mechanic.

**12. Anti-manipulation controls**
Do we put any guardrails on single-wallet buy size? Spread warning thresholds? Rate limits per wallet per player per day? Each adds friction; none are foolproof.

**13. Pump & dump protection**
Structural question: does the bonding curve design itself prevent P&D, or do we need additional mechanics? (Answer: bonding curve does NOT prevent P&D — see tokenomics-analysis for whale simulation.) What mitigations do we want?

**14. Leaderboard system**
Two proposed leaderboards: Top Traders (total realized profit) and Sharp Calls (skill-normalized: profit × spread-at-buy). Both on-chain. Questions: do we build both, one, or neither for devnet? What data do we need to capture now for future leaderboards?

**15. Utility & rewards**
Non-financial reasons to hold. Proposed: Sharp badge system (5+ qualifying calls), early market access for top leaderboard. Questions: is badge system right for devnet beta? What utility creates the most re-engagement?

**16. Season / off-season handling**
NBA season ends in June. What happens to player tokens in the off-season when stats don't update? Does oracle freeze? Does market continue trading? This affects product experience and user expectations.

**17. Supply cap behavior**
When a player hits max supply (1M tokens), what happens? Currently: buy button silently fails. Needs a defined behavior — either a cap-and-stop mechanic, or reduce max supply so this is practically unreachable.

**18. Oracle update cadence**
How often does the oracle update index prices? Options: after each game (~3-4x/week), daily batch, rolling 5-game average. Affects: how fresh the spread signal is, manipulation window between updates, operational cost.

---

## How We Work Through This

Settle in dependency order:
1. Supply + Slope (foundational — everything else depends on these two)
2. Pre-seed + User grant (depends on slope)
3. Fee rate + Fee split (independent)
4. Exit treasury + Inactive mechanism (depends on fee split)
5. Anti-manipulation + P&D protection (depends on slope + supply)
6. Leaderboard + Utility (product layer, independent)
7. Season handling + Supply cap behavior (edge cases)
8. Oracle cadence (operational, semi-independent)

---

*When a topic is settled, create a file in this folder, mark it FINALIZED here, and update the status board.*

---

**#19 — Demo 1 Telemetry + Invite Onboarding**
Demo 1's purpose is learning, not just mechanics testing. Without measurement, Demo 2 scope decisions will be made on gut feel. Engineer (Phase 1 review subagent) flagged this gap; confirmed as critical.

**Telemetry — engineering scope (~30 min):**
- Log every trade event with: `timestamp`, `user_wallet`, `player`, `side` (buy/sell), `tokens`, `sol_amount`, `spread_at_execution`, `market_price_after`, `oracle_price_at_execution`
- Export mechanism: CSV dump from devnet program logs, or simple events table — whatever is cheapest
- Derived metrics ops will compute post-demo: funnel (wallet connect → grant received → first buy → second buy), time-to-first-trade, spread distribution across trades, average hold duration, realized P&L per user, most-traded players

**Invite onboarding page — ops writes copy, engineering ships the page:**
- 60-second "what is this" pitch landing page at demo entry URL
- Wallet connect → receive $100 grant → first trade walkthrough
- Copy forthcoming from ops before engineering build starts

Demo 2: revisit scope once Demo 1 data reveals what actually matters to measure.

---

## Demo 2 Open Questions (Parked)

**Base price — career-stats variant (topic #1 revisit)**
Current base price uses current-season stats via the 4-pillar formula. Risk: a star having an off year (injury, role change, team fit) launches at a base price that feels disrespectful and misrepresents durable ability. Example: Tatum at $3.50 post-injury vs his "true" $5.51.

Possible Demo 2 direction: weighted blend of career stats + current-season stats (e.g., 60% career / 40% current) so the base price reflects established ability while still responding to recent trend. Needs simulation before committing — career-weighted formula should still penalize stat-padders and still pass the Trae vs Haliburton validation test.

Decision deferred until Demo 1 behavior data is in. For Demo 1, current-season base price is the right call — low base on a known star is the most interesting early trade on the platform.
