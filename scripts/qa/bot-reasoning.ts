/**
 * LLM journal narration — turns a rule-based action into an in-character
 * think-aloud record matching the ops spec schema.
 *
 * Input: bot persona + on-page copy + current state + the decided action.
 * Output: JournalEntry matching the ops spec fields:
 *   what_they_read / their_interpretation / their_decision / their_rationale /
 *   confidence / confusion_notes.
 *
 * Model: Claude Sonnet 4.6 (claude-sonnet-4-6). Temperature non-zero — variety
 * in narration is the *point*. Decisions upstream are seeded, so two runs
 * produce the same action trace with slightly different language.
 *
 * Budget guard: ~200 calls per rehearsal (~$5-8). If `ANTHROPIC_API_KEY` is
 * missing, we fall back to a template-based narrator so the script still runs
 * end-to-end for pure harness debugging.
 */

import Anthropic from "@anthropic-ai/sdk";

import type { BotUser } from "./bot-users";
import type { BotAction, BotState, Phase, MarketSnapshot } from "./bot-archetypes";
import type { CopySnapshot } from "./bot-copy-extractor";

export interface JournalEntry {
  ts: string;
  user_id: string;
  step: "landed" | "read-copy" | "clicked-cta" | "opened-player" | "decided" | "traded" | "abandoned";
  what_they_read: string;
  their_interpretation: string;
  their_decision: string;
  their_rationale: string;
  confidence: number; // 0-1
  confusion_notes: string[];
}

export interface ReasoningInput {
  bot: BotUser;
  phase: Phase;
  state: BotState;
  markets: MarketSnapshot[];
  action: BotAction;
  copy: CopySnapshot;
  step: JournalEntry["step"];
}

const MODEL = "claude-sonnet-4-6";

let clientPromise: Promise<Anthropic | null> | null = null;
function getClient(): Promise<Anthropic | null> {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return null;
    return new Anthropic({ apiKey: key });
  })();
  return clientPromise;
}

