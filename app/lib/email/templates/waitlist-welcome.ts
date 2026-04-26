/**
 * Waitlist welcome email template.
 * Triggered by: /api/webhook/tally when a /waitlist form submission fires.
 * Tone: short, brand-voice, "you're on the list."
 */

export function waitlistWelcomeHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're on the FanShare waitlist</title>
</head>
<body style="margin:0;padding:0;background:#09090B;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#FAFAF9;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#09090B;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;padding:0 24px;">
          <tr>
            <td style="padding-bottom:32px;">
              <!-- Logo mark -->
              <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
                <rect x="3" y="5" width="18" height="3" rx="1" fill="#F59E0B"/>
                <rect x="3" y="10.5" width="13" height="3" rx="1" fill="#FAFAF9"/>
                <rect x="3" y="16" width="18" height="3" rx="1" fill="#F59E0B" opacity="0.55"/>
              </svg>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:20px;">
              <p style="margin:0;font-size:13px;font-family:ui-monospace,monospace;text-transform:uppercase;letter-spacing:0.12em;color:#F59E0B;">You're on the list</p>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:20px;">
              <h1 style="margin:0;font-size:28px;font-weight:800;line-height:1.1;letter-spacing:-0.02em;color:#FAFAF9;">
                Your read is queued.
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:24px;">
              <p style="margin:0;font-size:15px;line-height:1.65;color:#A1A1AA;">
                You're on the FanShare waitlist. We'll reach out directly when Demo 2 opens — a real market for NBA player performance, where the gap between stats and price is the trade.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:24px;">
              <p style="margin:0;font-size:15px;line-height:1.65;color:#A1A1AA;">
                Nothing to do for now. We'll have a spot for you.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding-top:24px;border-top:1px solid #27272A;">
              <p style="margin:0;font-size:11px;font-family:ui-monospace,monospace;color:#52525B;line-height:1.55;">
                Practice mode. No real money. No seed phrase. — Frankie
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export const waitlistWelcomeSubject = "You're on the FanShare waitlist";
