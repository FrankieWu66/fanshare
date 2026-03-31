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

### [ ] Create 15-player devnet roster config

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
