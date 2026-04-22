/**
 * LLM journal narration — turns a rule-based action into an in-character
 * think-aloud record matching the ops spec schema.
 *
 * Input: bot persona + on-page copy + current state + the decided action.
 * Output: JournalEntry matching the ops spec fields:
 *   what_they_read / their_interpretation / their_decision / their_rationale /
 *   confidence / confusion_notes.
 *
 * Demo 0.5 additions (2026-04-22):
 * - Prompt caching via `cache_control: ephemeral` on system + persona prefix
 *   (shared across all 15 agents → ~5-10× input-token savings).
 * - HARD-FAIL when ANTHROPIC_API_KEY is missing (previous silent fallback
 *   was the bug that killed the 2026-04-20 sim — journals all populated
 *   "(fallback: no LLM key set)" and we shipped anyway).
 * - Attention-tracking fields (first_impression_elements, ignored_elements,
 *   emotional_arc_phase) + aesthetic trust triplet (visual_professionalism,
 *   trust_signal_strength, would_show_friend).
 * - `narrateWithVision()` — Sonnet 4.6 multimodal — for visual assessment
 *   via screenshot input.
 *
 * Budget: Sonnet baseline + Haiku iteration (see sim/demo-0.5-onboarding-test-plan.md).
 */

import Anthropic from "@anthropic-ai/sdk";

import type { BotUser } from "./bot-users";
import type { BotAction, BotState, Phase, MarketSnapshot } from "./bot-archetypes";
import type { CopySnapshot } from "./bot-copy-extractor";

export interface JournalEntry {
  ts: string;
  user_id: string;
  step: "landed" | "read-copy" | "clicked-cta" | "opened-player" | "decided" | "traded" | "abandoned" | "home-view" | "feedback-opened" | "tally-submitted";
  what_they_read: string;
  their_interpretation: string;
  their_decision: string;
  their_rationale: string;
  confidence: number; // 0-1
  confusion_notes: string[];
  // Demo 0.5 attention + aesthetic extensions (optional — populated by onboarding-sim.ts)
  first_impression_elements?: string[]; // top 3 things that caught the agent's eye on page load
  ignored_elements?: string[];           // things the page tried to show that the agent didn't engage with
  emotional_arc_phase?: "visceral" | "behavioral" | "reflective"; // per Don Norman's 3 levels
  visual_professionalism?: number;       // 0-10 (vision-based)
  trust_signal_strength?: number;        // 0-10 (vision-based)
  would_show_friend?: number;            // 0-10 (vision-based)
  viewport?: "desktop" | "mobile";       // which viewport the agent saw
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

export interface OnboardingReasoningInput {
  bot: BotUser;
  copy: CopySnapshot;
  step: JournalEntry["step"];
  pageName: "/invite" | "/" | "/trade" | "tally-form";
  viewport: "desktop" | "mobile";
  /** Optional persona overlay — adds onboarding-specific voice guidance. */
  personaOverlay?: string;
}

export interface VisionInput {
  bot: BotUser;
  screenshot: Buffer; // PNG buffer
  pageName: "/invite" | "/" | "/trade" | "tally-form";
  viewport: "desktop" | "mobile";
  step: JournalEntry["step"];
}

const DEFAULT_MODEL = "claude-sonnet-4-6";
function getModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (client) return client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Demo 0.5 requires real LLM reasoning — silent fallback is NOT acceptable (the 2026-04-20 sim had this bug; do not repeat). Set ANTHROPIC_API_KEY in .env.local before running.",
    );
  }
  client = new Anthropic({ apiKey: key });
  return client;
}

/** Verify LLM connectivity. Call once at harness startup for loud early failure. */
export async function verifyLlmReady(): Promise<void> {
  const c = getClient();
  try {
    await c.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 5,
      messages: [{ role: "user", content: "pong" }],
    });
  } catch (err) {
    throw new Error(
      `ANTHROPIC_API_KEY is set but the test call failed: ${err instanceof Error ? err.message : String(err)}. ` +
        `Check key validity + billing tier.`,
    );
  }
}

// ── Trade-sim narration (existing signature — kept for backward compat with game-night.ts) ──

