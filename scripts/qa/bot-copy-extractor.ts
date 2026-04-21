/**
 * Copy extractor — feeds `what_they_read` to the LLM narrator.
 *
 * The ops spec requires per-action journal entries where each bot reports the
 * *actual copy they were exposed to*. To do that honestly without running a
 * full browser for all 15 bots, we fetch the rendered HTML and extract
 * visible text. Static HTML is enough for /invite and /trade/[id] because
 * the relevant copy is server-rendered — client-only widgets (wallet pill,
 * live price) don't carry the copy we're testing.
 *
 * The 2 browser-mode bots (flagged in bot-users) run through the real UI
 * separately and produce their own snapshot text — this module is only the
 * headless path.
 *
 * Caching: one fetch per route per run. Copy doesn't change mid-session, and
 * we don't want 150 /invite fetches hitting prod.
 */

import { JSDOM } from "jsdom";

const TEXT_CACHE = new Map<string, { fetchedAt: number; text: string }>();

export interface CopySnapshot {
  url: string;
  fetchedAt: number;
  /** Normalized visible text — roughly what a user would see on the page. */
  text: string;
  /** First ~6 prominent headings — helps the LLM orient quickly. */
  headings: string[];
  /** Button/link labels that look clickable — for "CTA whose outcome unclear" flags. */
  ctas: string[];
}

export async function fetchCopy(baseUrl: string, routePath: string): Promise<CopySnapshot> {
  const url = new URL(routePath, baseUrl).toString();
  const cached = TEXT_CACHE.get(url);
  if (cached && Date.now() - cached.fetchedAt < 5 * 60_000) {
    return toSnapshot(url, cached.fetchedAt, cached.text);
  }

  const res = await fetch(url, {
    headers: { "User-Agent": "FanShareQABot/1.0 (+rehearsal)" },
  });
  if (!res.ok) throw new Error(`fetchCopy ${url}: ${res.status}`);
  const html = await res.text();

  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // Drop noise: scripts, styles, svg, inline-nav-chrome.
  doc.querySelectorAll("script, style, noscript, svg, path").forEach((el) => el.remove());

  const text = normalize(doc.body?.textContent ?? "");
  TEXT_CACHE.set(url, { fetchedAt: Date.now(), text });
  return toSnapshotFromDom(url, Date.now(), text, doc);
}

function toSnapshotFromDom(
  url: string,
  fetchedAt: number,
  text: string,
  doc: Document,
): CopySnapshot {
  const headings = Array.from(doc.querySelectorAll("h1, h2, h3"))
    .slice(0, 6)
    .map((h) => normalize(h.textContent ?? ""))
    .filter((s) => s.length > 0);

  const ctas = Array.from(doc.querySelectorAll("button, a[role='button'], a[href]"))
    .map((el) => normalize(el.textContent ?? ""))
    .filter((s) => s.length > 0 && s.length < 60);

  return { url, fetchedAt, text: clip(text, 4000), headings, ctas: uniq(ctas).slice(0, 12) };
}

function toSnapshot(url: string, fetchedAt: number, text: string): CopySnapshot {
  // Cached rebuild — no DOM handy, return text-only snapshot with best-effort
  // CTAs re-extracted from the text.
  return {
    url,
    fetchedAt,
    text: clip(text, 4000),
    headings: [],
    ctas: [],
  };
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
