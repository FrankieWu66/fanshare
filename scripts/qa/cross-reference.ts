/**
 * Demo 0.5 post-run cross-reference.
 *
 * Joins the three artifact sources for each agent so we can verify
 * passthrough between PostHog, agent journal, and Tally submission:
 *   - harness agent_id → PostHog distinct_id (from events.csv, if exported)
 *   - harness agent_id → Tally session_id hidden field (from Tally dashboard export)
 *   - harness agent_id → screenshot dir
 *
 * Output: unified.csv — one row per agent with all linkage columns.
 * If PostHog / Tally exports aren't available yet, the script still emits
 * the harness-side rows and leaves those columns blank (so the operator can
 * paste in values manually from the dashboards).
 *
 * Run:
 *   npx tsx scripts/qa/cross-reference.ts --dir analytics/sim-runs/YYYY-MM-DD
 *
 * Flags:
 *   --dir <path>              required — directory from a completed run
 *   --posthog-export <path>   optional — PostHog events CSV export
 *   --tally-export <path>     optional — Tally submissions CSV export
 */

import * as fs from "fs";
import * as path from "path";

const argv = process.argv.slice(2);
const arg = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const DIR_ARG = arg("dir");
const POSTHOG_EXPORT = arg("posthog-export");
const TALLY_EXPORT = arg("tally-export");

if (!DIR_ARG) {
  console.error("ERROR: --dir required. Example: --dir analytics/sim-runs/2026-04-22");
  process.exit(1);
}
const DIR: string = DIR_ARG;

if (!fs.existsSync(DIR)) {
  console.error(`ERROR: dir does not exist: ${DIR}`);
  process.exit(1);
}

// ── Load harness data ─────────────────────────────────────────────────────────

const journalsDir = path.join(DIR, "journals");
if (!fs.existsSync(journalsDir)) {
  console.error(`ERROR: no journals/ in ${DIR}. Run onboarding-sim first.`);
  process.exit(1);
}

interface AgentRow {
  agent_id: string;
  display_name: string;
  archetype: string;
  viewport: string;
  wallet_address: string;
  journal_entry_count: number;
  events_fired: string; // comma-joined
  tally_submitted: string;
  screenshots_dir: string;
  // Optional columns populated if exports provided
  posthog_distinct_id?: string;
  tally_session_id?: string;
  tally_hidden_fields_populated?: string; // "yes" | "partial" | "no"
  cross_ref_status?: string; // "linked" | "missing_posthog" | "missing_tally" | "no_exports"
}

