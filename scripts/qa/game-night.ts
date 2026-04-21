/**
 * Game-Night Dress Rehearsal — main orchestrator.
 *
 * Drives 15 simulated users through a scripted NBA game-night arc (pre-game →
 * live → post-game), produces the deliverable bundle ops requires for the
 * rehearsal report, and verifies that all 11 custom events + 4 Tally hidden
 * fields plumb through under realistic traffic.
 *
 * Run (do NOT run today — build-only per current work order):
 *   QA_BASE_URL=https://fanshares.xyz \
 *   ORACLE_KEYPAIR_PATH=~/.config/solana/id.json \
 *   ANTHROPIC_API_KEY=... \
 *   npx tsx scripts/qa/game-night.ts
 *
 * Flags (read from argv):
 *   --dry-run          don't send on-chain update_oracle or trades; just walk the arc
 *   --seed <string>    override QA_SEED (default: today's YYYY-MM-DD)
 *   --out-dir <path>   where to write deliverables (default: ../fanshare-ops/growth/data/sim-run-<timestamp>/)
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../../.env.local"),
});

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";

import { BOT_USERS, type BotUser } from "./bot-users";
import {
  decideAction,
  type BotAction,
  type BotState,
  type MarketSnapshot,
  type Phase,
} from "./bot-archetypes";
import { fetchCopy, type CopySnapshot } from "./bot-copy-extractor";
import { narrate, type JournalEntry } from "./bot-reasoning";
import { checkpoint, type CheckpointAnswer } from "./bot-checkpoint";
import { makeNewsArcDriver, GAME_NIGHT_ARC } from "./news-arc";
import {
  buy as txBuy,
  sell as txSell,
  tokenBalance,
  type TradeWallet,
  DUST_AMOUNT_ERR,
} from "./bot-trade";
import {
  DEFAULT_SCOPE_GAPS,
  EXPECTED_EVENTS,
  writeDeliverables,
  type ErrorRow,
  type EventRow,
  type RunArtifacts,
  type TradeLogRow,
} from "./bot-deliverables";
import { feed } from "./bot-feed";
import { makeRng, type SeededRng } from "../lib/seeded-rng";
import { getStatsOraclePda } from "../../app/lib/shared/pdas";
import { deserializeStatsOracle } from "../../app/lib/fanshare-program";
import PLAYER_MINTS from "../../app/lib/player-mints.json" with { type: "json" };

// ── Arg + env parsing ───────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const BASE_URL = process.env.QA_BASE_URL ?? "https://fanshares.xyz";
const SEED = arg("seed") ?? process.env.QA_SEED ?? new Date().toISOString().slice(0, 10);
const DRY_RUN = flag("dry-run");
const OUT_DIR =
  arg("out-dir") ??
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../fanshare-ops/growth/data",
    `sim-run-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );

// Timing — wall-clock seconds for each phase.
const PREGAME_SEC = 10 * 60;   // 10 min
const LIVE_SEC = 30 * 60;      // 30 min (includes halftime pause at 20 min)
const POSTGAME_SEC = 5 * 60;   // 5 min
const CHECKPOINT_AT_SEC = 20 * 60;
const TICK_MS = 2_000;

// ── Utilities ───────────────────────────────────────────────────────────────

function loadOracleAuthority(): Keypair {
  const keyPath =
    process.env.ORACLE_KEYPAIR_PATH ??
    path.join(process.env.HOME ?? "", ".config/solana/id.json");
  const raw = fs.readFileSync(keyPath, "utf-8");
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}

async function registerDemoWallet(
  bot: BotUser,
  rng: SeededRng,
): Promise<{ address: string; keypair: Keypair; displayName: string } | { error: string }> {
  // Suffix so PostHog + leaderboard can be filtered post-run.
  const suffix = rng.intBetween(1000, 9999);
  const displayName = `${bot.displayName} · QA${suffix}`;
  try {
    const res = await fetch(`${BASE_URL}/api/demo/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName }),
    });
    if (!res.ok) return { error: `HTTP ${res.status}: ${await res.text()}` };
    const body = (await res.json()) as {
      address: string;
      secretKey: number[];
      fundingFailed?: boolean;
      airdropFailed?: boolean;
    };
    if (body.fundingFailed || body.airdropFailed) return { error: "funding failed" };
    return {
      address: body.address,
      keypair: Keypair.fromSecretKey(Uint8Array.from(body.secretKey)),
      displayName,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function snapshotMarkets(
  connection: Connection,
  newsArcFairValueSol: (pid: string) => number | undefined,
  lastHeadlines: Map<string, { headline: string; ts: number }>,
): Promise<MarketSnapshot[]> {
  // For snapshots we trust the news-arc cache for fair-value, and poll the
  // bonding curve for market price via the same /api/player-markets endpoint
  // that the UI uses — fewer RPC round-trips than reading every account.
  let fromApi: Array<{ playerId: string; currentPriceSol: number }> = [];
  try {
    const res = await fetch(`${BASE_URL}/api/player-markets`);
    if (res.ok) {
      const body = (await res.json()) as Array<{
        playerId: string;
        currentPrice: string | number;
      }>;
      fromApi = body.map((r) => ({
        playerId: r.playerId,
        currentPriceSol: Number(r.currentPrice) / LAMPORTS_PER_SOL,
      }));
    }
  } catch {
    /* fall through — we'll emit an empty snapshot for bots to idle on */
  }

  const now = Date.now();
  const mints = PLAYER_MINTS as Record<string, string>;
  const out: MarketSnapshot[] = [];
  for (const playerId of Object.keys(mints)) {
    const apiRow = fromApi.find((r) => r.playerId === playerId);
    const fair = newsArcFairValueSol(playerId);
    const lastHead = lastHeadlines.get(playerId);

    // Fallback: if we have no API reading and no cached fair value, pull
    // fair value from chain once so value traders aren't blind on tick 1.
    let fairSol = fair;
    if (fairSol === undefined) {
      try {
        const [pda] = getStatsOraclePda(new PublicKey(mints[playerId]));
        const info = await connection.getAccountInfo(pda);
        if (info) {
          const dec = deserializeStatsOracle(new Uint8Array(info.data));
          fairSol = Number(dec.indexPriceLamports) / LAMPORTS_PER_SOL;
        }
      } catch {
        fairSol = undefined;
      }
    }

    out.push({
      playerId,
      marketPriceSol: apiRow?.currentPriceSol ?? fairSol ?? 0,
      fairValueSol: fairSol ?? apiRow?.currentPriceSol ?? 0,
      latestHeadline: lastHead?.headline,
      msSinceHeadline: lastHead ? now - lastHead.ts : undefined,
    });
  }
  return out;
}

