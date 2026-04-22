/**
 * Demo 0.5 — Onboarding Mental Model Sim (LLM + Playwright, multi-viewport).
 *
 * Orchestrator for the 2026-04-22 reviewed plan at
 * /tech/sim/demo-0.5-onboarding-test-plan.md.
 *
 * Scope (IN): /invite landing comprehension, /api/demo/register flow,
 *   homepage first-impression, Tally feedback (hidden fields passthrough),
 *   6 onboarding-side PostHog events.
 * Scope (OUT): /trade pages, buy/sell, bonding curve, 5 trade-side trackOnce events.
 *
 * Run:
 *   ANTHROPIC_API_KEY=...                 # required — hard-fail if missing
 *   ANTHROPIC_MODEL=claude-sonnet-4-6     # or claude-haiku-4-5-20251001 (iteration runs)
 *   QA_BASE_URL=https://<preview-url>     # run against Vercel preview, not prod
 *   npx tsx scripts/qa/onboarding-sim.ts
 *
 * Flags:
 *   --agents <N>            total agents (default 15)
 *   --mobile-share <f>      fraction on mobile viewport (default 0.25 → 3-4 of 15)
 *   --stagger-ms <N>        start-stagger per agent in ms (default 2000)
 *   --dry-run               do the harness walkthrough but don't submit Tally
 *   --seed <str>            override QA_SEED (default today)
 *   --out-dir <path>        artifacts dir (default analytics/sim-runs/<today>/)
 *   --smoke                 1 agent, desktop only — smoke test
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../../.env.local"),
  override: true, // .env.local is source of truth; stale shell env must not win
});

import { chromium, type Browser, type BrowserContext, type Page, devices } from "playwright";

import { BOT_USERS, type BotUser } from "./bot-users";
import { narrateOnboarding, assessVisuals, verifyLlmReady, type JournalEntry } from "./bot-reasoning";
import { checkpoint, type CheckpointAnswer } from "./bot-checkpoint";
import type { CopySnapshot } from "./bot-copy-extractor";
import { feed } from "./bot-feed";
import { makeRng } from "../lib/seeded-rng";
import { EXPECTED_EVENTS, type EventRow, type ErrorRow } from "./bot-deliverables";

// ── Args + env ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const arg = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const BASE_URL = process.env.QA_BASE_URL ?? "https://fanshares.xyz";
const SEED = arg("seed") ?? process.env.QA_SEED ?? new Date().toISOString().slice(0, 10);
const DRY_RUN = flag("dry-run");
const SMOKE = flag("smoke");
const TOTAL_AGENTS = SMOKE ? 1 : parseInt(arg("agents") ?? "15", 10);
const MOBILE_SHARE = SMOKE ? 0 : parseFloat(arg("mobile-share") ?? "0.25");
const STAGGER_MS = parseInt(arg("stagger-ms") ?? "2000", 10);
const TODAY = new Date().toISOString().slice(0, 10);
const OUT_DIR =
  arg("out-dir") ??
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../analytics/sim-runs",
    TODAY,
  );

// Persona overlay — reframes trade-focused bot voices for onboarding use.
// Maps existing archetypes to the 5 design personas from the reviewed plan.
const ONBOARDING_OVERLAY: Record<BotUser["archetype"], string> = {
  hype: "You are landing on /invite for the first time as someone who knows crypto basics AND follows NBA. You've seen token pages before. Is FanShare legit? What's your first reaction? You care MORE about whether the vibe is premium + trustworthy than whether the trade math is fair — you're seeing this BEFORE any trades happen.",
  value: "You are landing on /invite for the first time. You own some SOL, you watch playoffs casually but don't know every roster. Can you tell what FanShare IS just from /invite? Does the $100 offer feel like a scam or genuine? You haven't even seen a trade page yet — today is purely about first impression.",
  newbie: "You are landing on /invite for the first time. You love basketball but have NEVER owned crypto. Words like 'wallet', 'SOL', 'devnet' mean nothing to you yet. Does /invite explain enough to make you comfortable clicking 'Claim $100', or does it feel like you'd be in over your head? Flag every unfamiliar word.",
  skeptic: "You are landing on /invite for the first time with 'is this a scam?' as your default posture. Look for red flags. But also: what trust signals WOULD convince you this is legitimate? What's on the page now, what's missing? You haven't clicked anything yet.",
  power: "You are landing on /invite for the first time as someone who uses multiple crypto apps daily. Efficiency first: how fast can you tell what this is? Is the copy tight or bloated? What would make you NOT click?",
};

// Design-trust probes — appended to every onboarding narration.
const DESIGN_TRUST_PROBES = [
  "Does this page feel professional, or thrown-together?",
  "Would you screenshot this to show a friend as something cool, or would you be embarrassed to?",
  "Does it look safe enough to eventually connect any real money to?",
  "Rate aesthetic quality 0-10 before reading any copy — purely first-impression visual.",
];

// ── Main ──────────────────────────────────────────────────────────────────────

interface AgentResult {
  bot: BotUser;
  viewport: "desktop" | "mobile";
  walletAddress?: string;
  journal: JournalEntry[];
  checkpoint?: CheckpointAnswer;
  visualAssessments: Array<{ page: string; step: string; data: unknown }>;
  events: EventRow[];
  errors: ErrorRow[];
  screenshotsDir: string;
  tallySubmitted: boolean;
  smoothness: { fired: string[]; missing: string[] };
}

async function main() {
  feed.phase(`demo 0.5 — onboarding mental model sim`);
  feed.summary("Base URL", BASE_URL);
  feed.summary("Model", process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6");
  feed.summary("Agents", `${TOTAL_AGENTS}${SMOKE ? " (smoke)" : ""}`);
  feed.summary("Mobile share", SMOKE ? "0" : MOBILE_SHARE.toString());
  feed.summary("Stagger", `${STAGGER_MS} ms`);
  feed.summary("Dry run", String(DRY_RUN));
  feed.summary("Out dir", OUT_DIR);
  feed.summary("Seed", String(SEED));
  feed.blank();

  // 1. Verify LLM is ready — HARD FAIL before spawning anything else.
  feed.info("preflight", "verifying LLM connectivity...");
  await verifyLlmReady();
  feed.info("preflight", "✓ LLM ready");

  // 2. Verify Playwright chromium is installed.
  feed.info("preflight", "launching Chromium...");
  const browser = await chromium.launch({ headless: true });
  feed.info("preflight", "✓ Chromium launched");

  // 3. Prepare dirs.
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, "screenshots"), { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, "journals"), { recursive: true });

  // 4. Select agents + assign viewports.
  const rootRng = makeRng(SEED);
  const selectedBots = BOT_USERS.slice(0, TOTAL_AGENTS);
  const mobileCount = Math.floor(selectedBots.length * MOBILE_SHARE);
  // Fisher-Yates shuffle via rootRng, take first N
  const shuffled = [...selectedBots.map((b) => b.id)];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rootRng.intBetween(0, i);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const mobileBotIds = new Set(shuffled.slice(0, mobileCount));

  feed.summary("Desktop bots", `${selectedBots.length - mobileCount}`);
  feed.summary("Mobile bots", `${mobileCount}`);
  feed.blank();

  // 5. Run agents with stagger.
  feed.phase("running agents");
  const results: AgentResult[] = [];
  const startTime = new Date().toISOString();

  // Kick off agents with stagger — but let them run concurrently after kickoff.
  const agentPromises: Promise<AgentResult>[] = [];
  for (let i = 0; i < selectedBots.length; i++) {
    const bot = selectedBots[i];
    const viewport = mobileBotIds.has(bot.id) ? "mobile" : "desktop";
    // Stagger kickoff.
    await sleep(STAGGER_MS);
    agentPromises.push(runAgent(bot, viewport, browser).catch((err) => {
      feed.error(bot.displayName, "agent-fatal", err instanceof Error ? err.message : String(err));
      return emptyResult(bot, viewport, err instanceof Error ? err : new Error(String(err)));
    }));
  }

  // Wait for all agents to finish.
  const settled = await Promise.all(agentPromises);
  results.push(...settled);

  await browser.close();
  const endTime = new Date().toISOString();
  feed.phase("all agents complete");

  // 6. Write deliverables.
  writeDeliverables(results, startTime, endTime);
  feed.phase("done");
}

// ── Per-agent runner ──────────────────────────────────────────────────────────

async function runAgent(
  bot: BotUser,
  viewport: "desktop" | "mobile",
  browser: Browser,
): Promise<AgentResult> {
  const agentDir = path.join(OUT_DIR, "screenshots", bot.id);
  fs.mkdirSync(agentDir, { recursive: true });

  const journal: JournalEntry[] = [];
  const events: EventRow[] = [];
  const errors: ErrorRow[] = [];
  const visualAssessments: AgentResult["visualAssessments"] = [];
  let walletAddress: string | undefined;
  let tallySubmitted = false;
  let stepCount = 0;
  let cp: CheckpointAnswer | undefined; // hoisted so it survives the try/finally scope

  const vpConfig = viewport === "mobile"
    ? devices["iPhone 13"]
    : { viewport: { width: 1280, height: 800 } };

  const context: BrowserContext = await browser.newContext({
    ...vpConfig,
    // Record network for debugging Tally hidden field passthrough
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();
  feed.info(`${bot.id}·${viewport}`, `starting (persona: ${bot.archetype})`);

  async function snapStep(stepName: string): Promise<string> {
    stepCount++;
    const file = path.join(agentDir, `step-${String(stepCount).padStart(2, "0")}-${stepName}.png`);
    try {
      await page.screenshot({ path: file, fullPage: false });
    } catch (err) {
      errors.push({
        ts: new Date().toISOString(),
        user_id: bot.id,
        context: `screenshot:${stepName}`,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    return file;
  }

  function markEvent(name: string, props?: Record<string, unknown>) {
    events.push({
      ts: new Date().toISOString(),
      event_name: name,
      user_id: bot.id,
      expected_in_matrix: EXPECTED_EVENTS.includes(name),
      observed: true,
      properties: { viewport, ...props },
    });
  }

  try {
    // ── STEP 1: land on /invite ───────────────────────────────────────────────
    await page.goto(`${BASE_URL}/invite`, { waitUntil: "networkidle", timeout: 60000 });
    const landingFile = await snapStep("landed");
    markEvent("invite_page_viewed");

    const inviteCopy = await extractCopy(page);

    // LLM: text-based onboarding journal entry
    journal.push(await narrateOnboarding({
      bot,
      copy: inviteCopy,
      step: "landed",
      pageName: "/invite",
      viewport,
      personaOverlay: ONBOARDING_OVERLAY[bot.archetype],
    }));
    feed.read(`${bot.id}·${viewport}`, "/invite", inviteCopy.headings[0] ?? "");
    feed.thought(`${bot.id}·${viewport}`, journal[journal.length - 1].their_interpretation);

    // LLM: vision-based aesthetic assessment
    try {
      const png = fs.readFileSync(landingFile);
      const assessment = await assessVisuals({ bot, screenshot: png, pageName: "/invite", viewport, step: "landed" });
      visualAssessments.push({ page: "/invite", step: "landed", data: assessment });
      // Inject trust scores into the journal entry for this step
      const last = journal[journal.length - 1];
      last.visual_professionalism = assessment.visual_professionalism;
      last.trust_signal_strength = assessment.trust_signal_strength;
      last.would_show_friend = assessment.would_show_friend;
      // Also backfill attention fields from vision if not already populated
      if (!last.first_impression_elements || last.first_impression_elements.length === 0) {
        last.first_impression_elements = assessment.first_impression_elements;
      }
      if (!last.ignored_elements || last.ignored_elements.length === 0) {
        last.ignored_elements = assessment.ignored_elements;
      }
    } catch (err) {
      errors.push({
        ts: new Date().toISOString(), user_id: bot.id,
        context: "vision:/invite", message: err instanceof Error ? err.message : String(err),
      });
    }

    // ── STEP 2: skeptics may expand terms / click "About this demo" ───────────
    if (bot.flags?.expandTerms) {
      // Try to click a "How it works" or similar terms expander
      try {
        const termsLoc = page.locator("text=/how it works|terms/i").first();
        if (await termsLoc.isVisible({ timeout: 2000 }).catch(() => false)) {
          await termsLoc.click({ timeout: 3000 });
          markEvent("terms_expanded");
          await snapStep("terms-expanded");
        }
      } catch {
        /* not clickable, skip */
      }
    }
    if (bot.flags?.openAboutDemo) {
      try {
        const aboutLoc = page.locator("text=/about this demo/i").first();
        if (await aboutLoc.isVisible({ timeout: 2000 }).catch(() => false)) {
          markEvent("about_demo_clicked");
        }
      } catch {
        /* skip */
      }
    }

    // ── STEP 3: click "Claim $100" → opens modal → fill name → Start Trading ──
    // The actual onboarding flow:
    //   Click "Claim $100" → opens "Try FanShare" modal with name input
    //   → fill name → click "Start Trading →" → wallet created + redirect to /
    try {
      const claimLoc = page.locator("button", { hasText: /claim .*\$100/i }).first();
      await claimLoc.click({ timeout: 10000 });
      markEvent("invite_cta_clicked");
      await snapStep("modal-opened");

      // Wait for modal: look for the "Start Trading" button
      const startTradingBtn = page.locator("button", { hasText: /start trading/i }).first();
      const modalVisible = await startTradingBtn.isVisible({ timeout: 5000 }).catch(() => false);

      if (modalVisible) {
        // Fill the name field. Personas submit their own display name for the demo.
        const nameField = page.locator("input[placeholder*='Jordan'], input[type='text']").first();
        if (await nameField.isVisible({ timeout: 2000 }).catch(() => false)) {
          await nameField.fill(bot.displayName, { timeout: 3000 });
        }
        // Click Start Trading
        await startTradingBtn.click({ timeout: 5000 });

        // Wait for navigation to home (URL should no longer be /invite)
        await page.waitForFunction(
          () => !window.location.pathname.includes("/invite"),
          { timeout: 30000 },
        ).catch(() => { /* tolerate stale URL */ });
        await snapStep("grant-claimed");

        // Read wallet from localStorage
        const walletJson = await page.evaluate(() => localStorage.getItem("fanshare_demo")).catch(() => null);
        if (walletJson) {
          try {
            const parsed = JSON.parse(walletJson) as { address?: string };
            walletAddress = parsed.address;
            markEvent("grant_claimed", { wallet: walletAddress });
          } catch {
            markEvent("grant_claimed");
          }
        } else {
          // Fall back: CTA was clicked, even if localStorage read failed
          markEvent("grant_claimed");
        }
      } else {
        errors.push({
          ts: new Date().toISOString(), user_id: bot.id,
          context: "modal-not-visible",
          message: "Claim $100 clicked but 'Start Trading' modal never appeared within 5s",
        });
      }
    } catch (err) {
      errors.push({
        ts: new Date().toISOString(), user_id: bot.id,
        context: "click:claim-$100-flow", message: err instanceof Error ? err.message : String(err),
      });
    }

    // ── STEP 4: first impression of home page ────────────────────────────────
    if (!page.url().includes("/invite")) {
      const homeCopy = await extractCopy(page);
      journal.push(await narrateOnboarding({
        bot,
        copy: homeCopy,
        step: "home-view",
        pageName: "/",
        viewport,
        personaOverlay: ONBOARDING_OVERLAY[bot.archetype],
      }));
      const homeFile = await snapStep("home-view");
      try {
        const png = fs.readFileSync(homeFile);
        const assessment = await assessVisuals({ bot, screenshot: png, pageName: "/", viewport, step: "home-view" });
        visualAssessments.push({ page: "/", step: "home-view", data: assessment });
        const last = journal[journal.length - 1];
        last.visual_professionalism = assessment.visual_professionalism;
        last.trust_signal_strength = assessment.trust_signal_strength;
        last.would_show_friend = assessment.would_show_friend;
      } catch {
        /* vision optional */
      }
    }

    // ── STEP 5: mid-flow mental-model checkpoint ─────────────────────────────
    try {
      cp = await checkpoint(bot, inviteCopy, null);
      if (cp) feed.checkpoint(`${bot.id}·${viewport}`, cp.q4_fair_vs_market);
    } catch (err) {
      errors.push({
        ts: new Date().toISOString(), user_id: bot.id,
        context: "checkpoint", message: err instanceof Error ? err.message : String(err),
      });
    }

    // ── STEP 6: click Feedback button (Tally) ─────────────────────────────────
    // Only skeptics + specific flagged bots submit, but we click the button for
    // all — feedback_opened fires per observability handoff regardless of submit.
    try {
      const feedbackLoc = page.locator("button[aria-label=\"Send feedback\"]").first();
      if (await feedbackLoc.isVisible({ timeout: 3000 }).catch(() => false)) {
        await feedbackLoc.click({ timeout: 5000 });
        markEvent("feedback_opened");
        await page.waitForTimeout(2000); // wait for Tally popup iframe to load
        await snapStep("feedback-opened");

        // Submit Tally only if persona flag says so AND not dry-run.
        if (bot.flags?.submitsTally && !DRY_RUN) {
          const submitted = await tryTallySubmit(page, bot).catch(() => false);
          tallySubmitted = submitted;
          if (submitted) await snapStep("tally-submitted");
        }
      }
    } catch (err) {
      errors.push({
        ts: new Date().toISOString(), user_id: bot.id,
        context: "click:feedback", message: err instanceof Error ? err.message : String(err),
      });
    }

    feed.info(`${bot.id}·${viewport}`, `done — ${events.length} events, ${journal.length} journal entries`);
  } catch (err) {
    errors.push({
      ts: new Date().toISOString(), user_id: bot.id, context: "agent-main",
      message: err instanceof Error ? err.message : String(err),
    });
    feed.error(`${bot.id}·${viewport}`, "agent crashed", err instanceof Error ? err.message : String(err));
  } finally {
    await context.close();
  }

  // Compute smoothness
  const firedEventNames = Array.from(new Set(events.map((e) => e.event_name)));
  const onboardingEvents = ["invite_page_viewed", "terms_expanded", "about_demo_clicked", "invite_cta_clicked", "grant_claimed", "feedback_opened"];
  const missing = onboardingEvents.filter((e) => !firedEventNames.includes(e));

  return {
    bot, viewport, walletAddress, journal, checkpoint: cp,
    visualAssessments, events, errors, screenshotsDir: agentDir, tallySubmitted,
    smoothness: { fired: firedEventNames, missing },
  };
}

