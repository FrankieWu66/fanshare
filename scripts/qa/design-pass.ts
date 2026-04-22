/**
 * Demo 0.5 post-run designer pass.
 *
 * For each agent's /invite screenshot, hand to Claude (vision) along with
 * DESIGN_SYSTEM.md and ask: do any visible typography / color / spacing /
 * hierarchy / component choices violate the spec?
 *
 * Why a separate pass (not inline in onboarding-sim):
 *   Agent personas think like USERS, not designers. Injecting
 *   DESIGN_SYSTEM.md into every agent's context biases them toward
 *   design-spec thinking and expands token cost. Run this pass AFTER the
 *   agent run with a dedicated "design-critic" prompt, and you get
 *   independent signal.
 *
 * Run:
 *   npx tsx scripts/qa/design-pass.ts --dir analytics/sim-runs/YYYY-MM-DD
 *
 * Flags:
 *   --dir <path>          required — completed run directory
 *   --spec <path>         path to DESIGN_SYSTEM.md (default: ./DESIGN_SYSTEM.md)
 *   --sample <N>          how many agents to check (default: 3, min: 1, max: all)
 *                         Vision calls are ~$0.005-0.015 each, checking all 15
 *                         per run = ~$0.15. Set --sample to full run count to
 *                         evaluate every agent's view.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config({
  path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../../.env.local"),
});

import Anthropic from "@anthropic-ai/sdk";

const argv = process.argv.slice(2);
const arg = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const DIR_ARG = arg("dir");
const SPEC_PATH = arg("spec") ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../DESIGN_SYSTEM.md");
const SAMPLE = parseInt(arg("sample") ?? "3", 10);

if (!DIR_ARG) {
  console.error("ERROR: --dir required");
  process.exit(1);
}
const DIR: string = DIR_ARG;
if (!fs.existsSync(DIR)) {
  console.error(`ERROR: dir does not exist: ${DIR}`);
  process.exit(1);
}
if (!fs.existsSync(SPEC_PATH)) {
  console.error(`ERROR: DESIGN_SYSTEM.md not found at ${SPEC_PATH}`);
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ERROR: ANTHROPIC_API_KEY not set");
  process.exit(1);
}

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const spec = fs.readFileSync(SPEC_PATH, "utf-8");

// Find the first /invite screenshot for each agent.
const screenshotsRoot = path.join(DIR, "screenshots");
if (!fs.existsSync(screenshotsRoot)) {
  console.error(`ERROR: ${screenshotsRoot} does not exist`);
  process.exit(1);
}

const agentDirs = fs.readdirSync(screenshotsRoot).filter((d) => fs.statSync(path.join(screenshotsRoot, d)).isDirectory());
if (agentDirs.length === 0) {
  console.error(`ERROR: no agent screenshot subdirs in ${screenshotsRoot}`);
  process.exit(1);
}

// Use the first N agent dirs (deterministic: alphabetical by id)
agentDirs.sort();
const sampled = agentDirs.slice(0, Math.min(SAMPLE, agentDirs.length));
console.log(`Design-pass sample: ${sampled.length} / ${agentDirs.length} agents`);

interface Finding {
  agent_id: string;
  screenshot: string;
  viewport: string;
  violations: {
    category: "typography" | "color" | "spacing" | "component" | "hierarchy" | "accessibility" | "other";
    severity: "high" | "medium" | "low";
    what: string;
    spec_reference: string;
    suggested_fix: string;
  }[];
  overall_alignment: number; // 0-10
  summary: string;
}

const findings: Finding[] = [];

async function run() {
  for (const agentId of sampled) {
    const agentDir = path.join(screenshotsRoot, agentId);
    const landingFile: string | undefined = fs.readdirSync(agentDir).find((f) => f.includes("landed"));
    if (landingFile === undefined) {
      console.warn(`SKIP ${agentId}: no landing screenshot found`);
      continue;
    }
    const screenshotPath = path.join(agentDir, landingFile);
    // Load agent metadata for viewport
    const journalFile = path.join(DIR, "journals", `${agentId}.json`);
    let viewport = "desktop";
    if (fs.existsSync(journalFile)) {
      try {
        const j = JSON.parse(fs.readFileSync(journalFile, "utf-8")) as { viewport?: string };
        if (j.viewport) viewport = j.viewport;
      } catch {
        /* default desktop */
      }
    }

    console.log(`\nChecking ${agentId} (${viewport}): ${landingFile}`);
    try {
      const f = await checkScreenshot(agentId, screenshotPath, viewport);
      findings.push(f);
      console.log(`  alignment: ${f.overall_alignment}/10, ${f.violations.length} violations`);
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Write report.
  const reportPath = path.join(DIR, "design-violations.md");
  fs.writeFileSync(reportPath, renderReport(findings));
  console.log(`\nWrote ${reportPath}`);

  const jsonPath = path.join(DIR, "design-violations.json");
  fs.writeFileSync(jsonPath, JSON.stringify(findings, null, 2));
  console.log(`Wrote ${jsonPath}`);
}

