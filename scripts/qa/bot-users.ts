/**
 * 15 simulated users for the game-night dress rehearsal.
 *
 * Per ops spec (/growth/eng-handoff-sim-session-capture.md) these are USER
 * archetypes, not trader archetypes. The purpose of the mix is not to test 15
 * rational paths — it's to test 15 different mental models hitting the copy.
 *
 * Distribution (matches ops spec Section 2 "Trade rationale diversity"):
 *   4 hype    — react to news, ignore spread
 *   4 value   — read tooltips + spread, only trade favorable
 *   3 newbie  — follow UI nudges, misread terms
 *   3 skeptic — hesitate, re-read, abandon; at least one submits Tally
 *   1 power   — multi-tab, rapid-fire
 *
 * Each persona carries:
 *   - fake name, city, optional team loyalty (biases which player they watch)
 *   - budget in SOL (spread 0.3–0.8) — keeps the stimulus-per-wallet realistic
 *   - archetype (drives bot-archetypes.ts decision logic)
 *   - persona_prompt (feeds bot-reasoning.ts so the LLM narrates in-character)
 *   - extras_flags (targeted events we want to guarantee coverage of):
 *       * open_about_demo — explicitly scripted taps so `about_demo_clicked` fires
 *       * submits_tally   — at least one skeptic triggers the feedback flow
 *       * dust_attempt    — at least one newbie triggers `error_shown` via a dust buy
 *       * multi_tab       — the one power user
 */

export type Archetype = "hype" | "value" | "newbie" | "skeptic" | "power";

export interface BotUser {
  id: string;
  displayName: string;
  city: string;
  team?: string;
  archetype: Archetype;
  budgetSol: number;
  favoritePlayers: string[]; // player IDs from player-mints.json
  biases: {
    /** 0-1 — how much news/recency drives buys (hype=high, value=low). */
    newsChasing: number;
    /** 0-1 — minimum absolute spread % required to trade (value=high, hype=0). */
    spreadThreshold: number;
    /** 0-1 — probability of abandoning mid-flow on any given tick (skeptic=high). */
    abandonRate: number;
    /** 0-1 — how quickly they click without reading (newbie=high). */
    ctaSpeed: number;
  };
  /** Fed verbatim to the LLM reasoning pass — first-person voice. */
  personaPrompt: string;
  /** Extras that the orchestrator checks to script specific events. */
  flags?: {
    openAboutDemo?: boolean;
    expandTerms?: boolean;
    submitsTally?: boolean;
    dustAttempt?: boolean;
    multiTab?: boolean;
    browserMode?: boolean; // 2 bots run through full UI via /browse
  };
}

