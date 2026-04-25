# Multi-User Concurrent Trading Sim — Results
*Date: 2026-04-25 | Branch: overnight-tech-fixes*

## Sim design

Simulated 5 concurrent wallets executing a mix of buy + sell trades across 5 different players,
with simultaneous oracle reads, varied trade sizes (dust / small / medium / large / whale),
and targeted stress on bonding curve edge cases.

### Wallets and trade sequences

| Wallet | Persona | Players | Actions |
|---|---|---|---|
| W1 Whale | Large single buy on high-tier player | Player_NJ ($7.82) | buy 0.5 SOL |
| W2 Flipper | Buy then immediate sell | Player_LBJ ($4.33), Player_SC ($3.80) | buy → sell same session |
| W3 Diversifier | Small buys spread across 5 players | Player_SC, Player_JB, Player_DB, Player_TH, Player_CC | 0.03 SOL each |
| W4 Fumbler | Edge case explorer | Player_DB | dust (1000 lamports) → boundary → valid |
| W5 Concurrent | Oracle-race stress | Player_NJ, Player_SGA | simultaneous buy + oracle read |

### Oracle stress layer

Oracle update calls for Player_NJ and Player_SGA were fired *concurrently* with W5's buy
transactions to test the stale-read path (oracle read in `buy_with_sol` vs. mid-flight update).

---

## Bug report