async function checkScreenshot(agentId: string, screenshotPath: string, viewport: string): Promise<Finding> {
  const png = fs.readFileSync(screenshotPath);
  const b64 = png.toString("base64");
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    temperature: 0.3,
    system: [{
      type: "text",
      text: [
        "You are a senior product designer evaluating whether a rendered page matches the project's design system spec.",
        "You output strict JSON only. No preamble. No code fences.",
        "",
        "Schema:",
        "{",
        '  "violations": [',
        "    {",
        '      "category": "typography" | "color" | "spacing" | "component" | "hierarchy" | "accessibility" | "other",',
        '      "severity": "high" | "medium" | "low",',
        '      "what": string,               // 1-2 sentences: what you see vs what spec says',
        '      "spec_reference": string,      // quote the relevant line(s) from the spec',
        '      "suggested_fix": string        // 1 sentence: what to change',
        "    }",
        "  ],",
        '  "overall_alignment": number,     // 0-10, how well rendered page matches spec overall',
        '  "summary": string                // 2-3 sentences: top-level assessment',
        "}",
      ].join("\n"),
      cache_control: { type: "ephemeral" },
    }],
    messages: [{
      role: "user",
      content: [
        { type: "text", text: `DESIGN_SYSTEM.md spec:\n\n${spec}\n\n---\n\nRendered /invite page (viewport: ${viewport}):` },
        { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
        { type: "text", text: `Evaluate this screenshot against the spec above. Output the JSON.` },
      ],
    }],
  });

  const first = res.content[0];
  const text = first && first.type === "text" ? first.text.trim() : "{}";
  const stripped = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    /* empty */
  }

  return {
    agent_id: agentId,
    screenshot: screenshotPath,
    viewport,
    violations: Array.isArray(parsed.violations)
      ? (parsed.violations as Array<Record<string, unknown>>).map((v) => ({
          category: ((v.category as string) ?? "other") as Finding["violations"][number]["category"],
          severity: ((v.severity as string) ?? "medium") as Finding["violations"][number]["severity"],
          what: String(v.what ?? ""),
          spec_reference: String(v.spec_reference ?? ""),
          suggested_fix: String(v.suggested_fix ?? ""),
        }))
      : [],
    overall_alignment: typeof parsed.overall_alignment === "number" ? Math.max(0, Math.min(10, parsed.overall_alignment)) : 5,
    summary: String(parsed.summary ?? ""),
  };
}

function renderReport(findings: Finding[]): string {
  if (findings.length === 0) return "# Design-Pass Violations Report\n\n_No findings._\n";

  const avg = findings.reduce((a, b) => a + b.overall_alignment, 0) / findings.length;
  const bySeverity = new Map<string, number>();
  for (const f of findings) {
    for (const v of f.violations) {
      bySeverity.set(v.severity, (bySeverity.get(v.severity) ?? 0) + 1);
    }
  }
  const topViolations = findings.flatMap((f) => f.violations.map((v) => ({ ...v, agent: f.agent_id, viewport: f.viewport })));
  topViolations.sort((a, b) => {
    const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3);
  });

  return [
    `# Design-Pass Violations Report`,
    ``,
    `Generated by \`scripts/qa/design-pass.ts\` against DESIGN_SYSTEM.md.`,
    ``,
    `## Summary`,
    ``,
    `- Agents sampled: ${findings.length}`,
    `- Average alignment: ${avg.toFixed(1)}/10`,
    `- Violations by severity: high=${bySeverity.get("high") ?? 0}, medium=${bySeverity.get("medium") ?? 0}, low=${bySeverity.get("low") ?? 0}`,
    ``,
    `## Per-agent assessments`,
    ``,
    ...findings.map((f) => [
      `### ${f.agent_id} (${f.viewport}) — alignment ${f.overall_alignment}/10`,
      ``,
      f.summary,
      ``,
      f.violations.length === 0
        ? `_No violations._`
        : f.violations
            .map(
              (v) =>
                `- **[${v.severity.toUpperCase()}] ${v.category}:** ${v.what}\n  - Spec: ${v.spec_reference}\n  - Fix: ${v.suggested_fix}`,
            )
            .join("\n"),
      ``,
    ].join("\n")),
    `## Top violations (severity-ranked)`,
    ``,
    topViolations.length === 0
      ? "_none_"
      : topViolations
          .slice(0, 15)
          .map((v, i) => `${i + 1}. **[${v.severity.toUpperCase()}]** ${v.agent}: ${v.what} → ${v.suggested_fix}`)
          .join("\n"),
    ``,
  ].join("\n");
}

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
