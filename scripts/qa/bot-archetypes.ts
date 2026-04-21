/**
 * Rule-based decision core for the 5 user archetypes.
 *
 * Why: the ops spec requires per-action think-aloud artifacts but also requires
 * reproducibility ("did my patch regress a flow that worked last run?"). Pure
 * LLM-per-decision breaks reproducibility. So we split:
 *
 *   1) Decision (here): deterministic given (state, bot, seeded RNG).
 *   2) Reasoning (bot-reasoning.ts): LLM narrates the decision in-character.
 *
 * Narration is allowed to vary between runs. The action trace must not.
 *
 * State the decision function sees:
 *   - bot + budget remaining
 *   - per-player market snapshot (market price, oracle/fair value, spread %)
 *   - recent news events (last N ticks)
 *   - current phase (pre_game | live | post_game)
 *   - whether the bot has already opened a player page this run (for trackOnce
 *     `first_player_opened` coverage — newbies who haven't opened a player yet
 *     get biased toward doing so)
 */

import type { BotUser } from "./bot-users";
import type { SeededRng } from "../lib/seeded-rng";

export type Phase = "pre_game" | "live" | "post_game";

export interface MarketSnapshot {
  playerId: string;
  /** Market price from the bonding curve, in SOL per token. */
  marketPriceSol: number;
  /** Oracle / fair-value price, same units. */
  fairValueSol: number;
  /** Recent headline summary (1 line) most relevant to this player, if any. */
  latestHeadline?: string;
  /** Wall-clock ms since the last headline touching this player fired. */
  msSinceHeadline?: number;
}

export interface BotState {
  budgetSolRemaining: number;
  holdings: Record<string, number>; // playerId → tokens held (best-effort local tally)
  hasOpenedPlayer: boolean;
  hasTradedBuy: boolean;
  hasTradedSell: boolean;
  abandoned: boolean;
  ticksSinceAction: number;
}

export type BotAction =
  | { kind: "idle"; why: "waiting" | "abandoning" | "post_game_cooling" }
  | { kind: "open_player"; playerId: string }
  | { kind: "buy"; playerId: string; solAmount: number; dust?: boolean }
  | { kind: "sell"; playerId: string; fractionOfHoldings: number }
  | { kind: "abandon" };

export interface DecisionCtx {
  bot: BotUser;
  state: BotState;
  phase: Phase;
  markets: MarketSnapshot[];
  rng: SeededRng;
  tickIndex: number;
}

/**
 * Main entry: given a bot + current world state + its own RNG child, produce
 * the next action. Pure function (modulo the rng advancing its internal state).
 */
export function decideAction(ctx: DecisionCtx): BotAction {
  const { bot, state, phase, markets, rng } = ctx;

  if (state.abandoned) return { kind: "idle", why: "abandoning" };
  if (phase === "post_game") return decidePostGame(ctx);

  // Abandon trickle — per-tick probability scaled so that across ~900 live
  // ticks (30 min × ~30 ticks/min at TICK_MS=2000) the cumulative probability
  // approximates the bot's intended total-run abandon rate. Skeptic=0.45 → ~46%;
  // hype=0.02 → ~3%. Flagged bots are suppressed until they've fired their
  // special-case coverage trigger (dust buy, Tally open) so the PostHog
  // verification matrix has guaranteed signal.
  const suppressAbandon =
    (bot.flags?.submitsTally && ctx.tickIndex < 15 * 60) ||
    (bot.flags?.dustAttempt && !state.hasTradedBuy);
  if (phase === "live" && !suppressAbandon && rng.chance(bot.biases.abandonRate * 0.0015)) {
    return { kind: "abandon" };
  }

  // If the bot hasn't opened a player yet, bias heavily toward doing so — this
  // feeds the `first_player_opened` trackOnce coverage we need in events.csv.
  if (!state.hasOpenedPlayer) {
    const target = pickFavoriteOrRandom(bot, markets, rng);
    if (target) return { kind: "open_player", playerId: target.playerId };
  }

  switch (bot.archetype) {
    case "hype":
      return decideHype(ctx);
    case "value":
      return decideValue(ctx);
    case "newbie":
      return decideNewbie(ctx);
    case "skeptic":
      return decideSkeptic(ctx);
    case "power":
      return decidePower(ctx);
  }
}

// ── archetype strategies ────────────────────────────────────────────────────

function decideHype(ctx: DecisionCtx): BotAction {
  const { bot, state, markets, rng } = ctx;

  // React to the freshest news that touches a favorite, else any fresh news.
  const fresh = freshNews(markets, 20_000);
  const favHit = fresh.find((m) => bot.favoritePlayers.includes(m.playerId));
  const target = favHit ?? fresh[0] ?? pickFavoriteOrRandom(bot, markets, rng);
  if (!target) return { kind: "idle", why: "waiting" };

  // Hype ignores spread threshold. Buys on news with moderate size.
  if (state.budgetSolRemaining > 0.05) {
    const size = clamp(bot.budgetSol * rng.floatBetween(0.1, 0.3), 0.02, state.budgetSolRemaining);
    return { kind: "buy", playerId: target.playerId, solAmount: round4(size) };
  }

  // No budget left, look to take profit if the headline is negative (-%) for
  // a player we hold. Heuristic: if market > fair and we hold, sell a bit.
  const sellable = Object.entries(state.holdings).find(([, t]) => t > 0);
  if (sellable) return { kind: "sell", playerId: sellable[0], fractionOfHoldings: 0.5 };
  return { kind: "idle", why: "waiting" };
}

