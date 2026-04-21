/**
 * Time-ordered console feed for the game-night rehearsal.
 *
 * Purpose: the operator is watching one terminal during a 45-minute simulation
 * and needs to see at a glance: who acted, what they did, what they said, what
 * news fired, what errors happened. Color + emoji to let the eye skim.
 *
 * Disable color via NO_COLOR=1 (respects standard convention).
 */

const USE_COLOR = !process.env.NO_COLOR;

type Color = "reset" | "dim" | "gray" | "green" | "red" | "yellow" | "cyan" | "magenta" | "blue";

const CODES: Record<Color, string> = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  gray: "\x1b[90m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
};

function c(color: Color, s: string): string {
  return USE_COLOR ? `${CODES[color]}${s}${CODES.reset}` : s;
}

function hhmmss(d = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function stamp(): string {
  return c("gray", `[${hhmmss()}]`);
}

export const feed = {
  phase(name: string) {
    console.log();
    console.log(c("magenta", `━━━ ${name.toUpperCase()} ━━━`));
  },

  info(who: string, msg: string) {
    console.log(`${stamp()} ${c("cyan", who.padEnd(16))} ${msg}`);
  },

  register(displayName: string, address: string) {
    console.log(
      `${stamp()} ${c("blue", "🎫 register")}      ${displayName.padEnd(22)} ${c("gray", address.slice(0, 10) + "…")}`,
    );
  },

  read(who: string, pageTitle: string, quote: string) {
    console.log(
      `${stamp()} ${c("gray", "👀 read")}         ${who.padEnd(16)} ${c("dim", pageTitle)} ${c("gray", `"${clip(quote, 80)}"`)}`,
    );
  },

  thought(who: string, interpretation: string) {
    console.log(
      `${stamp()} ${c("dim", "💭 thought")}      ${who.padEnd(16)} ${c("gray", clip(interpretation, 120))}`,
    );
  },

  buy(who: string, playerId: string, solAmount: number, tokens?: string, sig?: string) {
    const tail = tokens
      ? `${tokens} tokens${sig ? ` ${c("gray", sig.slice(0, 8) + "…")}` : ""}`
      : "";
    console.log(
      `${stamp()} ${c("green", "📈 buy")}          ${who.padEnd(16)} ${playerId.padEnd(12)} ${solAmount.toFixed(4)} SOL ${tail}`,
    );
  },

  sell(who: string, playerId: string, tokens: string, sig?: string) {
    console.log(
      `${stamp()} ${c("yellow", "📉 sell")}         ${who.padEnd(16)} ${playerId.padEnd(12)} ${tokens} tokens${sig ? ` ${c("gray", sig.slice(0, 8) + "…")}` : ""}`,
    );
  },

  error(who: string, what: string, detail: string) {
    console.log(
      `${stamp()} ${c("red", "💥 error")}        ${who.padEnd(16)} ${c("red", what)} ${c("gray", clip(detail, 120))}`,
    );
  },

  news(playerId: string, headline: string, pct: number) {
    const arrow = pct >= 0 ? c("green", `▲${(pct * 100).toFixed(1)}%`) : c("red", `▼${Math.abs(pct * 100).toFixed(1)}%`);
    console.log(
      `${stamp()} ${c("magenta", "📰 news")}         ${playerId.padEnd(12)} ${arrow}  ${c("dim", headline)}`,
    );
  },

  oracle(playerId: string, fairValueSol: number) {
    console.log(
      `${stamp()} ${c("blue", "🛰  oracle")}      ${playerId.padEnd(12)} fair=${fairValueSol.toFixed(6)} SOL`,
    );
  },

  abandon(who: string, reason: string) {
    console.log(
      `${stamp()} ${c("yellow", "🚪 abandon")}     ${who.padEnd(16)} ${c("dim", reason)}`,
    );
  },

  checkpoint(who: string, oneLine: string) {
    console.log(
      `${stamp()} ${c("cyan", "🧠 checkpoint")}  ${who.padEnd(16)} ${c("dim", clip(oneLine, 120))}`,
    );
  },

  summary(label: string, value: string) {
    console.log(`  ${label.padEnd(28)} ${c("cyan", value)}`);
  },

  blank() {
    console.log();
  },
};

function clip(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max) + "…" : flat;
}
