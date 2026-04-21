/**
 * Post-run deliverables writer.
 *
 * Writes to a run-scoped directory (default: `../fanshare-ops/growth/data/sim-run-<date>/`,
 * overridable via --out-dir) the exact bundle the ops spec Section 5 asks for:
 *
 *   - trades.csv           one row per buy/sell attempt
 *   - oracle-updates.csv   news-arc events + resulting on-chain prices
 *   - errors.csv           all failures + dust rejects (for classification)
 *   - events.csv           PostHog export of the 11 custom events (if PostHog
 *                          env vars set; otherwise a stub header so the
 *                          verification step runs manually)
 *   - journals/<user>.json per-user action journal + checkpoint answers
 *   - summary.md           one-page synthesis
 */

import * as fs from "fs";
import * as path from "path";

import type { JournalEntry } from "./bot-reasoning";
import type { CheckpointAnswer } from "./bot-checkpoint";
import type { BotUser } from "./bot-users";
import type { NewsArcLogEntry } from "./news-arc";

export interface TradeLogRow {
  ts: string;
  user_id: string;
  display_name: string;
  player_id: string;
  side: "buy" | "sell";
  sol_amount: number;
  token_amount?: string;
  pre_price_sol?: number;
  post_price_sol?: number;
  ok: boolean;
  tx_sig?: string;
  error?: string;
  error_code?: string;
}

export interface ErrorRow {
  ts: string;
  user_id: string;
  context: string;
  message: string;
  code?: string;
}

export interface EventRow {
  ts: string;
  event_name: string;
  user_id: string;
  expected_in_matrix: boolean;
  observed: boolean;
  properties?: Record<string, unknown>;
}

/** The canonical 11 events per app/lib/analytics/track.ts (matches ops spec). */
export const EXPECTED_EVENTS: readonly string[] = [
  "invite_page_viewed",
  "invite_cta_clicked",
  "terms_expanded",
  "about_demo_clicked",
  "grant_claimed",
  "first_player_opened",
  "first_buy_attempted",
  "first_buy_succeeded",
  "first_sell_succeeded",
  "error_shown",
  "feedback_opened",
];

export interface RunArtifacts {
  runId: string;
  startedAt: string;
  endedAt: string;
  seed: string | number;
  baseUrl: string;
  bots: readonly BotUser[];
  trades: TradeLogRow[];
  errors: ErrorRow[];
  journals: Record<string, JournalEntry[]>; // user_id → entries
  checkpoints: Record<string, CheckpointAnswer>;
  newsArc: NewsArcLogEntry[];
  events: EventRow[]; // optional — can be empty if PostHog export pending
  abandoned: string[]; // user_ids who abandoned the flow
  tallySubmitted: boolean;
  scopeGaps: string[];
}