export async function narrate(input: ReasoningInput): Promise<JournalEntry> {
  const client = await getClient();
  const ts = new Date().toISOString();

  if (!client) return fallbackEntry(ts, input);

  const prompt = buildPrompt(input);
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      temperature: 0.7,
      system: systemPrompt(),
      messages: [{ role: "user", content: prompt }],
    });
    const text = extractText(res);
    const parsed = parseJournal(text);
    return finalize(ts, input, parsed);
  } catch (err) {
    // Never let narration failure kill the run — fallback + flag.
    return {
      ...fallbackEntry(ts, input),
      confusion_notes: [
        `[narration_error] ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }
}

function systemPrompt(): string {
  return [
    "You are simulating one person trading on a fantasy-finance app called FanShare.",
    "You write short, first-person journal entries in the voice of the persona you're given.",
    "You NEVER speak as the app or as an assistant — only as that one user.",
    "",
    "You must output strict JSON with EXACTLY these keys and no others:",
    "{",
    '  "what_they_read": string,          // 1-2 sentences summarizing copy they actually saw',
    '  "their_interpretation": string,    // 1-2 sentences — in-character, what they think it means',
    '  "their_decision": string,          // 1 short sentence naming the action they took',
    '  "their_rationale": string,         // 1-2 sentences — why, in their own voice',
    '  "confidence": number,              // 0.0 to 1.0',
    '  "confusion_notes": string[]        // terms/CTAs/numbers they flagged unclear; [] if none',
    "}",
    "",
    "Rules:",
    "- Stay in voice. Newbies don't use jargon. Value traders reference spread.",
    "- If the copy uses a term the persona wouldn't know (e.g. 'lamports', 'bonding curve'),",
    "  add it to confusion_notes in their words. Don't invent jargon that isn't on-screen.",
    "- Be honest about confidence. Skeptics and newbies should often be < 0.5.",
    "- Output ONLY the JSON object. No preamble, no code fences.",
  ].join("\n");
}

function buildPrompt(input: ReasoningInput): string {
  const { bot, phase, state, action, copy, markets, step } = input;

  const marketSummary = markets
    .slice(0, 8)
    .map(
      (m) =>
        `  - ${m.playerId}: market ${m.marketPriceSol.toFixed(6)} SOL, fair ${m.fairValueSol.toFixed(6)} SOL` +
        (m.latestHeadline ? ` — news: ${m.latestHeadline}` : ""),
    )
    .join("\n");

  const actionDescription = describeAction(action);

  return [
    `Persona: ${bot.displayName} (${bot.city}, archetype: ${bot.archetype}).`,
    `Persona voice guide: ${bot.personaPrompt}`,
    "",
    `Game phase: ${phase}. Step in flow: ${step}.`,
    `Budget remaining: ${state.budgetSolRemaining.toFixed(3)} SOL. ` +
      `Has opened a player page: ${state.hasOpenedPlayer}. Has bought: ${state.hasTradedBuy}. ` +
      `Has sold: ${state.hasTradedSell}.`,
    "",
    `Visible page URL: ${copy.url}`,
    copy.headings.length > 0 ? `Headings: ${copy.headings.join(" | ")}` : "",
    copy.ctas.length > 0 ? `Buttons/links visible: ${copy.ctas.join(", ")}` : "",
    `Visible page text (truncated):`,
    `"""`,
    copy.text,
    `"""`,
    "",
    `Market snapshot:`,
    marketSummary || "  (none loaded yet)",
    "",
    `Action this persona is about to take: ${actionDescription}`,
    "",
    `Output the JSON journal entry.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function describeAction(a: BotAction): string {
  switch (a.kind) {
    case "idle":
      return `idle (${a.why})`;
    case "open_player":
      return `open the trade page for ${a.playerId}`;
    case "buy":
      return `buy ${a.solAmount.toFixed(4)} SOL worth of ${a.playerId}${a.dust ? " (dust amount — expected to fail)" : ""}`;
    case "sell":
      return `sell ${Math.round(a.fractionOfHoldings * 100)}% of holdings in ${a.playerId}`;
    case "abandon":
      return `abandon the session`;
  }
}

function extractText(res: Anthropic.Messages.Message): string {
  const first = res.content[0];
  if (!first || first.type !== "text") return "{}";
  return first.text.trim();
}

function parseJournal(text: string): Partial<JournalEntry> {
  // Tolerate an outer code fence even though we asked for none.
  const stripped = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(stripped);
  } catch {
    return {};
  }
}

function finalize(ts: string, input: ReasoningInput, parsed: Partial<JournalEntry>): JournalEntry {
  return {
    ts,
    user_id: input.bot.id,
    step: input.step,
    what_they_read: str(parsed.what_they_read, "(model did not return copy summary)"),
    their_interpretation: str(parsed.their_interpretation, "(no interpretation)"),
    their_decision: str(parsed.their_decision, describeAction(input.action)),
    their_rationale: str(parsed.their_rationale, "(no rationale)"),
    confidence: typeof parsed.confidence === "number" ? clamp01(parsed.confidence) : 0.5,
    confusion_notes: Array.isArray(parsed.confusion_notes)
      ? parsed.confusion_notes.map(String).filter(Boolean)
      : [],
  };
}

function fallbackEntry(ts: string, input: ReasoningInput): JournalEntry {
  return {
    ts,
    user_id: input.bot.id,
    step: input.step,
    what_they_read: input.copy.headings[0] ?? input.copy.text.slice(0, 120),
    their_interpretation: "(fallback: no LLM key set)",
    their_decision: describeAction(input.action),
    their_rationale: `${input.bot.archetype} default heuristic`,
    confidence: 0.5,
    confusion_notes: [],
  };
}

function str(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const s = v.trim();
  return s.length > 0 ? s : fallback;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