export async function narrate(input: ReasoningInput): Promise<JournalEntry> {
  const c = getClient();
  const ts = new Date().toISOString();
  const prompt = buildTradePrompt(input);
  try {
    const res = await c.messages.create({
      model: getModel(),
      max_tokens: 600,
      temperature: 0.7,
      system: [
        {
          type: "text",
          text: tradeSystemPrompt(),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: prompt }],
    });
    const text = extractText(res);
    const parsed = parseJournal(text);
    return finalizeTradeEntry(ts, input, parsed);
  } catch (err) {
    // Legacy harness expects this to never throw — log and return a minimal entry.
    return {
      ts,
      user_id: input.bot.id,
      step: input.step,
      what_they_read: input.copy.headings[0] ?? input.copy.text.slice(0, 120),
      their_interpretation: `[narration_error] ${err instanceof Error ? err.message : String(err)}`,
      their_decision: describeAction(input.action),
      their_rationale: `${input.bot.archetype} default heuristic (error path)`,
      confidence: 0.3,
      confusion_notes: [`[narration_error] ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

// ── Onboarding-sim narration (Demo 0.5) ────────────────────────────────────────

export async function narrateOnboarding(input: OnboardingReasoningInput): Promise<JournalEntry> {
  const c = getClient();
  const ts = new Date().toISOString();
  const res = await c.messages.create({
    model: getModel(),
    max_tokens: 800,
    temperature: 0.7,
    system: [
      {
        type: "text",
        text: onboardingSystemPrompt(),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: buildOnboardingPrompt(input),
      },
    ],
  });
  const text = extractText(res);
  const parsed = parseJournal(text);
  return {
    ts,
    user_id: input.bot.id,
    step: input.step,
    what_they_read: str(parsed.what_they_read, input.copy.headings[0] ?? input.copy.text.slice(0, 120)),
    their_interpretation: str(parsed.their_interpretation, "(no interpretation)"),
    their_decision: str(parsed.their_decision, "(no explicit decision)"),
    their_rationale: str(parsed.their_rationale, "(no rationale)"),
    confidence: typeof parsed.confidence === "number" ? clamp01(parsed.confidence) : 0.5,
    confusion_notes: Array.isArray(parsed.confusion_notes)
      ? parsed.confusion_notes.map(String).filter(Boolean)
      : [],
    first_impression_elements: asStringArr(parsed.first_impression_elements),
    ignored_elements: asStringArr(parsed.ignored_elements),
    emotional_arc_phase: asArcPhase(parsed.emotional_arc_phase),
    viewport: input.viewport,
  };
}

// ── Vision-based aesthetic + attention assessment (Demo 0.5) ──────────────────

export interface VisionAssessment {
  visual_professionalism: number;
  trust_signal_strength: number;
  trust_inventory_completeness: number; // 2026-04-22 recalibration: separate signal for standard-SaaS trust-anchor completeness, independent of trust_signal_strength.
  would_show_friend: number;
  first_impression_elements: string[];
  ignored_elements: string[];
  visual_notes: string;
}

export async function assessVisuals(input: VisionInput): Promise<VisionAssessment> {
  const c = getClient();
  const b64 = input.screenshot.toString("base64");
  const res = await c.messages.create({
    model: getModel(),
    max_tokens: 500,
    temperature: 0.5,
    system: [
      {
        type: "text",
        text: visionSystemPrompt(),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: b64 },
          },
          {
            type: "text",
            text: buildVisionPrompt(input),
          },
        ],
      },
    ],
  });
  const text = extractText(res);
  const parsed = parseJournal(text);
  return {
    visual_professionalism: asScore10(parsed.visual_professionalism, 5),
    trust_signal_strength: asScore10(parsed.trust_signal_strength, 5),
    trust_inventory_completeness: asScore10(parsed.trust_inventory_completeness, 5),
    would_show_friend: asScore10(parsed.would_show_friend, 5),
    first_impression_elements: asStringArr(parsed.first_impression_elements) ?? [],
    ignored_elements: asStringArr(parsed.ignored_elements) ?? [],
    visual_notes: str(parsed.visual_notes, ""),
  };
}

// ── Prompts ────────────────────────────────────────────────────────────────────

function tradeSystemPrompt(): string {
  return [
    "You are simulating one person trading on a fantasy-finance app called FanShare.",
    "You write short, first-person journal entries in the voice of the persona you're given.",
    "You NEVER speak as the app or as an assistant — only as that one user.",
    "",
    "You must output strict JSON with EXACTLY these keys and no others:",
    "{",
    '  "what_they_read": string,',
    '  "their_interpretation": string,',
    '  "their_decision": string,',
    '  "their_rationale": string,',
    '  "confidence": number,',
    '  "confusion_notes": string[]',
    "}",
    "",
    "Rules:",
    "- Stay in voice. Newbies don't use jargon. Value traders reference spread.",
    "- If the copy uses a term the persona wouldn't know, add it to confusion_notes.",
    "- Be honest about confidence. Skeptics and newbies should often be < 0.5.",
    "- Output ONLY the JSON object. No preamble, no code fences.",
  ].join("\n");
}

function onboardingSystemPrompt(): string {
  return [
    "You are simulating ONE real person landing on the /invite page of FanShare for the first time.",
    "FanShare is a devnet demo: fantasy-style trading of NBA player tokens. No real money.",
    "You think and speak ONLY as this person, in first-person. Never as the app.",
    "",
    "Your job: write a journal entry about what you're seeing, what you think it means,",
    "what you'd do next, and what confused you — in your persona's voice.",
    "",
    "Demo 0.5 focus (onboarding only, no trading yet):",
    "- Does the page make it clear what FanShare is?",
    "- Does the $100 offer feel trustworthy or sketchy?",
    "- Would you click 'Claim $100' or bail?",
    "- What words / concepts confused you?",
    "- What grabbed your attention first? What did you ignore?",
    "",
    "Output strict JSON with these keys:",
    "{",
    '  "what_they_read": string,                // 1-2 sentences naming the copy you actually saw',
    '  "their_interpretation": string,          // 1-2 sentences, in voice — what you think it means',
    '  "their_decision": string,                // 1 sentence — what you\'d do next',
    '  "their_rationale": string,               // 1-2 sentences — why, in voice',
    '  "confidence": number,                    // 0.0-1.0 — how sure you are of your interpretation',
    '  "confusion_notes": string[],             // terms/CTAs you flagged as unclear; [] if none',
    '  "first_impression_elements": string[],   // top 3 things that caught your eye (e.g. "big orange Claim $100 button", "NBA player emojis in ticker")',
    '  "ignored_elements": string[],            // things on the page you didn\'t engage with (e.g. "small \'About this demo\' link", "terms section")',
    '  "emotional_arc_phase": string            // one of "visceral" (first 5s gut reaction), "behavioral" (trying to figure out what to do), "reflective" (thinking through implications)',
    "}",
    "",
    "Rules: Stay in voice. Be honest. Flag confusion even when the persona is crypto-fluent.",
    "Output ONLY the JSON object. No preamble, no code fences.",
  ].join("\n");
}

function visionSystemPrompt(): string {
  return [
    "You are looking at a screenshot of a web app landing page as if you were the person",
    "described in the next message. You are NOT evaluating the product's pitch — you are",
    "evaluating the VISUAL quality and trust cues.",
    "",
    "Score `trust_signal_strength` honestly: would you, as this persona, trust this page",
    "with your time and attention? Account for everything you see — craft (typography,",
    "hierarchy, color, spacing), identity signals (logo, brand presence, who-built-this),",
    "social proof, professionalism, and any red-flags. Do not anchor to any expected",
    "score range. A great page can score 9-10. A mediocre page should score 4-6. A page",
    "with serious trust gaps should score 1-3. Use the full 0-10 range.",
    "",
    "Score `trust_inventory_completeness` separately as a descriptive measurement (not a",
    "trust signal): how complete is the standard SaaS trust inventory (logo + nav + about",
    "+ social-proof + below-fold product preview)? 10 = fully equipped homepage; 0 = bare",
    "single-CTA landing. This is INDEPENDENT of trust_signal_strength — record what is",
    "objectively present, regardless of whether you think the page needs it.",
    "",
    "Output strict JSON with these keys:",
    "{",
    '  "visual_professionalism": number,         // 0-10 — does it look designed by pros or thrown-together?',
    '  "trust_signal_strength": number,          // 0-10 — honest trust score, full range, no anchor',
    '  "trust_inventory_completeness": number,   // 0-10 — descriptive: completeness of standard SaaS trust inventory. Independent of trust_signal_strength.',
    '  "would_show_friend": number,              // 0-10 — would you screenshot this and show a friend as something cool, or be embarrassed?',
    '  "first_impression_elements": string[],    // top 3 things that caught your eye visually',
    '  "ignored_elements": string[],             // visual elements the page tried to show you that you did not engage with',
    '  "visual_notes": string                    // 1-3 sentences on what the visual does well or badly',
    "}",
    "",
    "Rules:",
    "- Rate what you SEE, not what you READ.",
    "- Be honest — a 6/10 is 6/10. Don't flatter. Don't penalize.",
    "- If mobile viewport: note mobile-specific visual issues (touch-target size, scroll depth before CTA).",
    "- Output ONLY the JSON object. No preamble, no code fences.",
  ].join("\n");
}

function buildTradePrompt(input: ReasoningInput): string {
  const { bot, phase, state, action, copy, markets, step } = input;
  const marketSummary = markets
    .slice(0, 8)
    .map(
      (m) =>
        `  - ${m.playerId}: market ${m.marketPriceSol.toFixed(6)} SOL, fair ${m.fairValueSol.toFixed(6)} SOL` +
        (m.latestHeadline ? ` — news: ${m.latestHeadline}` : ""),
    )
    .join("\n");
  return [
    `Persona: ${bot.displayName} (${bot.city}, archetype: ${bot.archetype}).`,
    `Persona voice guide: ${bot.personaPrompt}`,
    "",
    `Game phase: ${phase}. Step in flow: ${step}.`,
    `Budget remaining: ${state.budgetSolRemaining.toFixed(3)} SOL.`,
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
    `Action this persona is about to take: ${describeAction(action)}`,
    "",
    `Output the JSON journal entry.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildOnboardingPrompt(input: OnboardingReasoningInput): string {
  const { bot, copy, step, pageName, viewport, personaOverlay } = input;
  return [
    `Persona: ${bot.displayName} (${bot.city}, archetype: ${bot.archetype}).`,
    `Persona voice guide: ${bot.personaPrompt}`,
    personaOverlay ? `Onboarding overlay: ${personaOverlay}` : "",
    "",
    `Page: ${pageName}. Viewport: ${viewport}. Step in flow: ${step}.`,
    "",
    `Visible page URL: ${copy.url}`,
    copy.headings.length > 0 ? `Headings you see: ${copy.headings.join(" | ")}` : "",
    copy.ctas.length > 0 ? `Buttons/links visible: ${copy.ctas.join(", ")}` : "",
    `Visible page text (truncated):`,
    `"""`,
    copy.text,
    `"""`,
    "",
    `Output the JSON journal entry, in your persona voice.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildVisionPrompt(input: VisionInput): string {
  return [
    `You are: ${input.bot.displayName} (${input.bot.archetype}).`,
    `Voice guide: ${input.bot.personaPrompt}`,
    "",
    `Page: ${input.pageName}. Viewport: ${input.viewport}. Flow step: ${input.step}.`,
    "",
    `The screenshot above is what you're looking at right now. Rate the visual quality and trust cues, in persona voice, as JSON.`,
  ].join("\n");
}

// ── Helpers ────────────────────────────────────────────────────────────────────

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

function parseJournal(text: string): Record<string, unknown> {
  const stripped = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function finalizeTradeEntry(
  ts: string,
  input: ReasoningInput,
  parsed: Record<string, unknown>,
): JournalEntry {
  return {
    ts,
    user_id: input.bot.id,
    step: input.step,
    what_they_read: str(parsed.what_they_read, "(model did not return copy summary)"),
    their_interpretation: str(parsed.their_interpretation, "(no interpretation)"),
    their_decision: str(parsed.their_decision, describeAction(input.action)),
    their_rationale: str(parsed.their_rationale, "(no rationale)"),
    confidence: typeof parsed.confidence === "number" ? clamp01(parsed.confidence) : 0.5,
    confusion_notes: asStringArr(parsed.confusion_notes) ?? [],
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

function asStringArr(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.map(String).map((s) => s.trim()).filter(Boolean);
}

function asArcPhase(v: unknown): "visceral" | "behavioral" | "reflective" | undefined {
  return v === "visceral" || v === "behavioral" || v === "reflective" ? v : undefined;
}

function asScore10(v: unknown, fallback: number): number {
  if (typeof v !== "number") return fallback;
  return Math.max(0, Math.min(10, v));
}