export async function writeDeliverables(
  outDir: string,
  art: RunArtifacts,
): Promise<{ dir: string; files: string[] }> {
  fs.mkdirSync(outDir, { recursive: true });
  const journalsDir = path.join(outDir, "journals");
  fs.mkdirSync(journalsDir, { recursive: true });

  const files: string[] = [];

  files.push(writeCsv(path.join(outDir, "trades.csv"), art.trades));
  files.push(writeCsv(path.join(outDir, "oracle-updates.csv"), art.newsArc));
  files.push(writeCsv(path.join(outDir, "errors.csv"), art.errors));
  files.push(writeCsv(path.join(outDir, "events.csv"), art.events));

  for (const [userId, entries] of Object.entries(art.journals)) {
    const checkpoint = art.checkpoints[userId];
    const payload = { user_id: userId, entries, checkpoint: checkpoint ?? null };
    const file = path.join(journalsDir, `${userId}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    files.push(file);
  }

  const summaryPath = path.join(outDir, "summary.md");
  fs.writeFileSync(summaryPath, renderSummary(art));
  files.push(summaryPath);

  return { dir: outDir, files };
}

function writeCsv(file: string, rows: unknown[]): string {
  if (rows.length === 0) {
    fs.writeFileSync(file, "");
    return file;
  }
  const cols = Array.from(
    new Set(rows.flatMap((r) => Object.keys(r as Record<string, unknown>))),
  );
  const header = cols.join(",");
  const body = rows
    .map((r) => cols.map((c) => csvCell((r as Record<string, unknown>)[c])).join(","))
    .join("\n");
  fs.writeFileSync(file, header + "\n" + body + "\n");
  return file;
}

function csvCell(v: unknown): string {
  if (v === undefined || v === null) return "";
  const s = typeof v === "string" ? v : typeof v === "bigint" ? v.toString() : JSON.stringify(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function renderSummary(art: RunArtifacts): string {
  const counts = countBy(art.trades, (t) => (t.ok ? t.side : `${t.side}_fail`));
  const registered = Object.keys(art.journals).length;
  const errorTotal = art.errors.length;

  const observedEvents = Array.from(new Set(art.events.filter((e) => e.observed).map((e) => e.event_name)));
  const missingEvents = EXPECTED_EVENTS.filter((e) => !observedEvents.includes(e));

  const topConfusion = rankConfusion(art.journals).slice(0, 5);
  const wrongModels = Object.values(art.checkpoints).filter((c) => c.flagged_wrong);

  return [
    `# Game-Night Rehearsal — Summary (${art.runId})`,
    ``,
    `**Started:** ${art.startedAt}  `,
    `**Ended:** ${art.endedAt}  `,
    `**Seed:** ${art.seed}  `,
    `**Base URL:** ${art.baseUrl}  `,
    `**Bots registered:** ${registered} / ${art.bots.length}`,
    ``,
    `## System health`,
    ``,
    `| Subsystem | Result |`,
    `|---|---|`,
    `| Registration | ${registered === art.bots.length ? "PASS" : "FAIL"} — ${registered}/${art.bots.length} |`,
    `| Buys succeeded | ${counts["buy"] ?? 0} |`,
    `| Sells succeeded | ${counts["sell"] ?? 0} |`,
    `| Failures (any) | ${errorTotal} |`,
    `| Abandoned users | ${art.abandoned.length} (${art.abandoned.join(", ") || "none"}) |`,
    `| Tally submission | ${art.tallySubmitted ? "PASS (hidden fields populated)" : "NOT SUBMITTED"} |`,
    ``,
    `## PostHog 11-event verification`,
    ``,
    `| Event | Observed |`,
    `|---|---|`,
    ...EXPECTED_EVENTS.map(
      (e) => `| \`${e}\` | ${observedEvents.includes(e) ? "YES" : "**MISSING**"} |`,
    ),
    ``,
    missingEvents.length === 0
      ? `All 11 events fired during run window.`
      : `**MISSING EVENTS:** ${missingEvents.join(", ")} — open a new observability handoff before Demo 0.5.`,
    ``,
    `## Top 5 copy / clarity issues (from journal rationale)`,
    ``,
    topConfusion.length === 0
      ? `_No confusion notes flagged._`
      : topConfusion.map((r, i) => `${i + 1}. **${r.term}** — flagged ${r.count}× by: ${r.flaggedBy.join(", ")}`).join("\n"),
    ``,
    `## Top 3 mental-model errors (from halftime checkpoint)`,
    ``,
    wrongModels.length === 0
      ? `_No critically-wrong mental models flagged by the model._`
      : wrongModels
          .slice(0, 3)
          .map((c, i) => `${i + 1}. **${c.user_id}** — confidence ${c.overall_confidence.toFixed(2)}. Q4 answer: "${c.q4_fair_vs_market}"`)
          .join("\n"),
    ``,
    `## Scope gaps — not covered by this sim`,
    ``,
    art.scopeGaps.map((g) => `- ${g}`).join("\n"),
    ``,
    `## Go/no-go for Demo 0.5`,
    ``,
    missingEvents.length === 0 && errorTotal < 3 && registered === art.bots.length
      ? `**GO** — all subsystems clean, events verified, rerun once to confirm stability.`
      : `**NO-GO** — address blockers listed above, then rerun full game night.`,
    ``,
  ].join("\n");
}

function rankConfusion(journals: Record<string, JournalEntry[]>): {
  term: string;
  count: number;
  flaggedBy: string[];
}[] {
  const tally = new Map<string, { count: number; users: Set<string> }>();
  for (const [userId, entries] of Object.entries(journals)) {
    for (const e of entries) {
      for (const note of e.confusion_notes) {
        const key = note.slice(0, 60);
        const row = tally.get(key) ?? { count: 0, users: new Set() };
        row.count += 1;
        row.users.add(userId);
        tally.set(key, row);
      }
    }
  }
  return Array.from(tally.entries())
    .map(([term, r]) => ({ term, count: r.count, flaggedBy: Array.from(r.users) }))
    .sort((a, b) => b.count - a.count);
}

function countBy<T>(arr: T[], keyOf: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of arr) {
    const k = keyOf(x);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export const DEFAULT_SCOPE_GAPS: readonly string[] = [
  "Invite message receipt / first-click-from-SMS-or-DM moment",
  "Mobile viewport (bot runs desktop only)",
  "Slow network / offline mid-transaction",
  "Safari / iOS quirks (headless Chromium only)",
  "Screen reader / keyboard-only navigation",
  "Real 'is this a scam?' gut reaction",
  "Social dynamics — seeing peers trade, FOMO",
  "Real-money loss aversion (devnet money doesn't bite)",
];
