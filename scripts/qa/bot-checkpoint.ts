/**
 * Halftime mental-model checkpoint.
 *
 * From ops spec Section 2: at the halftime pause each bot answers 4 open-ended
 * questions verbatim. Per ops spec this is "the single highest-signal artifact
 * from the sim" — a wrong answer from a non-newbie persona = a copy problem.
 *
 * Model call: one per bot, ~15 calls total. Same model + fallback pattern as
 * bot-reasoning.ts.
 */

import Anthropic from "@anthropic-ai/sdk";

import type { BotUser } from "./bot-users";
import type { CopySnapshot } from "./bot-copy-extractor";

export const CHECKPOINT_QUESTIONS = [
  "What am I actually buying when I buy a player token?",
  "What makes the price go up or down?",
  "If I hold LeBron for a week and don't sell, what happens?",
  "What does 'fair value' vs 'market price' mean here?",
] as const;

export interface CheckpointAnswer {
  ts: string;
  user_id: string;
  q1_what_am_i_buying: string;
  q2_what_moves_price: string;
  q3_hold_week: string;
  q4_fair_vs_market: string;
  overall_confidence: number;
  flagged_wrong: boolean; // orchestrator may set true after review; model sets initial guess
}

const MODEL = "claude-sonnet-4-6";

export async function checkpoint(
  bot: BotUser,
  inviteCopy: CopySnapshot | null,
  playerCopy: CopySnapshot | null,
): Promise<CheckpointAnswer> {
  const ts = new Date().toISOString();
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fallback(ts, bot);

  const client = new Anthropic({ apiKey: key });
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      temperature: 0.6,
      system: systemPrompt(),
      messages: [{ role: "user", content: userPrompt(bot, inviteCopy, playerCopy) }],
    });
    const first = res.content[0];
    const text = first && first.type === "text" ? first.text.trim() : "{}";
    const parsed = tryJson(text);
    return {
      ts,
      user_id: bot.id,
      q1_what_am_i_buying: str(parsed.q1_what_am_i_buying, "(no answer)"),
      q2_what_moves_price: str(parsed.q2_what_moves_price, "(no answer)"),
      q3_hold_week: str(parsed.q3_hold_week, "(no answer)"),
      q4_fair_vs_market: str(parsed.q4_fair_vs_market, "(no answer)"),
      overall_confidence:
        typeof parsed.overall_confidence === "number"
          ? Math.max(0, Math.min(1, parsed.overall_confidence))
          : 0.5,
      flagged_wrong: parsed.flagged_wrong === true,
    };
  } catch (err) {
    return {
      ...fallback(ts, bot),
      q1_what_am_i_buying: `[error] ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function systemPrompt(): string {
  return [
    "You are role-playing one user of a fantasy-finance app called FanShare.",
    "You answer 4 open-ended questions in the user's own voice. You DO NOT know anything",
    "more than what the app has shown you. If the app hasn't explained something, you",
    "don't magically know it — answer as the persona, guessing or admitting confusion.",
    "",
    "Output strict JSON with EXACTLY these keys:",
    "{",
    '  "q1_what_am_i_buying": string,',
    '  "q2_what_moves_price": string,',
    '  "q3_hold_week": string,',
    '  "q4_fair_vs_market": string,',
    '  "overall_confidence": number,   // 0.0 to 1.0',
    '  "flagged_wrong": boolean        // true if the user suspects their own mental model is wrong',
    "}",
    "",
    "No preamble, no code fences. Each answer 1-3 sentences in persona voice.",
  ].join("\n");
}

function userPrompt(
  bot: BotUser,
  inviteCopy: CopySnapshot | null,
  playerCopy: CopySnapshot | null,
): string {
  return [
    `Persona: ${bot.displayName} (${bot.archetype}, from ${bot.city}).`,
    `Voice guide: ${bot.personaPrompt}`,
    "",
    "Copy you have seen so far on the app:",
    inviteCopy ? `/invite page text: ${inviteCopy.text}` : "(no invite copy loaded)",
    "",
    playerCopy ? `Trade page text: ${playerCopy.text}` : "(no trade page copy loaded)",
    "",
    "Now answer these 4 questions in your own voice, as the persona:",
    "",
    ...CHECKPOINT_QUESTIONS.map((q, i) => `${i + 1}. ${q}`),
    "",
    "Return the JSON object.",
  ].join("\n");
}

function tryJson(text: string): Record<string, unknown> {
  const stripped = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function str(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  return s.length > 0 ? s : fallback;
}

function fallback(ts: string, bot: BotUser): CheckpointAnswer {
  return {
    ts,
    user_id: bot.id,
    q1_what_am_i_buying: "(fallback: no LLM key set)",
    q2_what_moves_price: "(fallback)",
    q3_hold_week: "(fallback)",
    q4_fair_vs_market: "(fallback)",
    overall_confidence: 0.5,
    flagged_wrong: false,
  };
}
