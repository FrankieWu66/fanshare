/**
 * POST /api/webhook/tally
 *
 * Tally webhook receiver for the /waitlist form (tally.so/r/MerLrg).
 * On each submission, sends a waitlist welcome email via Resend.
 *
 * Security: validates Tally's HMAC-SHA256 signature on every request.
 * Signature header: "tally-signature" (Tally docs: webhooks → signing).
 * Set TALLY_WEBHOOK_SECRET to the signing secret shown in the Tally
 * webhook settings for this form.
 *
 * Env vars:
 *   TALLY_WEBHOOK_SECRET  — signing secret from Tally webhook settings
 *   RESEND_API_KEY        — Resend free tier API key
 *   EMAIL_DRY_RUN         — "true" | "false" (default: "true")
 *   EMAIL_FROM_WAITLIST   — optional sender override (default: noreply@fanshares.xyz)
 */

import { NextResponse } from "next/server";
import crypto from "crypto";
import { sendEmail } from "@/app/lib/email/send";
import {
  waitlistWelcomeHtml,
  waitlistWelcomeSubject,
} from "@/app/lib/email/templates/waitlist-welcome";

/** Verify Tally HMAC-SHA256 signature */
function verifyTallySignature(body: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body, "utf8")
    .digest("base64");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

/** Extract email address from Tally payload fields */
function extractEmail(fields: TallyField[]): string | null {
  for (const field of fields) {
    if (
      field.type === "EMAIL" ||
      field.label?.toLowerCase().includes("email")
    ) {
      const val = Array.isArray(field.value) ? field.value[0] : field.value;
      if (typeof val === "string" && val.includes("@")) return val;
    }
  }
  return null;
}

interface TallyField {
  key: string;
  label?: string;
  type?: string;
  value?: unknown;
}

interface TallyPayload {
  eventId?: string;
  eventType?: string;
  data?: {
    fields?: TallyField[];
    submittedAt?: string;
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.TALLY_WEBHOOK_SECRET;
  const rawBody = await request.text();

  // Verify signature when secret is set
  if (secret) {
    const sig = request.headers.get("tally-signature") ?? "";
    if (!sig) {
      return NextResponse.json({ error: "Missing signature" }, { status: 401 });
    }
    if (!verifyTallySignature(rawBody, sig, secret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } else {
    console.warn("[tally-webhook] TALLY_WEBHOOK_SECRET not set — skipping signature verification");
  }

  let payload: TallyPayload;
  try {
    payload = JSON.parse(rawBody) as TallyPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Only handle form submissions
  if (payload.eventType !== "FORM_RESPONSE") {
    return NextResponse.json({ ok: true, skipped: "not a form response" });
  }

  const fields = payload.data?.fields ?? [];
  const email = extractEmail(fields);

  if (!email) {
    console.warn("[tally-webhook] no email field found in payload", JSON.stringify(fields));
    return NextResponse.json({ ok: true, skipped: "no email field" });
  }

  try {
    const result = await sendEmail({
      to: email,
      subject: waitlistWelcomeSubject,
      html: waitlistWelcomeHtml(),
      from: process.env.EMAIL_FROM_WAITLIST,
    });

    console.log(
      `[tally-webhook] waitlist welcome ${result.dryRun ? "(dry-run)" : "sent"} to ${email}`,
      result.id ? `id=${result.id}` : ""
    );

    return NextResponse.json({ ok: true, dryRun: result.dryRun });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[tally-webhook] email send failed:", msg);
    // Return 200 so Tally doesn't retry indefinitely on our infra errors
    return NextResponse.json({ ok: false, error: msg }, { status: 200 });
  }
}