const agentFiles = fs.readdirSync(journalsDir).filter((f) => f.endsWith(".json"));
const agents: AgentRow[] = [];
for (const file of agentFiles) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(journalsDir, file), "utf-8")) as {
      user_id: string;
      display_name?: string;
      archetype?: string;
      viewport?: string;
      wallet_address?: string;
      entries: unknown[];
      tally_submitted?: boolean;
      smoothness?: { fired?: string[] };
    };
    agents.push({
      agent_id: j.user_id,
      display_name: j.display_name ?? "",
      archetype: j.archetype ?? "",
      viewport: j.viewport ?? "desktop",
      wallet_address: j.wallet_address ?? "",
      journal_entry_count: Array.isArray(j.entries) ? j.entries.length : 0,
      events_fired: (j.smoothness?.fired ?? []).join("|"),
      tally_submitted: j.tally_submitted ? "yes" : "no",
      screenshots_dir: path.join(DIR, "screenshots", j.user_id),
    });
  } catch (err) {
    console.error(`WARN: failed to parse ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(`Loaded ${agents.length} agents from harness journals`);

// ── Optional: load PostHog export + link by wallet_address ────────────────────

if (POSTHOG_EXPORT) {
  if (!fs.existsSync(POSTHOG_EXPORT)) {
    console.warn(`WARN: posthog export not found: ${POSTHOG_EXPORT}`);
  } else {
    const csv = fs.readFileSync(POSTHOG_EXPORT, "utf-8");
    const rows = parseCsv(csv);
    // PostHog export: expect columns like distinct_id, event, properties.wallet, etc.
    // Link by wallet_address (our grant_claimed event writes wallet to props).
    for (const agent of agents) {
      if (!agent.wallet_address) continue;
      const match = rows.find((r) => typeof r["properties"] === "string" && r["properties"].includes(agent.wallet_address));
      if (match) {
        agent.posthog_distinct_id = match["distinct_id"] || match["person_distinct_id"] || "";
      }
    }
    const linked = agents.filter((a) => a.posthog_distinct_id).length;
    console.log(`Linked ${linked}/${agents.length} agents to PostHog distinct_id`);
  }
}

// ── Optional: load Tally export + link by session_id ──────────────────────────

if (TALLY_EXPORT) {
  if (!fs.existsSync(TALLY_EXPORT)) {
    console.warn(`WARN: tally export not found: ${TALLY_EXPORT}`);
  } else {
    const csv = fs.readFileSync(TALLY_EXPORT, "utf-8");
    const rows = parseCsv(csv);
    // Tally submissions include hidden fields: page_url, wallet_addr, session_id, session_source.
    // Link by wallet_addr.
    for (const agent of agents) {
      if (!agent.wallet_address) continue;
      const match = rows.find((r) => r["wallet_addr"] === agent.wallet_address);
      if (match) {
        agent.tally_session_id = match["session_id"] ?? "";
        const allFieldsPresent = ["page_url", "wallet_addr", "session_id", "session_source"].every(
          (k) => typeof match[k] === "string" && match[k].length > 0,
        );
        agent.tally_hidden_fields_populated = allFieldsPresent ? "yes" : "partial";
      }
    }
    const linked = agents.filter((a) => a.tally_session_id).length;
    console.log(`Linked ${linked}/${agents.length} agents to Tally session_id`);
  }
}

// ── Determine cross-ref status per agent ──────────────────────────────────────

for (const agent of agents) {
  if (!POSTHOG_EXPORT && !TALLY_EXPORT) {
    agent.cross_ref_status = "no_exports_provided";
  } else if (agent.tally_submitted === "yes" && !agent.tally_session_id) {
    agent.cross_ref_status = "missing_tally_link";
  } else if (POSTHOG_EXPORT && !agent.posthog_distinct_id) {
    agent.cross_ref_status = "missing_posthog_link";
  } else {
    agent.cross_ref_status = "linked";
  }
}

// ── Write unified.csv ─────────────────────────────────────────────────────────

const unifiedPath = path.join(DIR, "unified.csv");
const cols = [
  "agent_id",
  "display_name",
  "archetype",
  "viewport",
  "wallet_address",
  "journal_entry_count",
  "events_fired",
  "tally_submitted",
  "tally_session_id",
  "tally_hidden_fields_populated",
  "posthog_distinct_id",
  "cross_ref_status",
  "screenshots_dir",
];
const header = cols.join(",");
const body = agents.map((a) => cols.map((c) => csvCell((a as unknown as Record<string, unknown>)[c])).join(",")).join("\n");
fs.writeFileSync(unifiedPath, header + "\n" + body + "\n");
console.log(`Wrote unified.csv: ${unifiedPath}`);

// ── Report ────────────────────────────────────────────────────────────────────

const statusCounts = new Map<string, number>();
for (const a of agents) {
  const s = a.cross_ref_status ?? "unknown";
  statusCounts.set(s, (statusCounts.get(s) ?? 0) + 1);
}
console.log(`\nCross-ref status:`);
for (const [status, count] of statusCounts.entries()) {
  console.log(`  ${status}: ${count}`);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 0) return [];
  const headers = parseCsvRow(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    return row;
  });
}

function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuote = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function csvCell(v: unknown): string {
  if (v === undefined || v === null) return "";
  const s = typeof v === "string" ? v : typeof v === "bigint" ? v.toString() : JSON.stringify(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