// ── Extractors + helpers ──────────────────────────────────────────────────────

async function extractCopy(page: Page): Promise<CopySnapshot> {
  const url = page.url();
  const text = await page.evaluate(() => {
    const doc = document.body;
    if (!doc) return "";
    const clone = doc.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("script, style, noscript, svg, path").forEach((el) => el.remove());
    return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
  });
  const headings = await page.locator("h1, h2, h3").allTextContents().then((arr) =>
    arr.map((s) => s.trim()).filter(Boolean).slice(0, 6),
  );
  const ctas = await page.locator("button, a[role='button'], a[href]").allTextContents().then((arr) => {
    const uniq = Array.from(new Set(arr.map((s) => s.trim()).filter((s) => s.length > 0 && s.length < 60)));
    return uniq.slice(0, 12);
  });
  return {
    url,
    fetchedAt: Date.now(),
    text: text.length > 4000 ? text.slice(0, 4000) + "…" : text,
    headings,
    ctas,
  };
}

async function tryTallySubmit(page: Page, bot: BotUser): Promise<boolean> {
  try {
    const tallyFrame = page.frameLocator('iframe[src*="tally.so"]').first();
    // Fill each visible textbox/textarea with persona-specific placeholder.
    const placeholder = `[demo-0.5 agent ${bot.id} (${bot.archetype}) auto-submission 2026-04-22]`;
    await tallyFrame.locator("textarea, input[type='text']").first().fill(placeholder, { timeout: 5000 });
    // Click Submit.
    const submitBtn = tallyFrame.locator("button", { hasText: /submit|send/i }).first();
    if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await submitBtn.click({ timeout: 5000 });
      await page.waitForTimeout(3000);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function emptyResult(bot: BotUser, viewport: "desktop" | "mobile", err: Error): AgentResult {
  return {
    bot,
    viewport,
    journal: [],
    events: [],
    errors: [{ ts: new Date().toISOString(), user_id: bot.id, context: "spawn", message: err.message }],
    visualAssessments: [],
    screenshotsDir: "",
    tallySubmitted: false,
    smoothness: { fired: [], missing: [] },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Deliverables ───────────────────────────────────────────────────────────────

function writeDeliverables(
  results: AgentResult[],
  startedAt: string,
  endedAt: string,
): void {
  // 1. Per-agent journal JSON
  for (const r of results) {
    const file = path.join(OUT_DIR, "journals", `${r.bot.id}.json`);
    fs.writeFileSync(file, JSON.stringify({
      user_id: r.bot.id,
      display_name: r.bot.displayName,
      archetype: r.bot.archetype,
      viewport: r.viewport,
      wallet_address: r.walletAddress,
      entries: r.journal,
      checkpoint: r.checkpoint ?? null,
      visual_assessments: r.visualAssessments,
      tally_submitted: r.tallySubmitted,
      smoothness: r.smoothness,
    }, null, 2));
  }

  // 2. events.csv
  const allEvents = results.flatMap((r) => r.events);
  writeCsv(path.join(OUT_DIR, "events.csv"), allEvents);

  // 3. errors.csv
  const allErrors = results.flatMap((r) => r.errors);
  writeCsv(path.join(OUT_DIR, "errors.csv"), allErrors);

  // 4. summary.md — design-actionable first per plan review
  const summary = renderSummary(results, startedAt, endedAt);
  fs.writeFileSync(path.join(OUT_DIR, "summary.md"), summary);

  feed.summary("wrote", `${results.length} journals + events.csv + errors.csv + summary.md → ${OUT_DIR}`);
}

function writeCsv(file: string, rows: unknown[]): void {
  if (rows.length === 0) {
    fs.writeFileSync(file, "");
    return;
  }
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r as Record<string, unknown>))));
  const header = cols.join(",");
  const body = rows
    .map((r) => cols.map((c) => csvCell((r as Record<string, unknown>)[c])).join(","))
    .join("\n");
  fs.writeFileSync(file, header + "\n" + body + "\n");
}