function decideValue(ctx: DecisionCtx): BotAction {
  const { bot, state, markets, rng } = ctx;

  // Look for favorable spread on any favorite, else broaden.
  const ranked = [...markets].sort((a, b) => spread(b) - spread(a));
  const underpriced = ranked.find(
    (m) => spread(m) >= bot.biases.spreadThreshold && bot.favoritePlayers.includes(m.playerId),
  ) ?? ranked.find((m) => spread(m) >= bot.biases.spreadThreshold);

  if (underpriced && state.budgetSolRemaining > 0.05) {
    const size = clamp(
      bot.budgetSol * rng.floatBetween(0.15, 0.35),
      0.03,
      state.budgetSolRemaining,
    );
    return { kind: "buy", playerId: underpriced.playerId, solAmount: round4(size) };
  }

  // Inverse: if we hold something that's now over fair, trim.
  for (const [pid, held] of Object.entries(state.holdings)) {
    if (held <= 0) continue;
    const m = markets.find((x) => x.playerId === pid);
    if (m && m.marketPriceSol > m.fairValueSol * (1 + bot.biases.spreadThreshold)) {
      return { kind: "sell", playerId: pid, fractionOfHoldings: 0.4 };
    }
  }

  return { kind: "idle", why: "waiting" };
}

function decideNewbie(ctx: DecisionCtx): BotAction {
  const { bot, state, markets, rng } = ctx;

  // Newbies: follow whatever is loudest. Flagged newbie does a guaranteed
  // dust attempt on their first buy (no dice roll) — `error_shown` must
  // have coverage in the verification matrix.
  if (bot.flags?.dustAttempt && !state.hasTradedBuy) {
    const target = pickFavoriteOrRandom(bot, markets, rng);
    if (target) return { kind: "buy", playerId: target.playerId, solAmount: 0.0005, dust: true };
  }

  // Otherwise, buy the first favorite with any spread >= 0 (they can't read it).
  const target = pickFavoriteOrRandom(bot, markets, rng);
  if (target && state.budgetSolRemaining > 0.05 && rng.chance(0.4)) {
    const size = clamp(bot.budgetSol * rng.floatBetween(0.2, 0.4), 0.03, state.budgetSolRemaining);
    return { kind: "buy", playerId: target.playerId, solAmount: round4(size) };
  }
  return { kind: "idle", why: "waiting" };
}

function decideSkeptic(ctx: DecisionCtx): BotAction {
  const { bot, state, markets, rng } = ctx;

  // Skeptics act slowly. Most ticks idle.
  if (rng.chance(0.75)) return { kind: "idle", why: "waiting" };

  // If they haven't traded and a favorite looks genuinely cheap, take one
  // cautious nibble.
  const target = markets
    .filter((m) => bot.favoritePlayers.includes(m.playerId))
    .sort((a, b) => spread(b) - spread(a))[0];
  if (!state.hasTradedBuy && target && spread(target) > 0.03 && state.budgetSolRemaining > 0.05) {
    const size = clamp(bot.budgetSol * 0.15, 0.02, state.budgetSolRemaining);
    return { kind: "buy", playerId: target.playerId, solAmount: round4(size) };
  }

  return { kind: "idle", why: "waiting" };
}

function decidePower(ctx: DecisionCtx): BotAction {
  const { bot, state, markets, rng } = ctx;

  // Power user: whichever has largest abs-spread OR freshest headline.
  const news = freshNews(markets, 10_000);
  const bySpread = [...markets].sort((a, b) => Math.abs(spread(b)) - Math.abs(spread(a)))[0];
  const target = news[0] ?? bySpread;
  if (!target) return { kind: "idle", why: "waiting" };

  const sp = spread(target);
  if (sp > 0.02 && state.budgetSolRemaining > 0.05) {
    const size = clamp(bot.budgetSol * rng.floatBetween(0.08, 0.18), 0.02, state.budgetSolRemaining);
    return { kind: "buy", playerId: target.playerId, solAmount: round4(size) };
  }
  if (sp < -0.02) {
    const held = Object.entries(state.holdings).find(([pid, t]) => pid === target.playerId && t > 0);
    if (held) return { kind: "sell", playerId: target.playerId, fractionOfHoldings: 0.5 };
  }
  return { kind: "idle", why: "waiting" };
}

function decidePostGame(ctx: DecisionCtx): BotAction {
  const { bot, state, rng } = ctx;
  // One cleanup sell from value + power traders; everyone else cools.
  if (bot.archetype === "value" || bot.archetype === "power") {
    const sellable = Object.entries(state.holdings).find(([, t]) => t > 0);
    if (sellable && rng.chance(0.5)) {
      return { kind: "sell", playerId: sellable[0], fractionOfHoldings: 0.6 };
    }
  }
  return { kind: "idle", why: "post_game_cooling" };
}

// ── helpers ─────────────────────────────────────────────────────────────────

function spread(m: MarketSnapshot): number {
  if (m.fairValueSol <= 0) return 0;
  return (m.fairValueSol - m.marketPriceSol) / m.fairValueSol;
}

function freshNews(markets: MarketSnapshot[], withinMs: number): MarketSnapshot[] {
  return markets
    .filter((m) => m.latestHeadline && (m.msSinceHeadline ?? Infinity) < withinMs)
    .sort((a, b) => (a.msSinceHeadline ?? 0) - (b.msSinceHeadline ?? 0));
}

function pickFavoriteOrRandom(
  bot: BotUser,
  markets: MarketSnapshot[],
  rng: SeededRng,
): MarketSnapshot | undefined {
  const favs = markets.filter((m) => bot.favoritePlayers.includes(m.playerId));
  if (favs.length > 0) return rng.pick(favs);
  if (markets.length === 0) return undefined;
  return rng.pick(markets);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
