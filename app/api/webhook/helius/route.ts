/**
 * POST /api/webhook/helius
 *
 * Receives raw transaction data from a Helius webhook.
 * Parses Anchor TradeEvent emissions from program logs, then:
 *   1. Records price history to KV (for the price chart)
 *   2. Forwards trade data to /api/indexer/trade-event (for leaderboard)
 *
 * Webhook type: rawDevnet (full tx with logMessages)
 * Auth: Helius sends our HELIUS_WEBHOOK_SECRET as the Authorization header.
 *
 * Env vars:
 *   HELIUS_WEBHOOK_SECRET — shared secret set when creating the webhook
 *   CRON_SECRET           — auth for the internal indexer endpoint
 *   KV_REST_API_URL       — Vercel KV
 *   KV_REST_API_TOKEN     — KV write token
 */

import { NextResponse } from "next/server";
import playerMints from "../../../lib/player-mints.json";

// ── Constants ────────────────────────────────────────────────────────────────

const PROGRAM_ID = "B69juh6rX1Z6WNN2qCkrhuHDnk6v5vrK8oJ2o6oHTVYz";
const MAX_HISTORY = 500;

// Anchor event discriminator: sha256("event:TradeEvent")[0..8]
// Precomputed to avoid runtime crypto dependency in edge runtime.
// Verified: crypto.createHash('sha256').update('event:TradeEvent').digest().subarray(0,8)
const TRADE_EVENT_DISC = [0xbd, 0xdb, 0x7f, 0xd3, 0x4e, 0xe6, 0x61, 0xee];

// Reverse lookup: mint address -> player_id
const mintToPlayer: Record<string, string> = {};
for (const [playerId, mint] of Object.entries(playerMints)) {
  mintToPlayer[mint] = playerId;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface RawTransaction {
  transaction?: {
    signatures?: string[];
  };
  meta?: {
    err?: unknown;
    logMessages?: string[];
  };
  blockTime?: number;
}

interface ParsedTradeEvent {
  signature: string;
  mint: string;
  player_id: string;
  trader: string;
  token_amount: number;
  sol_amount: number;
  is_buy: boolean;
  tokens_sold_after: number;
  price_after: number;
  fee_lamports: number;
  spread_at_buy: number;
  timestamp: number;
}

// ── Borsh deserialization helpers ────────────────────────────────────────────

function readPubkey(buf: Buffer, offset: number): [string, number] {
  const bytes = buf.subarray(offset, offset + 32);
  // Base58 encode
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = BigInt(0);
  for (const b of bytes) {
    num = num * 256n + BigInt(b);
  }
  if (num === 0n) return ["1".repeat(32), offset + 32];
  let str = "";
  while (num > 0n) {
    const rem = Number(num % 58n);
    str = ALPHABET[rem] + str;
    num = num / 58n;
  }
  // Leading zeros
  for (const b of bytes) {
    if (b === 0) str = "1" + str;
    else break;
  }
  return [str, offset + 32];
}

function readU64(buf: Buffer, offset: number): [bigint, number] {
  const lo = buf.readUInt32LE(offset);
  const hi = buf.readUInt32LE(offset + 4);
  return [BigInt(lo) + (BigInt(hi) << 32n), offset + 8];
}

function readI64(buf: Buffer, offset: number): [bigint, number] {
  const val = buf.readBigInt64LE(offset);
  return [val, offset + 8];
}

function readString(buf: Buffer, offset: number): [string, number] {
  const len = buf.readUInt32LE(offset);
  const str = buf.toString("utf8", offset + 4, offset + 4 + len);
  return [str, offset + 4 + len];
}

function readBool(buf: Buffer, offset: number): [boolean, number] {
  return [buf[offset] !== 0, offset + 1];
}

// ── TradeEvent parser ────────────────────────────────────────────────────────

function parseTradeEvent(base64Data: string): Omit<ParsedTradeEvent, "signature" | "timestamp"> | null {
  const buf = Buffer.from(base64Data, "base64");

  // Check discriminator (first 8 bytes)
  if (buf.length < 8) return null;
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== TRADE_EVENT_DISC[i]) return null;
  }

  try {
    let offset = 8;

    let mint: string;
    [mint, offset] = readPubkey(buf, offset);

    let player_id: string;
    [player_id, offset] = readString(buf, offset);

    let trader: string;
    [trader, offset] = readPubkey(buf, offset);

    let token_amount: bigint;
    [token_amount, offset] = readU64(buf, offset);

    let sol_amount: bigint;
    [sol_amount, offset] = readU64(buf, offset);

    let is_buy: boolean;
    [is_buy, offset] = readBool(buf, offset);

    let tokens_sold_after: bigint;
    [tokens_sold_after, offset] = readU64(buf, offset);

    let price_after: bigint;
    [price_after, offset] = readU64(buf, offset);

    let fee_lamports: bigint;
    [fee_lamports, offset] = readU64(buf, offset);

    let spread_at_buy: bigint;
    [spread_at_buy, offset] = readI64(buf, offset);

    return {
      mint,
      player_id,
      trader,
      token_amount: Number(token_amount),
      sol_amount: Number(sol_amount),
      is_buy,
      tokens_sold_after: Number(tokens_sold_after),
      price_after: Number(price_after),
      fee_lamports: Number(fee_lamports),
      spread_at_buy: Number(spread_at_buy),
    };
  } catch {
    return null;
  }
}

