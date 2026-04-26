/**
 * Demo 1 invite email — Variant A (Warm / Personal).
 *
 * Source copy: /Users/frankiewu/dev/fanshare/marketing/campaigns/demo-1-outbound-variants.md
 * When to use: friends where the relationship is the lever.
 * Default variant if you're unsure.
 *
 * Usage: buildDemo1InviteA({ name: "Jordan" })
 */

export interface Demo1InviteOptions {
  /** Recipient's first name, e.g. "Jordan" */
  name: string;
  /** Override the invite link if you're testing a specific URL */
  inviteUrl?: string;
}

export function buildDemo1InviteA({ name, inviteUrl = "fanshares.xyz/invite" }: Demo1InviteOptions): {
  subject: string;
  html: string;
} {
  const subject = "Built a thing. Want your eyes on it?";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#FFFFFF;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#09090B;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;padding:0 24px;">
          <tr>
            <td style="padding-bottom:32px;font-size:15px;line-height:1.75;color:#09090B;">
              <p style="margin:0 0 16px 0;">Hey ${name},</p>
              <p style="margin:0 0 16px 0;">I built a thing and you came to mind. It&rsquo;s a small market for NBA player tokens where prices move based on real stats &mdash; the stats set a fair-value price, the market trades around it, and your basketball read is the edge. Where stats and price disagree, that&rsquo;s where the opportunity is.</p>
              <p style="margin:0 0 16px 0;">It&rsquo;s in test mode (no real money on the line), and I&rsquo;m letting in 15 friends to break it before anyone else. Takes about 60 seconds to claim $100 to trade with and make your first move.</p>
              <p style="margin:0 0 16px 0;">Would love to know what you think &mdash; both what works and what&rsquo;s broken.</p>
              <p style="margin:0 0 16px 0;"><a href="https://${inviteUrl}" style="color:#F59E0B;font-weight:600;">${inviteUrl}</a></p>
              <p style="margin:0;">&mdash; Frankie</p>
            </td>
          </tr>
          <tr>
            <td style="padding-top:24px;border-top:1px solid #E4E4E7;">
              <p style="margin:0;font-size:11px;font-family:ui-monospace,monospace;color:#A1A1AA;line-height:1.55;">
                Practice mode. No real money. No seed phrase.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html };
}