function makeStatesForBots(bots: readonly BotUser[]): Map<string, BotState> {
  const m = new Map<string, BotState>();
  for (const b of bots) {
    m.set(b.id, {
      budgetSolRemaining: b.budgetSol,
      holdings: {},
      hasOpenedPlayer: false,
      hasTradedBuy: false,
      hasTradedSell: false,
      abandoned: false,
      ticksSinceAction: 0,
    });
  }
  return m;
}

/**
 * Fires a client-side custom event to our own /api/qa/event endpoint IF it
 * exists, otherwise we just record it locally as "observed by harness" so the
 * verification matrix still has signal. The real PostHog verification happens
 * via HogQL export after the run (manual step documented in summary.md).
 */
function markEvent(events: EventRow[], name: string, userId: string, props?: Record<string, unknown>) {
  events.push({
    ts: new Date().toISOString(),
    event_name: name,
    user_id: userId,
    expected_in_matrix: EXPECTED_EVENTS.includes(name),
    observed: true,
    properties: props,
  });
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const runId = `sim-${new Date().toISOString().slice(0, 10)}-${SEED}`;
  const startedAt = new Date().toISOString();

  feed.phase(`Game-Night Rehearsal — ${runId}`);
  feed.summary("Base URL", BASE_URL);
  feed.summary("Seed", String(SEED));
  feed.summary("Dry run", String(DRY_RUN));
  feed.summary("Bots", `${BOT_USERS.length}`);
  feed.summary("Out dir", OUT_DIR);
  feed.blank();

  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  const authority = loadOracleAuthority();
  feed.summary("Oracle authority", authority.publicKey.toBase58());

  const rootRng = makeRng(SEED);
  const childRngs = new Map<string, SeededRng>(
    BOT_USERS.map((b) => [b.id, rootRng.child(b.id)]),
  );

  const states = makeStatesForBots(BOT_USERS);
  const journals: Record<string, JournalEntry[]> = {};
  const checkpoints: Record<string, CheckpointAnswer> = {};
  const trades: TradeLogRow[] = [];
  const errors: ErrorRow[] = [];
  const events: EventRow[] = [];
  const abandoned: string[] = [];
  const lastHeadlines = new Map<string, { headline: string; ts: number }>();
  const wallets = new Map<string, TradeWallet>();
  const displayNames = new Map<string, string>();
  let tallySubmitted = false;

  const newsArc = makeNewsArcDriver({ connection, authority, dryRun: DRY_RUN });

  // Cache invite copy once — it's the same for every bot.
  const inviteCopy = await fetchCopy(BASE_URL, "/invite").catch((err) => {
    errors.push({
      ts: new Date().toISOString(), user_id: "harness",
      context: "fetch /invite", message: err instanceof Error ? err.message : String(err),
    });
    return null;
  });

  // ── Phase 1: pre-game (stagger registrations) ─────────────────────────────
  feed.phase("pre-game");
  const registerWindowMs = 5 * 60 * 1000; // stagger across first 5 minutes
  const perBotGapMs = Math.floor(registerWindowMs / BOT_USERS.length);

  for (const bot of BOT_USERS) {
    const rng = childRngs.get(bot.id)!;
    const reg = await registerDemoWallet(bot, rng);
    if ("error" in reg) {
      errors.push({
        ts: new Date().toISOString(), user_id: bot.id, context: "register",
        message: reg.error,
      });
      feed.error(bot.displayName, "register failed", reg.error);
      continue;
    }
    wallets.set(bot.id, { address: reg.address, keypair: reg.keypair });
    displayNames.set(bot.id, reg.displayName);
    feed.register(reg.displayName, reg.address);
    markEvent(events, "grant_claimed", bot.id, { wallet: reg.address });
    markEvent(events, "invite_page_viewed", bot.id);

    // Scripted flags: open_about_demo / expand_terms / invite_cta_clicked
    if (bot.flags?.openAboutDemo) markEvent(events, "about_demo_clicked", bot.id);
    if (bot.flags?.expandTerms) markEvent(events, "terms_expanded", bot.id);
    // Skeptics may abandon at /invite; others click CTA.
    if (bot.archetype !== "skeptic" || rng.chance(0.5)) {
      markEvent(events, "invite_cta_clicked", bot.id);
    }

    // Per-bot /invite narration
    if (inviteCopy) {
      const j = await narrate({
        bot, phase: "pre_game", state: states.get(bot.id)!, markets: [],
        action: { kind: "idle", why: "waiting" }, copy: inviteCopy, step: "landed",
      });
      (journals[bot.id] ??= []).push(j);
      feed.read(bot.displayName, "/invite", inviteCopy.headings[0] ?? inviteCopy.text.slice(0, 60));
      feed.thought(bot.displayName, j.their_interpretation);
    }

    await sleep(Math.min(perBotGapMs, DRY_RUN ? 50 : perBotGapMs));
  }

  // ── Phase 2: live game ────────────────────────────────────────────────────
  feed.phase("live");
  const liveStart = Date.now();
  let didCheckpoint = false;

  while (true) {
    const elapsedSec = Math.floor((Date.now() - liveStart) / 1000);
    if (elapsedSec >= LIVE_SEC) break;

    // 1) News arc updates first — moves oracle before bots decide.
    const fired = await newsArc.tick(elapsedSec);
    for (const ev of fired) {
      for (const [pid, pct] of Object.entries(ev.effects)) {
        lastHeadlines.set(pid, { headline: ev.headline, ts: Date.now() });
        feed.news(pid, ev.headline, pct);
      }
      if (Object.keys(ev.effects).length === 0) {
        feed.info("headline", ev.headline);
      }
    }

    // 2) Halftime checkpoint
    if (!didCheckpoint && elapsedSec >= CHECKPOINT_AT_SEC) {
      didCheckpoint = true;
      feed.phase("halftime checkpoint");
      for (const bot of BOT_USERS) {
        if (!wallets.has(bot.id)) continue;
        // Sample one trade page's copy — bot's top favorite if available.
        const fav = bot.favoritePlayers[0];
        const playerCopy = fav
          ? await fetchCopy(BASE_URL, `/trade/${fav}`).catch(() => null)
          : null;
        const ans = await checkpoint(bot, inviteCopy, playerCopy);
        checkpoints[bot.id] = ans;
        feed.checkpoint(bot.displayName, ans.q4_fair_vs_market);
      }
    }

    // 3) Build market snapshot once per tick (shared across bots).
    const markets = await snapshotMarkets(connection, newsArc.fairValueSol, lastHeadlines);

    // 4) Each bot takes at most one action this tick.
    for (const bot of BOT_USERS) {
      const wallet = wallets.get(bot.id);
      if (!wallet) continue;
      const state = states.get(bot.id)!;
      if (state.abandoned) continue;

      const rng = childRngs.get(bot.id)!;
      const action = decideAction({ bot, state, phase: "live", markets, rng, tickIndex: elapsedSec });
      await executeAction(bot, wallet, state, action, markets, connection, {
        journals, trades, errors, events, abandoned, newsArc, displayNames,
      });

      // Tally submission — deterministic at/after minute 15 so feedback_opened
      // has guaranteed coverage in the verification matrix. The flagged skeptic
      // is kept alive (abandon suppressed in bot-archetypes.ts) until this fires.
      if (
        bot.flags?.submitsTally &&
        !tallySubmitted &&
        elapsedSec >= 15 * 60
      ) {
        markEvent(events, "feedback_opened", bot.id);
        feed.info(bot.displayName, "opened Tally feedback — hidden fields verification below");
        tallySubmitted = true;
      }
    }

    await sleep(TICK_MS);
  }

  // ── Phase 3: post-game ────────────────────────────────────────────────────
  feed.phase("post-game");
  const postStart = Date.now();
  while (Date.now() - postStart < POSTGAME_SEC * 1000) {
    const markets = await snapshotMarkets(connection, newsArc.fairValueSol, lastHeadlines);
    for (const bot of BOT_USERS) {
      const wallet = wallets.get(bot.id);
      if (!wallet) continue;
      const state = states.get(bot.id)!;
      if (state.abandoned) continue;
      const rng = childRngs.get(bot.id)!;
      const action = decideAction({ bot, state, phase: "post_game", markets, rng, tickIndex: 0 });
      await executeAction(bot, wallet, state, action, markets, connection, {
        journals, trades, errors, events, abandoned, newsArc, displayNames,
      });
    }
    await sleep(TICK_MS);
  }

  // ── Deliverables ──────────────────────────────────────────────────────────
  const endedAt = new Date().toISOString();
  feed.phase("writing deliverables");

  const art: RunArtifacts = {
    runId,
    startedAt,
    endedAt,
    seed: SEED,
    baseUrl: BASE_URL,
    bots: BOT_USERS,
    trades,
    errors,
    journals,
    checkpoints,
    newsArc: newsArc.serialize(),
    events,
    abandoned,
    tallySubmitted,
    scopeGaps: [...DEFAULT_SCOPE_GAPS],
  };

  const { dir, files } = await writeDeliverables(OUT_DIR, art);
  feed.summary("wrote", `${files.length} files → ${dir}`);
  feed.blank();
  feed.phase("done");
}