/**
 * Extract TradeEvents from a raw transaction's logMessages.
 *
 * Anchor emits events as:
 *   "Program data: <base64>"
 * within the program's invoke scope.
 */
function extractTradeEvents(tx: RawTransaction): ParsedTradeEvent[] {
  const logs = tx.meta?.logMessages;
  const sig = tx.transaction?.signatures?.[0];
  if (!logs || !sig || tx.meta?.err) return [];

  const events: ParsedTradeEvent[] = [];
  let inOurProgram = false;

  for (const line of logs) {
    if (line.includes(`Program ${PROGRAM_ID} invoke`)) {
      inOurProgram = true;
      continue;
    }
    if (inOurProgram && line.includes(`Program ${PROGRAM_ID} success`)) {
      inOurProgram = false;
      continue;
    }

    if (inOurProgram && line.startsWith("Program data: ")) {
      const b64 = line.slice("Program data: ".length);
      const parsed = parseTradeEvent(b64);
      if (parsed) {
        events.push({
          ...parsed,
          signature: sig,
          timestamp: tx.blockTime ?? Math.floor(Date.now() / 1000),
        });
      }
    }
  }

  return events;
}

// ── KV price recording ──────────────────────────────────────────────────────

async function recordPrice(playerId: string, price: number, timestamp: number) {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return;

  const cluster = process.env.SOLANA_CLUSTER ?? "devnet";
  const key = `price-history:${cluster}:${playerId}`;
  const entry = JSON.stringify({ t: timestamp, p: price });

  await fetch(`${kvUrl}/rpush/${encodeURIComponent(key)}/${encodeURIComponent(entry)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${kvToken}` },
  });

  await fetch(`${kvUrl}/ltrim/${encodeURIComponent(key)}/-${MAX_HISTORY}/-1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${kvToken}` },
  });
}

// ── Indexer forwarding ──────────────────────────────────────────────────────

async function forwardToIndexer(event: ParsedTradeEvent) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return;

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  await fetch(`${baseUrl}/api/indexer/trade-event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cronSecret}`,
    },
    body: JSON.stringify({
      signature: event.signature,
      mint: event.mint,
      player_id: event.player_id,
      trader: event.trader,
      token_amount: event.token_amount,
      sol_amount: event.sol_amount,
      is_buy: event.is_buy,
      fee_lamports: event.fee_lamports,
      spread_at_buy: event.spread_at_buy,
    }),
  });
}

// ── Route handler ───────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // Auth — verify the shared secret Helius sends
  const secret = process.env.HELIUS_WEBHOOK_SECRET;
  if (secret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== secret) {
      console.warn("[webhook/helius] unauthorized request");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Parse payload — Helius sends a JSON array of transactions
  let transactions: RawTransaction[];
  try {
    const body = await req.json();
    transactions = Array.isArray(body) ? body : [body];
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let processed = 0;
  let errors = 0;

  for (const tx of transactions) {
    const events = extractTradeEvents(tx);

    for (const event of events) {
      try {
        // Resolve player_id — prefer the event's embedded player_id,
        // fall back to reverse-lookup from mint
        const playerId = event.player_id || mintToPlayer[event.mint];
        if (!playerId) {
          console.warn(`[webhook/helius] unknown mint: ${event.mint}`);
          continue;
        }

        // Record price and forward to indexer in parallel
        await Promise.all([
          recordPrice(playerId, event.price_after, event.timestamp),
          forwardToIndexer(event),
        ]);

        processed++;
      } catch (err) {
        console.error("[webhook/helius] event processing error:", err);
        errors++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    transactions: transactions.length,
    events_processed: processed,
    errors,
  });
}
