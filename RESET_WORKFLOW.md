# Reset workflow

Wipe everything the demo accumulates (wallets, SOL, trade history,
leaderboard, spread) and return the site to a fresh-invite state.

Run this:
- Between QA rounds when you need clean telemetry.
- Before the real invite blast, after QA is signed off.
- Any time `/leaderboard` or `/trade/*` shows crud you don't want users seeing.

## What gets wiped

| Layer | What | How |
|---|---|---|
| Demo wallets | Custodial keypairs in KV + any SOL still sitting in them | `npm run reclaim-demo` then `npm run reset-kv` |
| Trade history | `price-history:*`, `trade-events:*`, webhook dedupe | `npm run reset-kv` |
| Leaderboard | `trader:*`, `sharp:*`, both sorted-set leaderboards | `npm run reset-kv` |
| Sharp calls history | `sharp:buys:*`, `sharp:<wallet>` score records | `npm run reset-kv` |
| On-chain curves | Bonding curve `tokensSold`, `treasuryLamports`, all holder ATAs | Re-init — new mints via `npm run init-players` |
| Oracle / fair value | Per-player `stats_oracle` PDA price feed | Re-init + `npm run oracle:mock` |
| Spread | Function of `market_price - oracle_price` — becomes 0 when market and oracle both start at the same base | Falls out of the re-init above |

## Command sequence

Run from repo root, all from your machine (not prod):

```bash
# 1. Pull all SOL + sell any residual tokens from demo wallets back to the deploy wallet.
#    Reads demo:wallets set from KV and iterates. Safe to run multiple times.
npm run reclaim-demo

# 2. Wipe all KV state (demo wallets, price history, leaderboards, sharp calls).
#    Requires --yes confirmation flag.
npm run reset-kv -- --yes

# 3. Back up current mints, then re-init bonding curves + oracles on-chain.
#    init-players is resume-safe — it only creates mints for players missing from
#    player-mints.json. Deleting the file forces it to create all 15 fresh.
mv app/lib/player-mints.json app/lib/player-mints.pre-reset-$(date +%Y%m%d-%H%M%S).json
npm run init-players

# 4. Seed every fresh oracle with current stats so fair_value = base_price → spread = 0.
npm run oracle:mock

# 5. Commit the new mints so prod picks them up.
git add app/lib/player-mints.json app/lib/player-mints.pre-reset-*.json
git commit -m "chore(reset): re-init all 15 player markets — blank slate for <reason>"
git push origin master
vercel --prod --yes
```

## Verification (before calling it done)

```bash
# A. KV should be empty of demo state
curl -s -H "Authorization: Bearer $KV_REST_API_TOKEN" \
  "$KV_REST_API_URL/scan/0/match/demo:*/count/500" | jq .result[1] | head
curl -s -H "Authorization: Bearer $KV_REST_API_TOKEN" \
  "$KV_REST_API_URL/scan/0/match/price-history:*/count/500" | jq .result[1] | head
curl -s -H "Authorization: Bearer $KV_REST_API_TOKEN" \
  "$KV_REST_API_URL/scan/0/match/sharp:*/count/500" | jq .result[1] | head
# all three should return []

# B. Leaderboard should read empty on prod
curl -s https://fanshares.xyz/api/leaderboard/top-traders | jq .
curl -s https://fanshares.xyz/api/leaderboard/sharp-calls | jq .

# C. Spread should be 0 on every player card
# Open https://fanshares.xyz/ — no UNDERVALUED/OVERVALUED tags should appear
# (spread renders only when |spread| > 0). If a player still shows a tag, the
# oracle didn't update on that market — re-run `npm run oracle:mock`.

# D. Deploy wallet should be fat with reclaimed SOL
solana balance CsGh5T7EzTUW3hmdpjMrJyzBVq1RPnDXMr9VYuHyXa83 --url <HELIUS_URL>
# Expect ≥ 10 SOL before an invite blast (15 × 0.667 = 10.005 SOL minimum).
```

## Gotchas

- **Freeze is permanent.** If you froze a market during QA, re-init creates a
  *new* mint but the old frozen PDA stays on-chain forever. That's fine — the
  UI only reads the mint in `player-mints.json`, so the frozen one becomes
  invisible. Do not try to "un-freeze" — it's intentionally one-way.
- **Webhook doesn't need re-registering.** The Helius webhook filters by
  program ID, not mint. Same webhook keeps working across re-inits.
- **Browser localStorage survives the reset.** A tester who visited before the
  reset will still have `fanshare_demo` in their browser pointing at a
  now-orphaned wallet. Tell them to hard-refresh + disconnect, or just use
  incognito for the real invite run.
- **Vercel env var `ORACLE_SECRET_KEY` must match `player-mints.json` oracle authority.**
  Re-init uses whatever wallet is in `.env.local` / your local keypair to
  create the oracle PDAs. If the Vercel cron wallet differs, `update_oracle`
  will fail in prod. Same wallet everywhere = no problem.
- **Price history chart empty state is expected.** After a reset, the chart
  shows `[]` until the first real trade hits the webhook. Not a bug.

## Pre-invite checklist (derived from the above)

Before sending the real invites:

- [ ] `npm run reclaim-demo` completed — demo wallets drained
- [ ] `npm run reset-kv -- --yes` completed — leaderboard empty
- [ ] `npm run init-players` completed — new mints in `player-mints.json`
- [ ] `npm run oracle:mock` completed at least twice (first to seed, second to
      confirm the cron path works without touching balldontlie)
- [ ] Deploy wallet balance ≥ 10 SOL
- [ ] Vercel deploy green, `/invite` returns 200 on fanshares.xyz
- [ ] Spot-check: open `/trade/Player_LBJ` in incognito — no UNDERVALUED/OVERVALUED
      tag visible; Tokens sold 0/5,000; Treasury $0.00