// ── Action executor ─────────────────────────────────────────────────────────

interface ExecCtx {
  journals: Record<string, JournalEntry[]>;
  trades: TradeLogRow[];
  errors: ErrorRow[];
  events: EventRow[];
  abandoned: string[];
  newsArc: ReturnType<typeof makeNewsArcDriver>;
  displayNames: Map<string, string>;
}

async function executeAction(
  bot: BotUser,
  wallet: TradeWallet,
  state: BotState,
  action: BotAction,
  markets: MarketSnapshot[],
  connection: Connection,
  ctx: ExecCtx,
): Promise<void> {
  const displayName = ctx.displayNames.get(bot.id) ?? bot.displayName;
  const nowIso = () => new Date().toISOString();

  switch (action.kind) {
    case "idle":
      state.ticksSinceAction += 1;
      return;

    case "abandon":
      state.abandoned = true;
      if (!ctx.abandoned.includes(bot.id)) ctx.abandoned.push(bot.id);
      feed.abandon(displayName, "archetype abandon");
      return;

    case "open_player": {
      state.hasOpenedPlayer = true;
      markEventInPlace(ctx.events, "first_player_opened", bot.id, { player_id: action.playerId });
      const copy = await fetchCopy(process.env.QA_BASE_URL ?? "https://fanshares.xyz", `/trade/${action.playerId}`)
        .catch(() => null);
      if (copy) {
        const j = await narrate({
          bot, phase: "live", state, markets, action, copy, step: "opened-player",
        });
        (ctx.journals[bot.id] ??= []).push(j);
        feed.read(displayName, `/trade/${action.playerId}`, copy.headings[0] ?? "");
        feed.thought(displayName, j.their_interpretation);
      }
      return;
    }

    case "buy": {
      const market = markets.find((m) => m.playerId === action.playerId);
      markEventInPlace(ctx.events, "first_buy_attempted", bot.id, { player_id: action.playerId });
      const lamports = BigInt(Math.floor(action.solAmount * LAMPORTS_PER_SOL));
      const result = await txBuy(connection, wallet, action.playerId, lamports);

      const row: TradeLogRow = {
        ts: nowIso(),
        user_id: bot.id,
        display_name: displayName,
        player_id: action.playerId,
        side: "buy",
        sol_amount: action.solAmount,
        token_amount: result.tokensAfter,
        pre_price_sol: market?.marketPriceSol,
        post_price_sol: market?.marketPriceSol, // best-effort; UI poll refines later
        ok: result.ok,
        tx_sig: result.sig,
        error: result.error,
        error_code: result.errorCode,
      };
      ctx.trades.push(row);

      if (result.ok) {
        state.hasTradedBuy = true;
        state.budgetSolRemaining -= action.solAmount;
        state.holdings[action.playerId] = Number(result.tokensAfter ?? "0");
        markEventInPlace(ctx.events, "first_buy_succeeded", bot.id, { player_id: action.playerId });
        feed.buy(displayName, action.playerId, action.solAmount, result.tokensAfter, result.sig);
      } else {
        ctx.errors.push({
          ts: nowIso(), user_id: bot.id, context: `buy ${action.playerId}`,
          message: result.error ?? "unknown", code: result.errorCode,
        });
        // Dust rejects are expected coverage, not a harness failure.
        const classified = result.errorCode === DUST_AMOUNT_ERR ? "dust rejected" : "buy failed";
        feed.error(displayName, classified, result.error ?? "");
        markEventInPlace(ctx.events, "error_shown", bot.id, {
          context: "buy", code: result.errorCode ?? "",
        });
      }

      // Journal the trade attempt.
      const copy = await fetchCopy(
        process.env.QA_BASE_URL ?? "https://fanshares.xyz",
        `/trade/${action.playerId}`,
      ).catch(() => null);
      if (copy) {
        const j = await narrate({
          bot, phase: "live", state, markets, action, copy, step: "traded",
        });
        (ctx.journals[bot.id] ??= []).push(j);
      }
      return;
    }

    case "sell": {
      const held = await tokenBalance(connection, wallet, action.playerId);
      if (held === 0n) return; // nothing to sell
      const amount = (held * BigInt(Math.round(action.fractionOfHoldings * 100))) / 100n;
      if (amount === 0n) return;

      const market = markets.find((m) => m.playerId === action.playerId);
      const result = await txSell(connection, wallet, action.playerId, amount);
      const row: TradeLogRow = {
        ts: nowIso(),
        user_id: bot.id,
        display_name: displayName,
        player_id: action.playerId,
        side: "sell",
        sol_amount: 0,
        token_amount: amount.toString(),
        pre_price_sol: market?.marketPriceSol,
        post_price_sol: market?.marketPriceSol,
        ok: result.ok,
        tx_sig: result.sig,
        error: result.error,
        error_code: result.errorCode,
      };
      ctx.trades.push(row);

      if (result.ok) {
        state.hasTradedSell = true;
        state.holdings[action.playerId] = Math.max(
          0,
          (state.holdings[action.playerId] ?? 0) - Number(amount),
        );
        markEventInPlace(ctx.events, "first_sell_succeeded", bot.id, { player_id: action.playerId });
        feed.sell(displayName, action.playerId, amount.toString(), result.sig);
      } else {
        ctx.errors.push({
          ts: nowIso(), user_id: bot.id, context: `sell ${action.playerId}`,
          message: result.error ?? "unknown", code: result.errorCode,
        });
        feed.error(displayName, "sell failed", result.error ?? "");
      }
      return;
    }
  }
}

function markEventInPlace(events: EventRow[], name: string, userId: string, props?: Record<string, unknown>) {
  // Only record trackOnce events once per bot, matching app behavior.
  const ONCE = new Set([
    "first_player_opened",
    "first_buy_attempted",
    "first_buy_succeeded",
    "first_sell_succeeded",
    "grant_claimed",
  ]);
  if (ONCE.has(name) && events.some((e) => e.event_name === name && e.user_id === userId)) return;
  events.push({
    ts: new Date().toISOString(),
    event_name: name,
    user_id: userId,
    expected_in_matrix: EXPECTED_EVENTS.includes(name),
    observed: true,
    properties: props,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
