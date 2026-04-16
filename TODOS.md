# FanShare — TODOs

---

## Pre-Sprint 1 (must resolve before writing Anchor program)

### [x] Define bonding curve parameters (base_price, slope)

**LOCKED — CEO review 2026-03-31**

```
base_price   = 1,000 lamports (0.000001 SOL, ~$0.00015)
slope        = 10 lamports per token sold
total_supply = 1,000,000 tokens per player
pricing      = uniform across all players (market differentiates)
```

Economics:
- First token: 0.000001 SOL ($0.00015) — anyone will try it
- Token 500k: ~0.005 SOL ($0.75) — meaningful position
- Full sellout treasury: ~5,000 SOL
- With 10 beta users × 0.5 SOL each: ~5 SOL per player, ~117k tokens sold (11.7% supply)

### [x] Create 15-player devnet roster config

**What:** A config file (`scripts/roster.ts` or `app/lib/players.ts`) listing all 15 devnet
players with their display name, emoji/avatar, and player_id string.

**Roster (locked — CEO review 2026-03-31):**
```
LeBron James, Stephen Curry, Luka Dončić, Nikola Jokić, Jayson Tatum
Shai Gilgeous-Alexander, Giannis Antetokounmpo, Joel Embiid, Kevin Durant, Jaylen Brown
Devin Booker, Anthony Davis, Victor Wembanyama, Cade Cunningham, Tyrese Haliburton
```

**Note:** Use abstract player IDs for devnet (e.g. `Player_LBJ`) until legal review clears use of
real names on mainnet. Display names can be descriptive without using licensed marks.

**Effort:** S | **Priority:** P1 | **Depends on:** Nothing

---

## Day 0 Setup (before scaffolding)

### [x] git init + .gitignore + initial commit — DONE

### [ ] Fund oracle devnet wallet

**What:** Airdrop test SOL to the oracle keypair on devnet so the cron can pay transaction
fees when writing price updates on-chain. ~0.000005 SOL per update, negligible, but wallet must have balance.

**How:** `solana airdrop 2 <oracle-pubkey> --url devnet`

### [ ] Sign up for Helius free RPC

**What:** Free tier RPC provider for frontend + oracle to talk to Solana devnet.
100k requests/day. Sufficient for 10-15 beta users. Track in expenses.md.

---

## Pre-Mainnet (not blocking devnet)

### [ ] Legal review — token issuance structure, player names, NBA data license

### [ ] Solana program security audit (~$20-50k, 4-6 week lead time)

### [ ] Upgrade oracle keypair management to Squads multisig

### [ ] Identify mainnet sports oracle (Switchboard custom job or Sportradar integration)

### [ ] Graduation mechanic — mainnet

**What:** When a player token's treasury hits a threshold (69 SOL on mainnet), emit a
`GraduationEvent` on-chain, celebrate in UI, migrate to Raydium CPMM pool.

**Why:** Web3 community building mechanic. Drives social virality ("Player #23 graduated!").
Core to pump.fun model. Intentionally skipped for devnet — not needed to validate core mechanics.

**Effort:** M (program change + frontend UI + Raydium SDK integration)

### [ ] Real-time oracle daemon — mainnet

**What:** Oracle ticks every ~5 minutes during live NBA games (vs per-game cron on devnet).
Stats update while users are watching → prices move in real-time → engagement flywheel.

**Why:** Per-game oracle is sufficient for devnet. Real-time is the mainnet engagement story.

**Effort:** M (always-on daemon, WebSocket NBA stats feed, retry logic)

### [ ] Stats-anchored initial price for mainnet token launches

**What:** When a new player token is initialized on mainnet, set `base_price` from their
composite stats score rather than a fixed default. More defensible — price is grounded in data.

**Formula:** `base_price = composite_score × 10,000 lamports`
**Why deferred:** Oracle must be live before initialization. Adds dependency for devnet.
For devnet, uniform pricing is sufficient.

### [ ] Frontend search and filter for 20+ player roster

**What:** As roster grows beyond 15-20 players, the market grid needs a search box and
position/team filters. The current grid works fine up to ~20 cards.

**Effort:** S | **Depends on:** Roster expansion

### [ ] Raydium graduation mechanic (v1.5 — spike Raydium CPMM pool creation via SDK)

---

## From CEO Review 2026-04-06 (tokenomics v2)

### [ ] Provision Vercel KV before merging price history feature

**What:** Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Vercel dashboard.
Smoke-test: `curl https://fanshare-1.vercel.app/api/price-history/Player_LD` → `{"data":[]}`.