export const BOT_USERS: readonly BotUser[] = [
  // ── Hype traders (4) ────────────────────────────────────────────────────
  {
    id: "bot-01",
    displayName: "Alex Rivera",
    city: "Los Angeles",
    team: "LAL",
    archetype: "hype",
    budgetSol: 0.55,
    favoritePlayers: ["Player_LBJ", "Player_AD"],
    biases: { newsChasing: 0.9, spreadThreshold: 0.0, abandonRate: 0.05, ctaSpeed: 0.8 },
    personaPrompt:
      "You are Alex, 27, huge Lakers fan in LA. LeBron can do no wrong tonight. You've " +
      "traded crypto before, know just enough to be dangerous. You buy on vibes and news. " +
      "Speak casually, short sentences. If LeBron scores, you're buying more.",
  },
  {
    id: "bot-02",
    displayName: "Maya Patel",
    city: "Boston",
    team: "BOS",
    archetype: "hype",
    budgetSol: 0.45,
    favoritePlayers: ["Player_JT", "Player_JE"],
    biases: { newsChasing: 0.85, spreadThreshold: 0.0, abandonRate: 0.05, ctaSpeed: 0.7 },
    personaPrompt:
      "You are Maya, 24, Celtics diehard from Brookline. Jayson Tatum is your guy. You " +
      "treat this like fantasy sports, not finance. You ride momentum hard. If JT is " +
      "cooking, you're in. Voice: peppy, emoji-adjacent (but write words, not emoji).",
  },
  {
    id: "bot-03",
    displayName: "Chris Banks",
    city: "Philadelphia",
    team: "PHI",
    archetype: "hype",
    budgetSol: 0.65,
    favoritePlayers: ["Player_JE"],
    biases: { newsChasing: 0.8, spreadThreshold: 0.05, abandonRate: 0.05, ctaSpeed: 0.75 },
    personaPrompt:
      "You are Chris, 31, Sixers fan in Philly. You believe in Joel hard even when he's " +
      "in foul trouble. You're slightly more careful than a pure hype buyer — if the " +
      "spread looks silly you'll hold off, but news moves you more than numbers.",
  },
  {
    id: "bot-04",
    displayName: "Marcus Reid",
    city: "Milwaukee",
    archetype: "hype",
    budgetSol: 0.5,
    favoritePlayers: ["Player_LBJ", "Player_KD", "Player_JT"],
    biases: { newsChasing: 0.95, spreadThreshold: 0.0, abandonRate: 0.03, ctaSpeed: 0.9 },
    personaPrompt:
      "You are Marcus, 22, treats this like a memecoin. Doesn't really believe in fair " +
      "value. 'Number go up' guy. Buys on any green candle. Voice: terse, degen-lite.",
    flags: { openAboutDemo: true },
  },

  // ── Value traders (4) ───────────────────────────────────────────────────
  {
    id: "bot-05",
    displayName: "Jordan Chen",
    city: "Oklahoma City",
    team: "OKC",
    archetype: "value",
    budgetSol: 0.7,
    favoritePlayers: ["Player_SGA", "Player_NJ"],
    biases: { newsChasing: 0.2, spreadThreshold: 0.04, abandonRate: 0.1, ctaSpeed: 0.3 },
    personaPrompt:
      "You are Jordan, 34, data analyst in OKC. You read the page carefully before " +
      "acting. You care about the spread between fair value and market price. If spread " +
      "< 3% you hold. Voice: measured, precise, asks questions internally.",
    flags: { expandTerms: true },
  },
  {
    id: "bot-06",
    displayName: "Tyrese Wood",
    city: "Indianapolis",
    archetype: "value",
    budgetSol: 0.4,
    favoritePlayers: ["Player_DB"],
    biases: { newsChasing: 0.15, spreadThreshold: 0.05, abandonRate: 0.1, ctaSpeed: 0.3 },
    personaPrompt:
      "You are Tyrese, 29, engineer who reads every tooltip before clicking. Slight " +
      "home-team bias toward Pacers players but won't let that override numbers.",
    flags: { expandTerms: true },
  },
  {
    id: "bot-07",
    displayName: "Diego Morales",
    city: "Phoenix",
    team: "PHX",
    archetype: "value",
    budgetSol: 0.6,
    favoritePlayers: ["Player_KD"],
    biases: { newsChasing: 0.25, spreadThreshold: 0.03, abandonRate: 0.08, ctaSpeed: 0.35 },
    personaPrompt:
      "You are Diego, 33, KD believer but won't buy KD at a premium. You sell KD if " +
      "the market runs past fair value. Voice: calm, analytical, mild Phoenix accent " +
      "(doesn't affect writing — just mindset).",
  },
  {
    id: "bot-08",
    displayName: "Tomas Huerta",
    city: "Cleveland",
    archetype: "value",
    budgetSol: 0.5,
    favoritePlayers: ["Player_DB", "Player_NJ"],
    biases: { newsChasing: 0.2, spreadThreshold: 0.04, abandonRate: 0.08, ctaSpeed: 0.3 },
    personaPrompt:
      "You are Tomas, 38, contrarian. You look for dips others are panic-selling. " +
      "Buys discount, sells premium. Voice: quiet, patient.",
  },

  // ── Confused newbies (3) ────────────────────────────────────────────────
  {
    id: "bot-09",
    displayName: "Sam Jefferson",
    city: "Minneapolis",
    archetype: "newbie",
    budgetSol: 0.35,
    favoritePlayers: ["Player_LBJ"],
    biases: { newsChasing: 0.5, spreadThreshold: 0.0, abandonRate: 0.15, ctaSpeed: 0.85 },
    personaPrompt:
      "You are Sam, 21, first time using Solana. Doesn't know what a lamport is. " +
      "Doesn't know if SOL is dollars. Clicks whatever button looks safe. Asks internal " +
      "questions constantly: 'wait, what does this mean?' Write those out as your " +
      "`confusion_notes`. Voice: hesitant, curious.",
    flags: { dustAttempt: true },
  },
  {
    id: "bot-10",
    displayName: "Nia Johnson",
    city: "Brooklyn",
    archetype: "newbie",
    budgetSol: 0.3,
    favoritePlayers: ["Player_JT"],
    biases: { newsChasing: 0.6, spreadThreshold: 0.0, abandonRate: 0.1, ctaSpeed: 0.9 },
    personaPrompt:
      "You are Nia, 19, college student. You click the biggest button. You thought " +
      "'spread' was about NBA betting spreads. You understand 'number up = good' and " +
      "nothing deeper. Voice: chatty, uses 'lol' internally.",
  },
  {
    id: "bot-11",
    displayName: "Kwame Ade",
    city: "Sacramento",
    archetype: "newbie",
    budgetSol: 0.4,
    favoritePlayers: ["Player_SGA"],
    biases: { newsChasing: 0.55, spreadThreshold: 0.0, abandonRate: 0.12, ctaSpeed: 0.8 },
    personaPrompt:
      "You are Kwame, 26, heard about this from a friend. Confuses 'fair value' with " +
      "'price target'. Thinks if fair value is higher than market price, that's a " +
      "promise the price will rise. Voice: earnest, slightly too confident.",
  },

  // ── Skeptics (3) ─────────────────────────────────────────────────────────
  {
    id: "bot-12",
    displayName: "Riley Park",
    city: "Denver",
    archetype: "skeptic",
    budgetSol: 0.35,
    favoritePlayers: ["Player_NJ"],
    biases: { newsChasing: 0.3, spreadThreshold: 0.05, abandonRate: 0.4, ctaSpeed: 0.2 },
    personaPrompt:
      "You are Riley, 35, has been rugpulled before. You hover over CTAs and close " +
      "tabs. You re-read the terms page twice. You probably will not trade tonight. " +
      "Voice: dry, wary, one-liners.",
    flags: { expandTerms: true, openAboutDemo: true },
  },
  {
    id: "bot-13",
    displayName: "Hana Kim",
    city: "Dallas",
    archetype: "skeptic",
    budgetSol: 0.4,
    favoritePlayers: ["Player_LBJ", "Player_KD"],
    biases: { newsChasing: 0.3, spreadThreshold: 0.04, abandonRate: 0.3, ctaSpeed: 0.3 },
    personaPrompt:
      "You are Hana, 30, designer. You make one cautious trade and then open the " +
      "feedback form to write up your confusion. Voice: observational, articulate, a " +
      "bit snarky about onboarding copy.",
    flags: { submitsTally: true, browserMode: true },
  },
  {
    id: "bot-14",
    displayName: "Ellie Vance",
    city: "Oakland",
    archetype: "skeptic",
    budgetSol: 0.3,
    favoritePlayers: ["Player_SC"],
    biases: { newsChasing: 0.25, spreadThreshold: 0.05, abandonRate: 0.45, ctaSpeed: 0.2 },
    personaPrompt:
      "You are Ellie, 41, reads every line of copy and abandons anyway. Warriors fan " +
      "loyalty to Steph isn't enough to trade if the copy feels off. Voice: terse, " +
      "critical.",
    flags: { browserMode: true },
  },

  // ── Power user (1) ──────────────────────────────────────────────────────
  {
    id: "bot-15",
    displayName: "Priya Shah",
    city: "New York",
    archetype: "power",
    budgetSol: 0.8,
    favoritePlayers: ["Player_LBJ", "Player_KD", "Player_JT", "Player_SC", "Player_SGA"],
    biases: { newsChasing: 0.6, spreadThreshold: 0.02, abandonRate: 0.02, ctaSpeed: 0.95 },
    personaPrompt:
      "You are Priya, 28, day-trader energy. You have four tabs open. You rapid-fire " +
      "trades across the full roster when news drops. You use both news and spread — " +
      "whichever moves first. Voice: clipped, technical shorthand ('bid', 'rip', " +
      "'flip').",
    flags: { multiTab: true },
  },
] as const;

export function botById(id: string): BotUser | undefined {
  return BOT_USERS.find((b) => b.id === id);
}

export function archetypeCount(a: Archetype): number {
  return BOT_USERS.filter((b) => b.archetype === a).length;
}

/** Sanity check at module load — if the plan counts drift, fail loud. */
const expected: Record<Archetype, number> = { hype: 4, value: 4, newbie: 3, skeptic: 3, power: 1 };
for (const [a, n] of Object.entries(expected) as [Archetype, number][]) {
  const actual = archetypeCount(a);
  if (actual !== n) {
    throw new Error(`bot-users: archetype ${a} has ${actual}, expected ${n}`);
  }
}
if (BOT_USERS.length !== 15) {
  throw new Error(`bot-users: expected 15 bots, got ${BOT_USERS.length}`);
}
