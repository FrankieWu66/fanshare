# Demo 0.5 — Onboarding Mental Model Sim (LLM-Driven AI Agents)

**Status:** ACTIVE (drafted 2026-04-22, restructured same day from earlier "Demo 0.3" draft after scope clarification).
**Audience:** 10-15 LLM-driven AI agents via Anthropic API, 5 personas.
**Purpose:** Pressure-test `/invite` copy + onboarding flow with reasoning agents that can articulate **what they thought** when they read the page. Generate top-3 mental-model errors and top-3 friction points so we can polish /invite + onboarding **before Demo 1** (real humans — Frankie's already-signed-up friends — see the product).

**Why this exists, and what gets deleted:**
- Old "Demo 0.3" (deterministic walkthrough, no LLM) → DELETED. Without LLM, agents can't articulate interpretation, so the mental-model goal becomes impossible. Running 15 deterministic agents adds load-test data, not UX insight.
- Old "Demo 0.5" (full trading AI sim) → DELETED. Trading mechanics are in flux (Jerry Zhu modifying index per NBA schedule). Trading verification becomes a Tech-internal QA task once Jerry signals ready, not a numbered "Demo" event.
- New Demo 0.5 = onboarding-only AI sim with LLM. The cheapest qualitative-signal layer before burning friend-goodwill on Demo 1.

---

## Environment target

**Run against a Vercel preview deploy, NOT prod.** Push a dedicated branch `demo-0.5-sim-run-<date>` before the sim. Vercel auto-creates a preview URL. Agents point at the preview URL, not `fanshares.xyz`. Clean telemetry separation, reproducible, doesn't pollute any real-user baseline we may start collecting.

Set the Tally form hidden field `session_source=preview` to filter preview-run submissions from real submissions (once real users exist). PostHog can filter by URL host to separate preview from prod events.

---

## Scope boundary

**IN scope:**
- `/invite` landing page comprehension (does the agent understand what FanShare is, why they're getting $100, what they're supposed to do?)
- Demo wallet auto-registration flow (`/api/demo/register`)
- First impression of `/` homepage (cards visible, but DO NOT trade — Jerry's mechanics in flux)
- Tally feedback capture: agent submits qualitative reflection through the form, hidden fields populate (regression of commit `df3e8ac`)
- 6 onboarding-side PostHog events: `invite_page_viewed`, `terms_expanded`, `about_demo_clicked`, `invite_cta_clicked`, `grant_claimed`, `feedback_opened`
- Per-agent journal: `what_they_read` / `their_interpretation` / `their_decision` / `their_rationale` / `confidence (0-1)` / `confusion_notes[]` / `first_impression_elements[]` (top 3 things that caught the agent's eye when the page loaded) / `ignored_elements[]` (things the page tried to show them that they didn't engage with) / `emotional_arc_phase` (visceral / behavioral / reflective per Don Norman's levels)
- Mid-flow mental-model checkpoint: agent answers in own words "What is FanShare? What did I just claim? What am I supposed to do next? What caught my eye first on /invite? What did I ignore?"
- Aesthetic trust score: agent gives 0-10 ratings on `visual_professionalism`, `trust_signal_strength`, `would_show_friend` after initial landing, before reading detailed copy. First-impression pure-visual signal, uncontaminated by comprehension.
- Viewport context: every journal entry includes `viewport: "desktop" | "mobile"` so mobile-specific friction is separable in analysis.

**OUT of scope (separate Tech-internal verification once Jerry stabilizes):**
- `/trade/[playerId]` interaction
- Buy / sell execution
- Bonding curve comprehension
- 5 trade-side `trackOnce` events (`first_player_opened`, `first_buy_attempted`, `first_buy_succeeded`, `first_sell_succeeded`, `error_shown`)

---

## Audience: 10-15 LLM-driven agents, 5 personas + desktop/mobile split

Reuses the [scripts/qa/game-night.ts](scripts/qa/game-night.ts) harness (proved out 2026-04-20 under no-LLM fallback). For Demo 0.5: provision `ANTHROPIC_API_KEY`, rewrite persona prompts to focus on /invite + onboarding (not trading), strip trade-action steps from the action sequence.

| Persona | N | Profile | What we measure from them |
|---|---|---|---|
| Crypto-native + NBA fan | 2-3 | "Knows wallets, knows tokens, knows LeBron's stat line" | Baseline. Should be effortless. If THIS persona stalls, copy is broken. |
| NBA fan, no crypto | 3-4 | "Loves basketball. Has heard of crypto, has never owned any." | The target user. Friction here = real product gap. Highest-signal persona. |
| Crypto-curious, casual NBA | 2-3 | "Owns SOL. Watches the playoffs. Doesn't know full rosters." | Tests if NBA-knowledge requirement deters. |
| Total newcomer | 2-3 | "Neither crypto nor active sports following. Smart, just unfamiliar." | Stress-tests every word of copy. |
| Skeptic | 1-2 | "Default reaction = is this a scam? Looks for red flags." | Tests trust signals (devnet badge, 'no real money', GitHub link, etc.). |

Each agent emits per-action journal as 2026-04-20 sim intended (but failed because no LLM key). Mid-flow mental-model checkpoint gives the highest-signal artifact: verbatim agent quote about what they think FanShare is.

**Design-trust probes (every persona prompt includes these):**
- "Does this page feel professional, or thrown-together?"
- "Would you screenshot this to show a friend as something cool, or would you be embarrassed to?"
- "Does it look safe enough to connect any real money to later?"
- "Rate aesthetic quality 0-10 before reading any copy — purely first-impression visual."

These sit alongside the vocabulary-focused persona probes. They probe whether the page feels designed, not just what it says.

**Desktop / mobile split:** 10-12 agents run desktop viewport (1280×800). 3-5 agents run **mobile viewport (375×812, Playwright's iPhone 13 preset)** with touch emulation. Friends will check on phones — desktop-only signal biases toward a real condition that won't hold in Demo 1. Mobile agents get their own report section ("Mobile friction findings") since mobile design problems are different from desktop design problems, not a subset.

**Per-step screenshot capture:** every agent action (landing, scroll, click, form fill, submit) triggers a screenshot saved to `analytics/sim-runs/2026-04-22/screenshots/agent-NN/step-MM.png`. Storage ~500MB per 15-agent run. Required for the post-run designer pass to retrace visual journey and correlate with journal entries.

**LLM choice:** Sonnet 4.6 default for reasoning fidelity. Haiku 4.5 acceptable for cost-sensitive runs (faster + cheaper, slightly less nuanced reasoning). Specify in harness env: `MODEL=claude-sonnet-4-6` or `MODEL=claude-haiku-4-5-20251001`.

**Prompt caching (HARD REQUIREMENT):** shared persona prompt stub + site description + task scaffold must be wrapped in `cache_control: { type: "ephemeral" }` per Anthropic SDK. All 15 agents share the same prefix, so caching cuts cost ~5-10× (paid once per 5-min window, read-cache at 10% of input price thereafter). Without caching the run costs ~$10; with caching ~$2-3. Claude API best practice. See [Anthropic prompt caching docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching).

**Rate-limit stagger (HARD REQUIREMENT):** agent starts staggered by 1-2 seconds. 15 concurrent agents × ~15 LLM calls each could exceed Anthropic Tier 1 RPM (50/min for Sonnet). Staggered starts spread peak call density across ~30 seconds, avoiding burst-limit throttling.

**Cost estimate:** ~$2-3 for one full run with prompt caching (was $5-15 without). Trivial vs the value of catching a copy gap before Demo 1 burns friend-goodwill.

---

## Pre-flight checklist (T-15 min before run)

Tech runs each item, captures evidence inline. ALL must be ✓ before harness fires.

- [ ] `/invite` HTTP 200 + 0 console errors — `curl -sf` + `$B goto + console --errors`
- [ ] Deploy wallet balance ≥ 1 SOL (covers ~20 agent registrations at 0.05 SOL each) — `solana balance CsGh5T7... --url <HELIUS>`
- [ ] `/api/demo/register` returns valid wallet for a single test call — `curl -sX POST` with test displayName
- [ ] PostHog SDK loaded — network shows `us-assets.i.posthog.com/array/.../config.js`
- [ ] Tally embed.js loads, button uses programmatic `Tally.openPopup` (commit `df3e8ac` shipped this) — `$B js "typeof window.Tally?.openPopup"` returns `function`
- [ ] All 6 in-scope PostHog events fire from a single fresh-incognito manual test pass — walk the funnel once before the agent run, confirm in PostHog Activity
- [ ] Treasury all $0.00 across all 15 player cards (clean baseline) — `$B snapshot | grep Treasury`
- [ ] Tally form `lblzNW` accepting submissions with hidden fields populated (test submit, confirm in Tally dashboard)
- [ ] **`ANTHROPIC_API_KEY` set in harness env (`.env.local`)** — agents cannot reason without this. If skipped, agents fall back to deterministic heuristic and the entire mental-model goal is silently bypassed (this is exactly what killed the 2026-04-20 sim).
- [ ] `MODEL` env var set (`claude-sonnet-4-6` or `claude-haiku-4-5-20251001`) — confirm cost ceiling before run
- [ ] `npm run reclaim-demo` ready (terminal pre-loaded with the command for fast post-run cleanup)
- [ ] Kill-switch documented at top of harness script: "Ctrl+C halts, then run `npm run reclaim-demo` to reset state"
- [ ] Per-agent timeout (~2 min) + total run timeout (~15 min) configured via env vars
- [ ] Agent start-stagger interval (~1-2s) set in harness config
- [ ] Screenshot-per-step hook enabled in harness; output dir `analytics/sim-runs/YYYY-MM-DD/screenshots/agent-NN/` pre-created with 500MB headroom
- [ ] Mobile viewport profile added to harness config (Playwright `devices['iPhone 13']` or equivalent, 3-5 agents get this)
- [ ] Attention-tracking journal fields (`first_impression_elements`, `ignored_elements`, `emotional_arc_phase`, aesthetic trust score triplet) wired into harness LLM prompt schema

---

## Live monitoring (during the run)

Tech watches, doesn't intervene.

1. **PostHog Activity feed** (`https://us.posthog.com/project/389132/activity/explore`) — events stream as agents progress.
2. **Vercel function logs** (`vercel logs --prod --follow`) — watch for 5xx on `/api/demo/register` or any other route.
3. **Helius webhook** — `vercel logs` for `/api/webhook/helius` — should be quiet (no trades).
4. **Agent journal stdout** — harness writes per-agent journal lines as they flow, including mid-flow mental-model checkpoint answers.
5. **Anthropic API usage** — monitor for unexpected spend if prompts loop or rate-limit on Anthropic side.

**Do NOT push hot-fixes during the run.** Note the issue, let the agent abandon if needed. The signal IS the failure.

---

## Expected per-agent funnel (6 events + journal)

```
invite_page_viewed → (terms_expanded?) → (about_demo_clicked?) → invite_cta_clicked
                                                                        ↓
                                                                  grant_claimed
                                                                        ↓
                                                                  feedback_opened
                                                                        ↓
                                              Tally submission (4 hidden fields populated, real interpretation in free-text fields)
```

**Smoothness score per agent:** 6/6 events = perfect funnel; ≤4/6 = friction at that step → mine journal for cause.
**Quality score per agent:** mid-flow mental-model checkpoint correct = +1; agent's confidence ≥0.7 across all steps = +1; confusion_notes empty = +1. Max 3.

---

## Post-run (within 1 hour of completion)

1. **Reset state:** `npm run reclaim-demo` — recovers SOL from agent demo wallets back to deploy wallet. Confirm treasuries return to $0.
2. **Pull data sources:**
   - PostHog event export → `analytics/sim-runs/2026-04-22/events.csv`
   - Per-agent journal JSONs → `analytics/sim-runs/2026-04-22/journals/agent-NN.json` (now WITH `their_interpretation` etc. populated, unlike 2026-04-20)
   - Tally form responses → export from Tally dashboard with hidden field columns
   - Vercel function logs for the run window → grep for 5xx, save
3. **Cross-reference via scripted join:** run `scripts/qa/cross-reference.ts` (new, ~30 LOC) which reads `events.csv` + `journals/*.json` + Tally CSV export and joins by `session_id` → unified table `analytics/sim-runs/2026-04-22/unified.csv`. Eliminates manual matching error. If passthrough is broken anywhere (missing session_id on Tally, missing distinct_id on PostHog side, agent_id mismatch), the script should fail loudly not silently.
4. **Generate report** at `analytics/sim-runs/2026-04-22/summary.md` — **design-actionable sections first, metrics last:**

   **Section 1 — Concrete /invite copy edits to ship before Demo 1** (specific diff suggestions: "line X says 'spread' — replace with 'gap between fair price and what people pay'"). Lead with the actionable output; designer sees this first.
   **Section 2 — Top 3 mental-model errors** (verbatim agent quotes — what did agents wrongly think FanShare is, what did they misunderstand about the demo wallet, what did they think "fair value" means)
   **Section 3 — Top 3 friction points** (where agents stalled, expressed confusion, or had to re-read; with screen + copy reference + screenshot path)
   **Section 4 — Attention & first-impression findings** (aggregate `first_impression_elements[]` across agents — what caught eyes most often vs what the page WANTED to lead with; aggregate `ignored_elements[]` — things designed to grab attention that failed)
   **Section 5 — Mobile friction findings** (separate section for the mobile-viewport cohort; mobile design problems are different from desktop, not a subset — touch targets, scroll depth, font legibility, CTA visibility above fold)
   **Section 6 — Aesthetic trust baseline** (distribution of `visual_professionalism` / `trust_signal_strength` / `would_show_friend` ratings across personas; use as baseline for Demo 1 human comparison)
   **Section 7 — Top 3 Tally feedback themes** (qualitative signal from form responses)
   **Section 8 — Cross-reference findings** (do confused agents in journals match low-rated agents in Tally? low aesthetic trust correlate with fast abandonment?)
   **Section 9 — Funnel pass rate per persona + viewport** (smoothness + quality score table)
   **Section 10 — Event firing matrix + performance metrics** (Vercel 5xx count, Anthropic API cost actual vs estimate, run duration)

5. **Designer pass (SEPARATE from agent run):** hand `analytics/sim-runs/2026-04-22/screenshots/**/*.png` + `journals/**/*.json` + `DESIGN_SYSTEM.md` to a designer (human or a dedicated "design-critic" LLM pass — different context from the agent personas). Produce a **design-system-violations report** at `analytics/sim-runs/2026-04-22/design-violations.md` that flags:
   - Typography: does `/invite` as-rendered match DESIGN_SYSTEM.md font specs?
   - Color: are accent colors within spec? contrast ratios ≥4.5:1?
   - Spacing: do spacing tokens match the scale?
   - Component consistency: do buttons/cards/headers align with the system?
   - Visual hierarchy: does the rendered page's attention pattern (per `first_impression_elements[]` aggregated) match design intent?

   Agents stay in-persona (user-feel) so this pass is decoupled — spec violations surface from an independent check, not from biasing the personas.

---

## Success criteria (binary pass/fail)

**Functional:**
- ≥80% of agents fire `grant_claimed` → registration is reliable
- ≥50% of agents fire `feedback_opened` → Tally CTA is visible/discoverable
- 100% of Tally submissions have all 4 hidden fields populated → wiring confirmed (regression of `df3e8ac`)
- 0 Vercel 5xx errors in the run window → stack survives onboarding load
- Desktop + mobile cohorts both represented (≥3 mobile agents complete funnel) → viewport diversity exercised
- All 5 personas represented → persona diversity exercised

**Design signal (the actual point of Demo 0.5):**
- **Top 3 mental-model errors** identified with verbatim agent quotes → qualitative signal the no-LLM 2026-04-20 sim missed
- **Top 3 first-impression findings** from aggregated `first_impression_elements[]` → what actually grabs attention vs what the page wants to
- **Top 3 mobile-specific friction points** from the mobile cohort → where phone users stumble that desktop users don't
- **Aesthetic trust baseline** (median + P25/P75 of `visual_professionalism`, `trust_signal_strength`, `would_show_friend` ratings) → comparable baseline for Demo 1 humans
- **At least one concrete /invite copy edit** that can ship before Demo 1
- **Design-system-violations report** (separate designer pass) completed → spec violations documented independent of persona feedback
- Screenshots captured for every agent step → designer can retrace visual journey without re-running the sim

---

## Post-mortem template (fill after report)

```markdown
## Demo 0.5 post-mortem (YYYY-MM-DD)

### What worked (functional + qualitative)
-

### What broke (technical)
-

### What surprised (mental-model errors we didn't predict)
-

### Concrete /invite copy edits shipping before Demo 1
- Line N: "<old>" → "<new>" — reason: <agent quote from journal>

### Implications for Demo 1 (real humans)
- Friends will see polished copy. Things still expected to surface in Demo 1 that Demo 0.5 won't catch:
  - Real emotional "is this a scam?" reaction (LLM agents are too rational)
  - Mobile viewport quirks (sim is desktop only)
  - Social dynamics (FOMO from seeing peers trade)
  - Real-money loss aversion (devnet doesn't bite)
```

---

## Pre-implementation test requirements (HARD REQUIREMENT before first full 15-agent run)

Before the real Demo 0.5 run, verify the harness rewrite works:

1. **Smoke test (1 agent):** run harness with a single LLM-driven agent against preview URL. Verify the journal populates with real qualitative fields (`their_interpretation`, `their_rationale`, `confusion_notes`) — NOT the `"(fallback: no LLM key set)"` string from 2026-04-20. If any journal row contains that fallback string, the LLM integration is broken.
2. **Regression test — CRITICAL:** if `ANTHROPIC_API_KEY` is missing or invalid, the harness MUST throw a clear error and exit, NOT silently fall back to deterministic heuristic. Retest: set `unset ANTHROPIC_API_KEY && npm run qa:game-night` and verify it bails with a clear message (not a run that looks successful but has empty journal fields).
3. **Integration test (3-agent dry run):** run 3 agents with 1-2s stagger, confirm (a) staggered start timing, (b) no rate-limit 429s from Anthropic, (c) journal + events for all 3 agents populate correctly, (d) cross-reference script joins them into a unified table.
4. **Per-persona prompt test:** one agent per persona, verify each produces distinct reasoning style in the `their_interpretation` field (e.g., skeptic agent flags trust signals, newcomer flags jargon).
5. **Schema validation (optional if harness already validates):** Zod or equivalent wraps each LLM JSON-output call, malformed outputs get logged + skipped, not silently corrupted.

All 5 should pass before the 15-agent run fires.

---

## Open dependencies / TBDs

1. **Date/time of the run** — Frankie picks. Pre-flight ≤30 min before.
2. **`ANTHROPIC_API_KEY` provisioning** — needed in `scripts/qa/game-night.ts` env (`.env.local`). Regression-tested to fail loud if missing (see pre-impl test #2).
3. **`MODEL` choice** — Sonnet (better reasoning, higher cost, $2-3 with caching) vs Haiku (faster, cheaper ~$0.50-1, slightly less nuanced). Recommend Sonnet for the first run since the whole point is qualitative depth; switch to Haiku for subsequent iteration runs if needed.
4. **Persona prompt rewrite** — current 2026-04-20 prompts focus on trading rationale. Need ~30-60 min to rewrite 5 persona prompts targeting onboarding mental-model + invite-page comprehension, and trim the action sequence to remove trade steps.
5. **Cross-reference script** — new file `scripts/qa/cross-reference.ts` (~30 LOC) to join PostHog + journal + Tally exports. ~15 min to write.
6. **Harness implementation of prompt caching** — add `cache_control: { type: "ephemeral" }` to the shared prefix in LLM call. ~20 min tweak. See Anthropic SDK docs.
7. **Vercel preview deploy setup** — branch + push. ~5 min.

---

## NOT in scope (explicitly deferred)

| Item | Rationale |
|---|---|
| Trading-flow verification | Separate Tech-internal QA task once Jerry stabilizes index. Tracked in TODO.md as `[trading-functional-verification]`. |
| Mobile viewport testing | Sim runs desktop headless only. Real humans in Demo 1 cover mobile. |
| Slow-network / offline mid-flow | Out of scope for mental-model goal. Future dedicated resilience test. |
| Safari / iOS quirks | Playwright runs Chromium. Demo 1 humans will flag Safari issues naturally. |
| Accessibility audit | Separate `/plan-design-review` or a11y-focused run. Not a mental-model concern. |
| Real-human emotional reaction ("is this a scam?") | LLM agents can't reliably simulate emotional response; this is what Demo 1 is for. |
| Social dynamics / FOMO | Sim runs agents independently, not as a group. Demo 1 friend group captures this. |
| Devnet-wallet loss aversion | Devnet money doesn't bite. No sim can capture real-money loss aversion — Demo 1 has the same limitation for devnet, but humans still have stronger signal than LLMs. |
| Oracle price update concurrency (mid-flow) | No trading → no oracle interaction. Relevant only for trading-functional-verification task. |
| Distribution / packaging | This is an internal ops script, not a shipped artifact. |

---

## What already exists (reused, not rebuilt)

| Asset | Path | Change needed for Demo 0.5 |
|---|---|---|
| Agent harness | [scripts/qa/game-night.ts](scripts/qa/game-night.ts) | Rewrite 5 persona prompts, strip trade-action steps, add prompt caching, add start-stagger, add kill-switch docs |
| Deliverables generator | [scripts/qa/bot-deliverables.ts](scripts/qa/bot-deliverables.ts) | None — output format compatible |
| Demo wallet auto-register | [app/api/demo/register/route.ts](app/api/demo/register/route.ts) | None |
| Tally hidden field wiring | [app/components/tally-button.tsx](app/components/tally-button.tsx) | None (shipped `df3e8ac` yesterday) |
| PostHog event wiring (all 6 in-scope events) | [app/lib/analytics/track.ts](app/lib/analytics/track.ts) + site | None (all verified firing per 2026-04-20 events.csv) |
| State reset | `npm run reclaim-demo` | None (verified today, recovered 15.91 SOL) |
| Browser-side reset | `?reset=1` query flag | None (shipped commit `9458bf0`) |
| Telemetry contract reference | [analytics/sim-runs/2026-04-20/](analytics/sim-runs/2026-04-20/) | Reference only — 2026-04-22 run produces same shape in new directory |

New assets to build: `scripts/qa/cross-reference.ts` (~30 LOC).

---

## Failure modes (from architecture + test reviews)

| # | Failure | Test coverage? | Error handling? | User-visible? |
|---|---|---|---|---|
| F1 | `ANTHROPIC_API_KEY` missing → silent fallback to heuristic (the 2026-04-20 bug) | Pre-impl regression test #2 MUST enforce loud-fail | Yes, hard-fail on startup | N/A (ops error, sim fails to start) |
| F2 | Agent crashes mid-flow (LLM timeout, Playwright disconnect) | Pre-impl test #3 covers 3-agent dry run; per-agent timeout catches this | Timeout kills agent, partial journal saved, run continues | Partial journal flagged in report |
| F3 | Anthropic rate limit (429) burst | Start-stagger mitigates; no explicit retry in plan | Agent retries with exponential backoff (harness-side, add if missing) | Sim slower, not failed |
| F4 | Tally form submission returns error | Pre-flight test submit confirms; sim catches via journal | Agent logs error, continues | Missing Tally row in report (flagged by cross-reference script) |
| F5 | `/api/demo/register` 5xx from Vercel concurrency | Unlikely under 15 concurrent; staggered starts help | Agent logs + skips to next step | Missing `grant_claimed` for that agent |
| F6 | LLM returns malformed JSON for journal | Schema validation (2C) catches if harness adds it; otherwise silent corruption | Log + mark agent partial | Missing qualitative fields for that agent |

**Critical gap:** F1 (silent fallback) must have a regression test per Section 3. Without it, a future dev could accidentally re-introduce the 2026-04-20 bug. Documented in Pre-impl test #2.

---

## Reusable assets

- Harness: [scripts/qa/game-night.ts](scripts/qa/game-night.ts) — agent runner; needs persona prompt rewrite + trade-action removal
- Deliverables: [scripts/qa/bot-deliverables.ts](scripts/qa/bot-deliverables.ts) — summary report generator
- Reset: `npm run reclaim-demo` — sells tokens, recovers SOL (verified 2026-04-22, recovered 15.91 SOL from 2026-04-20 sim leftovers)
- Browser-side reset: `?reset=1` query flag (clears localStorage `fanshare_demo` + PostHog distinct_id)
- Telemetry contract reference: [analytics/sim-runs/2026-04-20/](analytics/sim-runs/2026-04-20/) — same shape, but Demo 0.5 will have ~0 trade rows (no trading) and journals WILL have populated qualitative fields (vs 2026-04-20's empty fallback)

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 3 architecture findings (1 preview-deploy accepted, 2 obvious-fix folded in), 3 code-quality findings (caching + cross-ref script + schema validation all folded in), 5 test gaps + 1 critical regression (all folded into pre-impl test requirements), 0 performance issues |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR (PLAN) | Rated 6/10 → 9/10 on design-signal completeness. 7 passes, 3 decisions resolved (screenshots per step, mobile viewport variant, separate designer pass vs inline spec injection). Added: attention-tracking journal fields, design-trust persona probes, aesthetic trust score triplet, mobile friction report section, design-system-violations post-run pass. Gaps closed: visual/attention signal, mobile bias, spec alignment. |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**CROSS-MODEL:** ENG + DESIGN both CLEAR — plan covers functional correctness AND design-signal quality. No tension points between reviews.
**UNRESOLVED:** 0 across both reviews.
**VERDICT:** ENG + DESIGN CLEARED — Demo 0.5 plan ready to implement. Skip CEO (scope tight, operational) and DX (no developer-facing API).