**Effort:** S | **Priority:** P1 (blocks #6 price history chart)

### [x] Extract bonding curve math to shared TS module

**What:** `calculateBuyCost`, `calculateTokensForSol` (reverse binary search), and
`current_price` currently exist scattered across `fanshare-program.ts` and the trade page.
Move to `app/lib/bonding-math.ts`. Reuse in chart preview + trade page.

**Why:** Third copy (chart preview) would be added if not extracted first. DRY.
**Effort:** S | **Priority:** P1 (needed before interactive chart)

### [x] Fix double-click Buy bug — disable button during SIGNING + CONFIRMING

**What:** Trade widget Buy/Sell button must be disabled during both SIGNING and CONFIRMING
states. Current `disabled={isSending}` may not cover the wallet approval gap.
**Why:** Without this, a user can click Buy twice and send two transactions.
**Effort:** XS | **Priority:** P1 (security/correctness)

### [ ] Oracle base_price mutations — mainnet

**What:** After each game, oracle calls a new `update_base_price` Rust instruction that
mutates `bonding_curve.base_price` based on performance. Formula: `new_base = tier_base × (score / league_avg)`.
**Why:** The mainnet engagement story — prices tick with game events. Deferred from devnet
because it requires a new Rust instruction, rebuild, and holder fairness UX treatment.
**Effort:** L | **Priority:** P2 (mainnet only) | **Depends on:** security audit, Squads multisig

### [ ] Price history chart: 1-data-point edge case

**What:** recharts LineChart renders nothing with a single data point. When `data.length === 1`,
render a Scatter dot or show "Not enough data — check back after the next oracle update."
**Effort:** XS | **Priority:** P2

### [ ] Move DEVNET_PLAYERS to JSON file when roster exceeds 30 players

**What:** `app/lib/fanshare-program.ts` DEVNET_PLAYERS array with `priceFormula` fields
will become unwieldy at 30+ players. Move to `app/lib/players.json` or a DB.
**Effort:** S | **Priority:** P3 (future)

### [ ] KV RPUSH+LTRIM atomicity

**What:** In `scripts/oracle.ts`, RPUSH and LTRIM are two separate HTTP calls. If LTRIM fails
(rate limit, timeout), the list grows unbounded. Wrap using Upstash pipeline API to make
them atomic: one HTTP call, both commands, all-or-nothing.
**Why:** At devnet scale (15 players, 5-min cron) this is low risk. At mainnet scale (100+
players, continuous oracle) unbounded growth becomes a real issue.
**Effort:** XS | **Priority:** P2

### [ ] Devnet reset workflow — wipe bonding curves and start fresh

**What:** A repeatable runbook to reset all 15 bonding curves to their initial state
(tokens_sold=0, treasury_lamports=0) on devnet. Useful before demo sessions or when
curves have drifted from testing.

**Current state:** No `reset_curve` instruction exists in the Anchor program. The
`init` constraint on BondingCurveAccount prevents re-initialization if the account
already exists.

**Workflow (once built):**
1. Add an admin-only `reset_curve` instruction to the Anchor program:
   - Authority check: `require!(ctx.accounts.authority.key() == DEPLOY_AUTHORITY)`
   - Sets `tokens_sold = 0` and `treasury_lamports = 0`
   - Optionally transfers any remaining SOL in the treasury PDA back to authority
2. Build + deploy updated program: `anchor build && anchor deploy --url <HELIUS_URL>`
3. Run reset script: `npm run reset-players` (mirrors init-players.ts pattern,
   calls reset_curve for all 15 mints from player-mints.json)
4. Verify: check a player page and confirm price = base_price (~0.000001 SOL)

**Shortcut (no program change needed):** Close the bonding curve accounts via
`solana account close` if the program supports it, then re-run `npm run init-players`.
Currently init-players is resume-safe and skips already-initialized players — would
need to clear player-mints.json entries first.

**Why:** Demo sessions accumulate test trades that shift prices. A clean slate before
showing to investors or new testers makes the demo more controlled.

**Effort:** M (program change + script) | **Priority:** P2 (pre-demo tooling)
**Depends on:** Security audit sign-off before adding any new authority instructions on mainnet.

### [ ] Formula section: collapse on mobile

**What:** The bonding curve formula display on the trade page always-visible on mobile pushes
the trade widget down. Add a disclosure `<details>` or accordion: "How is price calculated?"
**Effort:** XS | **Priority:** P3

---

## From QA Pass 2026-04-16

### [x] Leaderboard negative P&L missing minus sign (ISSUE-001)
Fixed `699883c`. Formatter stripped sign via `Math.abs()` combined with empty-string sign for
negatives. Extracted to pure util `app/lib/leaderboard-format.ts` + 8-test regression suite.

### [x] Trade inputs accept negative values with no feedback (ISSUE-002)
Fixed `f6c418d`. Both buy SOL and sell token inputs now clamp at 0, show red border,
`aria-invalid`, and `role="alert"` error text when a negative is entered.

### [x] deserializeStatsOracle bump test broken
Fixed `297b2e9`. Test helper wasn't writing the `stats_source_date: i64` field that was added
to the account layout, so the bump byte sat past the end of the buffer.

### [ ] Price history cliff between pre-reinit and post-reinit eras (ISSUE-003)
**Severity:** Informational / self-healing
**What:** `/trade/Player_LD` chart shows a visible discontinuity between the old $0.002 era
(before the 4-pillar reinit on 2026-04-15) and the new $6.18 era. KV is player-ID-keyed so
old entries survived the reinit.
**Action:** None required. Ring buffer caps at 500 points; old entries age out as new oracle
ticks + trades land. Will self-smooth over ~48h.
**Effort:** 0 | **Priority:** P3 (monitor only)

### [x] Separate anchor integration tests from vitest run
Fixed by excluding `anchor/**` from vitest (`vitest.config.ts`) and tsconfig.
`npm run test` now runs only the 48 unit tests (3 files) and stays green. Anchor
integration tests still live at `anchor/tests/fanshare.test.ts` — run them manually
with a local validator: `npm run anchor-test` (starts validator, deploys, runs tests).
IDL typing errors in those files are pre-existing and only matter for the anchor-test
flow.
