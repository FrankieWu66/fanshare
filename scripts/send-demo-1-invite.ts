#!/usr/bin/env tsx
/**
 * Send a Demo 1 invite email to one recipient.
 *
 * This script is for Frankie's manual sends during Demo 1.
 * It is NOT a blast tool — one recipient at a time by design.
 * (Demo 2 / mainnet will use a proper drip via the Resend API.)
 *
 * Usage:
 *   npx tsx scripts/send-demo-1-invite.ts --to jordan@example.com --name Jordan --variant a
 *   npx tsx scripts/send-demo-1-invite.ts --to marcus@example.com --name Marcus --variant b
 *
 * Env vars (loaded from .env.local):
 *   RESEND_API_KEY   — required; set in .env.local and Vercel env vars
 *   EMAIL_DRY_RUN    — "true" | "false" (default: "true")
 *                      Flip to "false" once you've reviewed the template in Resend preview
 *
 * Variant guide:
 *   --variant a  — Warm/Personal. Default when unsure. "Built a thing."
 *   --variant b  — Analytical/Curious. For basketball-mind friends. "Built a market for reads."
 *
 * Note: Demo 1 invitees use Frankie's personal email client, not this script.
 * This script exists for Demo 2+ manual sends where Resend is the channel.
 * It's fine to use now if convenient — just flip EMAIL_DRY_RUN=false first.
 */

import * as dotenv from "dotenv";
import * as path from "path";
import { parseArgs } from "util";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// Must import AFTER dotenv.config so env vars are available
const { sendEmail } = await import("../app/lib/email/send");
const { buildDemo1InviteA } = await import("../app/lib/email/templates/demo-1-invite-a");
const { buildDemo1InviteB } = await import("../app/lib/email/templates/demo-1-invite-b");

const { values } = parseArgs({
  options: {
    to: { type: "string" },
    name: { type: "string" },
    variant: { type: "string", default: "a" },
    "invite-url": { type: "string", default: "fanshares.xyz/invite" },
  },
  strict: true,
});

if (!values.to || !values.name) {
  console.error("Usage: send-demo-1-invite.ts --to <email> --name <first-name> --variant <a|b>");
  process.exit(1);
}

const variant = (values.variant ?? "a").toLowerCase();
if (variant !== "a" && variant !== "b") {
  console.error("--variant must be 'a' or 'b'");
  process.exit(1);
}

const opts = { name: values.name, inviteUrl: values["invite-url"] };
const { subject, html } = variant === "a"
  ? buildDemo1InviteA(opts)
  : buildDemo1InviteB(opts);

console.log(`Sending Demo 1 invite (Variant ${variant.toUpperCase()}) to ${values.to} (${values.name})...`);
console.log(`  Subject: ${subject}`);

const result = await sendEmail({
  to: values.to,
  subject,
  html,
  from: "Frankie from FanShare <frankie@fanshares.xyz>",
  replyTo: "frankie@fanshares.xyz",
});

if (result.dryRun) {
  console.log("  DRY RUN — not actually sent. Set EMAIL_DRY_RUN=false in .env.local to send for real.");
} else {
  console.log(`  ✓ Sent. Resend ID: ${result.id}`);
}
