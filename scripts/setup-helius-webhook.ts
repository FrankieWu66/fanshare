/**
 * Register (or update) a Helius webhook to receive raw devnet transactions
 * for our FanShare program.
 *
 * Usage:
 *   npx tsx scripts/setup-helius-webhook.ts
 *   npx tsx scripts/setup-helius-webhook.ts --list     # list existing webhooks
 *   npx tsx scripts/setup-helius-webhook.ts --delete <id>
 *
 * Requires .env.local:
 *   NEXT_PUBLIC_HELIUS_API_KEY   — Helius API key
 *   HELIUS_WEBHOOK_SECRET        — shared secret (we send it; Helius echoes it back)
 *
 * The webhook monitors all transactions touching our program ID and
 * POSTs raw transaction data to our /api/webhook/helius endpoint.
 */

import * as path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env.local") });

const PROGRAM_ID = "B69juh6rX1Z6WNN2qCkrhuHDnk6v5vrK8oJ2o6oHTVYz";
const WEBHOOK_URL = "https://fanshare-1.vercel.app/api/webhook/helius";

const API_KEY = process.env.NEXT_PUBLIC_HELIUS_API_KEY;
if (!API_KEY) {
  console.error("Missing NEXT_PUBLIC_HELIUS_API_KEY in .env.local");
  process.exit(1);
}

const WEBHOOK_SECRET = process.env.HELIUS_WEBHOOK_SECRET;

const BASE_URL = `https://api.helius.xyz/v0/webhooks?api-key=${API_KEY}`;

async function listWebhooks() {
  const res = await fetch(BASE_URL);
  if (!res.ok) {
    console.error(`List failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const webhooks = await res.json();
  if (webhooks.length === 0) {
    console.log("No webhooks registered.");
    return [];
  }
  for (const wh of webhooks) {
    console.log(`  ${wh.webhookID}  ${wh.webhookType}  ${wh.webhookURL}  accounts=${wh.accountAddresses?.length ?? 0}`);
  }
  return webhooks;
}

async function deleteWebhook(id: string) {
  const res = await fetch(`https://api.helius.xyz/v0/webhooks/${id}?api-key=${API_KEY}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    console.error(`Delete failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  console.log(`Deleted webhook ${id}`);
}

async function createWebhook() {
  const body: Record<string, unknown> = {
    webhookURL: WEBHOOK_URL,
    webhookType: "rawDevnet",
    accountAddresses: [PROGRAM_ID],
    transactionTypes: ["ANY"],
    txnStatus: "success",
  };

  if (WEBHOOK_SECRET) {
    body.authHeader = WEBHOOK_SECRET;
  }

  console.log("Creating webhook...");
  console.log(`  URL: ${WEBHOOK_URL}`);
  console.log(`  Type: rawDevnet`);
  console.log(`  Program: ${PROGRAM_ID}`);
  console.log(`  Auth: ${WEBHOOK_SECRET ? "yes (HELIUS_WEBHOOK_SECRET)" : "none (set HELIUS_WEBHOOK_SECRET to secure)"}`);

  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Create failed: ${res.status} ${errText}`);
    process.exit(1);
  }

  const webhook = await res.json();
  console.log(`\nWebhook created!`);
  console.log(`  ID: ${webhook.webhookID}`);
  console.log(`  URL: ${webhook.webhookURL}`);
  console.log(`  Type: ${webhook.webhookType}`);

  return webhook;
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "--list") {
    console.log("Existing webhooks:");
    await listWebhooks();
    return;
  }

  if (args[0] === "--delete" && args[1]) {
    await deleteWebhook(args[1]);
    return;
  }

  // Check if we already have a webhook for this URL
  const existing = await listWebhooks();
  const match = existing.find(
    (wh: { webhookURL: string }) => wh.webhookURL === WEBHOOK_URL
  );

  if (match) {
    console.log(`\nWebhook already exists for ${WEBHOOK_URL} (ID: ${match.webhookID})`);
    console.log("Use --delete to remove it first, or it will keep working.");
    return;
  }

  await createWebhook();

  console.log("\nNext steps:");
  console.log("  1. Set HELIUS_WEBHOOK_SECRET in Vercel env vars (same value as .env.local)");
  console.log("  2. Redeploy: vercel --prod --yes");
  console.log("  3. Make a trade and check Vercel function logs for webhook hits");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