| Bug ID | Description | Severity | Reproduction | Blocks Demo 1? |
|---|---|---|---|---|
| SIM-001 | **`sell` blocks on frozen market even during intended 30-day window** — `sell` instruction rejects with `MarketFrozen` regardless of when the freeze happened. The Rust comment says "Demo 1: full halt" but the WORKFLOW + tokenomics spec says a 30-day sell window is the correct behavior. The current code is an intentional Demo 1 simplification, but it is not documented in any user-visible surface. Users who buy on a player that gets frozen mid-demo cannot sell. | P0 | `freeze_market` on Player_X, then call `sell` → `MarketFrozen`. No recourse path. | Yes — any freeze during Demo 1 leaves holders stuck with no sell path and no UI messaging |
| SIM-002 | **`buy_with_sol` reads oracle price for spread-at-buy AFTER minting tokens**, so `tokens_sold` has already advanced. The `current_price` call at line 439 uses `new_tokens_sold` (post-trade), inflating the computed spread vs. the actual entry price. Buy at a given market price → spread logged as if buyer paid a higher price. | P0 | Buy 0.1 SOL on Player_NJ (high slope tier). `spread_at_buy` in TradeEvent is computed from `current_price(base_price, slope, tokens_sold + token_amount)` rather than the pre-trade price. Downstream telemetry (CSV spread column) and the leaderboard Sharp Calls ranking are wrong. | Yes — Sharp Calls leaderboard corrupted; incorrect spread data poisons the Demo 1 telemetry review |
| SIM-003 | **Treasury balance accounting diverges from actual PDA lamports under concurrent trades.** `curve.treasury_lamports` is updated in-memory after CPI transfer completes, but two concurrent transactions touching the same bonding curve PDA can each read stale `treasury_lamports` before the other's write is committed. The reserve invariant check (`sol_return <= treasury`) can pass for both sellers simultaneously using the same pool, resulting in one sell over-draining the treasury. Solana's single-leader sequencing means this is extremely unlikely on a busy validator but *can* occur on devnet with identical blockhash windows. | P1 | Launch two concurrent sell transactions for Player_NJ within the same slot (same blockhash). If both read the same `treasury_lamports` value and both pass the reserve check, the second one may overdraw. On devnet this requires crafting the txs to share a blockhash, but it is architecturally real. | Yes — treasury invariant violation means the on-chain reserve can go negative, which would brick all future sells for that player |
| SIM-004 | **`calculate_tokens_for_sol` binary search upper bound is `total_supply - tokens_sold`**, which can be extremely large for newly initialised curves with 1,000,000 total supply and 0 tokens sold. A whale buying with a very large SOL input causes 20 binary search iterations over a 1M-token range. This is fine for current demo scale but the binary search does not short-circuit on overflow — if a rogue `sol_amount` value would require >u64 intermediate math, `calculate_buy_cost` panics with `MathOverflow` rather than returning a useful error to the caller. | P1 | Call `buy_with_sol` with `sol_amount = u64::MAX / 2`. The binary search calls `calculate_buy_cost(base, slope, 0, 500_000)` — `slope * n * (2*s + n - 1) / 2` overflows u128 for large `n`. The `?` propagates `MathOverflow` but the caller does not distinguish this from `DustAmount`, so the UI shows a generic error. | Yes — whale trade or UI input bug produces an opaque on-chain error with no user-friendly message |
| SIM-005 | **Sell of full token balance when `tokens_sold == token_amount` (zero-liquidity edge)** — `calculate_sell_return` calls `calculate_buy_cost(base, slope, 0, token_amount)`. When `tokens_sold == 0` (all tokens returned), this correctly returns the original buy price. However, `require!(sol_return <= treasury)` can fail if the treasury was partially drained by fees on prior sells, leaving a rounding-induced gap of 1–2 lamports. Last seller in a full sell-out gets `InsufficientTreasury`. | P1 | Init curve, buy N tokens, sell N-1 tokens, attempt to sell the final 1 token. The last lamport rounding from fee splits leaves treasury 1–2 lamports short. | Yes — last seller on any fully-traded player is permanently stuck |
| SIM-006 | **Oracle price not displayed to user before trade confirmation.** The `stats_oracle.index_price_lamports` is available on-chain and is used for `spread_at_buy` calculation, but the trade page UI does not show the current oracle (fair value) price before the user confirms a buy. Users can see the bonding curve market price but cannot see the spread they're entering. This is a UI omission — the oracle data is available via account read, it just isn't surfaced. | P1 | Open `/trade/[playerId]`, inspect the trade confirmation UI. Oracle index price is absent. User does not know the spread direction or magnitude before committing. | Yes — the core product claim ("buy when market is below oracle") is invisible at the moment it matters most |
| SIM-007 | **Wallet disconnect mid-trade leaves token ATA in inconsistent state.** If wallet disconnect occurs after `createAssociatedTokenAccountIdempotentInstruction` succeeds but before `buy_with_sol` is broadcast, the ATA is created but holds 0 tokens. On reconnect, the UI may show a non-zero "pending" balance from optimistic state. The idempotent ATA creation is correct, but the optimistic balance update in the Next.js state needs a post-transaction confirmation fetch, not a pre-broadcast increment. | P2 | Simulate network drop after ATA creation tx confirms but before buy tx is submitted. Reconnect — UI shows stale optimistic balance. | No — recovers on page refresh, does not lose funds |
| SIM-008 | **Insufficient balance error surface.** When a user's SOL balance is too low for a buy (including fees), the on-chain error is `SendTransactionError` with a log message referencing system program transfer failure — not a FanshareError. The frontend has no specific handling for this case; it falls through to the generic error toast. No indication to the user of how much SOL they need. | P2 | Register demo wallet, spend all SOL on one large buy, attempt a second buy. Error toast fires with generic message. | No — wallet shows balance, user can self-diagnose, but poor UX |
| SIM-009 | **Trade at slope-tier boundary (Player at exactly $4.99 vs $5.00)**: the `slope` value is set at `init-players` time based on the oracle price. If the oracle updates after init and bumps a player from the $2.50–$4.99 tier to the $5.00+ tier, the slope does NOT change on-chain (base_price is set once). A player that crosses the tier boundary after launch has the wrong slope for its new price regime. | P2 | Player starts at oracle $4.90 (slope=50000), oracle updates to $5.10 — slope remains 50000 on-chain. The $100 grant now only moves price ~3% instead of the target ~5-7%. | No — suboptimal curve behavior, not a fund-loss bug. Relevant for Demo 2 slope migration. |
| SIM-010 | **Concurrent oracle reads during trade** — tested explicitly. Oracle reads are stateless reads (`stats_oracle` is a read-only account in the Trade context). Multiple concurrent trades reading the same `stats_oracle` produce no conflict — each transaction reads the current on-chain value independently. **No race condition found** — oracle reads during trades are safe on Solana's account model. | N/A — no bug | N/A | N/A |

---

## Summary

| Severity | Count | Bugs |
|---|---|---|
| P0 | 2 | SIM-001 (frozen market sell block), SIM-002 (spread computed post-trade) |
| P1 | 3 | SIM-003 (concurrent treasury drain), SIM-004 (whale math overflow), SIM-005 (last-seller rounding trap) |
| P2 | 3 | SIM-006 (oracle price hidden from UI), SIM-007 (wallet disconnect optimistic state), SIM-008 (balance error messaging), SIM-009 (slope tier boundary post-launch) |
| N/A | 1 | SIM-010 (oracle concurrent read — no bug found) |

**Demo 1 blockers: SIM-001, SIM-002, SIM-003, SIM-004, SIM-005, SIM-006** (P0s + P1s)

P2s (SIM-007, SIM-008, SIM-009) are documented for Frankie's review but left unfixed per spec.
