/**
 * Demo 1 invite email — Variant B (Analytical / Curious).
 *
 * Source copy: /Users/frankiewu/dev/fanshare/marketing/campaigns/demo-1-outbound-variants.md
 * When to use: friends whose basketball-thinking taste is the lever.
 * Over-flatters if they don't self-identify as analyst types — B is default when
 * the friend is a basketball-mind type; A is safer otherwise.
 *
 * Usage: buildDemo1InviteB({ name: "Marcus" })
 */

export interface Demo1InviteOptions {
  /** Recipient's first name, e.g. "Marcus" */
  name: string;
  /** Override the invite link if you're testing a specific URL */
  inviteUrl?: string;
}

export function buildDemo1InviteB({ name, inviteUrl = "fanshares.xyz/invite" }: Demo1InviteOptions): {
  subject: string;
  html: string;
} {
  const subject = "Built a market for basketball reads";

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
              <p style="margin:0 0 16px 0;">You&rsquo;re one of the people whose basketball reads I actually trust, so I wanted you in early on this.</p>
              <p style="margin:0 0 16px 0;">It&rsquo;s a market where every NBA player has a token, and the stats themselves set a fair-value price &mdash; updated daily. The market trades around it; sometimes above, sometimes below. The gap between what stats say a player is worth and what the market is paying is the edge. If you spot it before others do, that&rsquo;s the trade.</p>
              <p style="margin:0 0 16px 0;">In test mode for now (no real money), opening to 15 friends. You get $100 to play with. You&rsquo;ll know within a minute whether it clicks for you.</p>
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
