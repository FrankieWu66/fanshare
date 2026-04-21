# Price Structure — Curve Shape & Oracle Relationship
*Status: ✅ FINALIZED | April 2026*

---

## What Is Finalized

The **shape** of the pricing system is locked. The **slope value** is NOT yet settled (see overview.md #5).

---

## Market Price Formula

```
market_price(n) = base_price + slope × n

where:
  n           = tokens sold (cumulative, tracked on-chain)
  base_price  = oracle index price AT MARKET INITIALIZATION — stored once, never updated
  slope       = fixed price increment per token sold (value TBD — see overview #5)
```

**Pure linear bonding curve. Protocol is always the counterparty. No external LPs. No DEX graduation.**

---

## Static Base Price — Why This Is Locked

`base_price` is set once when the market is created and never changes, even as the oracle updates daily.

This is intentional:

- Oracle updates every day based on player stats
- `base_price` does not follow the oracle — it stays at launch value
- Spread = `(market_price − oracle_index) / oracle_index`
- When oracle improves (player plays better), spread automatically goes negative → "undervalued" signal
- When oracle drops (player declines), spread goes positive → "overvalued" signal
- Traders act on spread → market price moves → spread normalizes
- **Oracle updates create opportunities. Traders exploit them. That is the product.**

Do not build any mechanism that updates `base_price` after initialization.

---

## Spread — The Core Signal

```
spread = (market_price − oracle_index) / oracle_index × 100%
```

| Spread | Meaning |
|---|---|
| 0% | Market agrees exactly with oracle |
| Positive (+%) | Market thinks player is worth MORE than oracle says — crowded trade |
| Negative (−%) | Market thinks player is worth LESS than oracle says — undervalued opportunity |

The spread is what knowledgeable fans exploit. Early + right = profit from being ahead of the market.

---

## Oracle × Curve Interaction

| Event | base_price | market_price | spread |
|---|---|---|---|
| Oracle daily update | No change | No change (no trades) | Changes — market vs new oracle |
| User buys | No change | Increases by slope × tokens | Widens (market above oracle) |
| User sells | No change | Decreases by slope × tokens | Narrows |
| Player improves (oracle ↑) | No change | No change | Goes negative → undervalued signal |
| Player declines (oracle ↓) | No change | No change | Goes positive → overvalued signal |

---

## System Model

- **Pure bonding curve** — protocol mints on buy, burns on sell
- **Protocol is counterparty** to every trade
- **Treasury** = accumulated buy inflows minus sell outflows minus fees
- **No graduation** — curves never migrate to Raydium, Orca, or any DEX
- The oracle anchor is the product. Disconnecting from it breaks everything.

---

## What Is NOT Finalized Here

- Slope value → see overview.md #5
- Total supply cap → see overview.md #4
- Fee applied to each trade → see overview.md #8
- Pre-seed mechanics → see overview.md #6

---

*Structure finalized April 2026 after evaluating pump.fun (constant product), friend.tech (quadratic), and linear models. Linear chosen for auditability and oracle-anchored spread clarity.*