function csvCell(v: unknown): string {
  if (v === undefined || v === null) return "";
  const s = typeof v === "string" ? v : typeof v === "bigint" ? v.toString() : JSON.stringify(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function renderSummary(results: AgentResult[], startedAt: string, endedAt: string): string {
  const total = results.length;
  const desktop = results.filter((r) => r.viewport === "desktop");
  const mobile = results.filter((r) => r.viewport === "mobile");
  const grantClaimed = results.filter((r) => r.walletAddress).length;
  const feedbackOpened = results.filter((r) => r.smoothness.fired.includes("feedback_opened")).length;
  const tallySubmitted = results.filter((r) => r.tallySubmitted).length;

  // Aggregate first-impression + confusion
  const firstImpressions = new Map<string, number>();
  const ignored = new Map<string, number>();
  const confusion = new Map<string, number>();
  for (const r of results) {
    for (const j of r.journal) {
      for (const el of j.first_impression_elements ?? []) {
        firstImpressions.set(el, (firstImpressions.get(el) ?? 0) + 1);
      }
      for (const el of j.ignored_elements ?? []) {
        ignored.set(el, (ignored.get(el) ?? 0) + 1);
      }
      for (const note of j.confusion_notes ?? []) {
        confusion.set(note, (confusion.get(note) ?? 0) + 1);
      }
    }
  }

  const sorted = (m: Map<string, number>) =>
    Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Aesthetic trust distribution (first assessment per agent = /invite)
  const trust = results
    .map((r) => r.visualAssessments[0]?.data as { visual_professionalism?: number; trust_signal_strength?: number; trust_inventory_completeness?: number; would_show_friend?: number } | undefined)
    .filter((x): x is NonNullable<typeof x> => !!x);
  const mean = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const median = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const prof = trust.map((t) => t.visual_professionalism ?? 5);
  const tsig = trust.map((t) => t.trust_signal_strength ?? 5);
  const tinv = trust.map((t) => t.trust_inventory_completeness ?? 5);
  const wshw = trust.map((t) => t.would_show_friend ?? 5);

  return [
    `# Demo 0.5 — Onboarding Sim Summary`,
    ``,
    `**Started:** ${startedAt}  `,
    `**Ended:** ${endedAt}  `,
    `**Base URL:** ${BASE_URL}  `,
    `**Model:** ${process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6"}  `,
    `**Agents:** ${total} (${desktop.length} desktop, ${mobile.length} mobile)`,
    ``,
    `---`,
    ``,
    `## 1. Top 5 first-impression elements (visual, aggregated across agents)`,
    ``,
    ...(sorted(firstImpressions).length === 0
      ? ["_no data_"]
      : sorted(firstImpressions).map(([k, v], i) => `${i + 1}. **${k}** — noticed by ${v}/${total} agents`)),
    ``,
    `## 2. Top 5 ignored elements (the page tried to show, agents didn't engage)`,
    ``,
    ...(sorted(ignored).length === 0
      ? ["_no data_"]
      : sorted(ignored).map(([k, v], i) => `${i + 1}. **${k}** — ignored by ${v}/${total} agents`)),
    ``,
    `## 3. Top 5 confusion points (vocabulary + unclear CTAs)`,
    ``,
    ...(sorted(confusion).length === 0
      ? ["_no data_"]
      : sorted(confusion).map(([k, v], i) => `${i + 1}. **${k}** — flagged by ${v} agent(s)`)),
    ``,
    `## 4. Aesthetic trust baseline (/invite vision assessments)`,
    ``,
    `| Metric | Mean | Median |`,
    `|---|---|---|`,
    `| visual_professionalism | ${mean(prof).toFixed(1)} / 10 | ${median(prof).toFixed(1)} |`,
    `| trust_signal_strength | ${mean(tsig).toFixed(1)} / 10 | ${median(tsig).toFixed(1)} |`,
    `| trust_inventory_completeness | ${mean(tinv).toFixed(1)} / 10 | ${median(tinv).toFixed(1)} |`,
    `| would_show_friend | ${mean(wshw).toFixed(1)} / 10 | ${median(wshw).toFixed(1)} |`,
    ``,
    `## 5. Desktop vs Mobile — funnel split`,
    ``,
    `| Cohort | N | grant_claimed | feedback_opened | tally_submitted |`,
    `|---|---|---|---|---|`,
    `| Desktop | ${desktop.length} | ${desktop.filter((r) => r.walletAddress).length} | ${desktop.filter((r) => r.smoothness.fired.includes("feedback_opened")).length} | ${desktop.filter((r) => r.tallySubmitted).length} |`,
    `| Mobile | ${mobile.length} | ${mobile.filter((r) => r.walletAddress).length} | ${mobile.filter((r) => r.smoothness.fired.includes("feedback_opened")).length} | ${mobile.filter((r) => r.tallySubmitted).length} |`,
    ``,
    `## 6. Event firing matrix (6 onboarding-side events)`,
    ``,
    ...["invite_page_viewed", "terms_expanded", "about_demo_clicked", "invite_cta_clicked", "grant_claimed", "feedback_opened"].map(
      (e) => `- \`${e}\`: ${results.filter((r) => r.smoothness.fired.includes(e)).length}/${total} agents`,
    ),
    ``,
    `## 7. Errors`,
    ``,
    results.flatMap((r) => r.errors).length === 0
      ? "_no errors recorded_"
      : `Total: ${results.flatMap((r) => r.errors).length}. See errors.csv for details.`,
    ``,
    `## 8. Next step: designer pass`,
    ``,
    `Run \`npx tsx scripts/qa/design-pass.ts --dir ${OUT_DIR}\` to produce the DESIGN_SYSTEM.md violations report from the captured screenshots.`,
    ``,
    `## 9. Next step: cross-reference`,
    ``,
    `Run \`npx tsx scripts/qa/cross-reference.ts --dir ${OUT_DIR}\` to join events + journals + Tally submissions by session_id.`,
    ``,
  ].join("\n");
}

// ── Entry ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
