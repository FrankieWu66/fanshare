/**
 * Resend email client + send helper.
 *
 * DRY_RUN mode (default: ON during setup):
 *   - When EMAIL_DRY_RUN=true (or env var is unset), no email is actually sent.
 *   - The function logs "would send to X" and returns a stub result.
 *   - Flip EMAIL_DRY_RUN=false in Vercel env vars once Frankie has reviewed
 *     templates in Resend's dashboard.
 *
 * Env vars required:
 *   RESEND_API_KEY   — from resend.com dashboard (free tier: 3k emails/mo)
 *   EMAIL_DRY_RUN    — "true" | "false" (default: "true" — safe for setup)
 */

import { Resend } from "resend";

const isDryRun = process.env.EMAIL_DRY_RUN !== "false";

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("[email] RESEND_API_KEY is not set");
    _resend = new Resend(key);
  }
  return _resend;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}

export interface SendEmailResult {
  id: string | null;
  dryRun: boolean;
}

/**
 * Send a transactional email via Resend.
 * In DRY_RUN mode, logs intent and returns a stub — never calls Resend.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const from = opts.from ?? "FanShare <noreply@fanshares.xyz>";

  if (isDryRun) {
    console.log(
      `[email:dry-run] would send "${opts.subject}" to ${opts.to} from ${from}`
    );
    return { id: null, dryRun: true };
  }

  const resend = getResend();
  const { data, error } = await resend.emails.send({
    from,
    to: opts.to,
    replyTo: opts.replyTo,
    subject: opts.subject,
    html: opts.html,
  });

  if (error) {
    throw new Error(`[email] Resend error: ${error.message}`);
  }

  return { id: data?.id ?? null, dryRun: false };
}
