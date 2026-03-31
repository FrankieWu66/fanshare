# FanShare — TODOs

---

## Pre-Sprint 1 (must resolve before writing Anchor program)

### [ ] Define bonding curve parameters (base_price, slope)

**What:** Pick the concrete numbers for the linear bonding curve:
`price_per_token = base_price + (slope × tokens_sold)`

**Why:** Without defined parameters, the bonding curve program can't be initialized and the price range won't make intuitive sense to beta users. If the numbers feel wrong, you'll need to redeploy the Anchor program.

**How to approach:**
1. Open a spreadsheet
2. Set `total_supply = 1,000,000` tokens per player (provisional)
3. Try: `base_price = 1,000 lamports (0.000001 SOL)`, `slope = 10 lamports per token sold`
   - Token 1 costs: 0.000001 SOL
   - Token 100,000 costs: 0.001001 SOL
   - Token 1,000,000 costs: 0.010001 SOL (max price)
4. Total treasury at full sell-out: ~5,000 SOL (sum of all token prices)
5. Adjust multipliers until the price range feels right for your beta users (crypto-native, used to trading in SOL fractions)

**Goal:** First token should be cheap enough that anyone with a Solana wallet will try it. Max price should feel like a meaningful position, not astronomical.

**Depends on:** Nothing — can be done in a spreadsheet before any code.

---

## Day 0 Setup (before scaffolding)

### [ ] git init + .gitignore + initial commit

**What:** Initialize the repo. Every gstack skill depends on git.

### [ ] Fund oracle devnet wallet

**What:** Airdrop test SOL to the oracle keypair on devnet so the cron can pay transaction fees when writing price updates on-chain. ~0.000005 SOL per update, negligible, but wallet must have balance.

**How:** `solana airdrop 2 <oracle-pubkey> --url devnet`

### [ ] Sign up for Helius free RPC

**What:** Free tier RPC provider for frontend + oracle to talk to Solana devnet. 100k requests/day. Sufficient for 10 beta users. Track in expenses.md.

---

## Pre-Mainnet (not blocking devnet)

### [ ] Legal review — token issuance structure, player names, NBA data license

### [ ] Solana program security audit (~$20-50k, 4-6 week lead time)

### [ ] Upgrade oracle keypair management to Squads multisig

### [ ] Identify mainnet sports oracle (Switchboard custom job or Sportradar integration)

### [ ] Raydium graduation mechanic (v1.5 — spike Raydium CPMM pool creation via SDK)
