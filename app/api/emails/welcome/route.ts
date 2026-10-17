import { Resend } from 'resend';

/**
 * POST /api/emails/welcome { address, identity }
 *
 * Sends the new-contributor welcome email from the Scout brand: logo,
 * wallet address, and what happens next. Called once per wallet right after
 * the embedded wallet is ready on the client.
 *
 * Env: RESEND_API_KEY (server-only), EMAIL_FROM (e.g. Scout <hello@scout.example>).
 * Without a key it returns { skipped: true } so local and fork rehearsals
 * never break on missing email config.
 */
export async function POST(request: Request) {
  try {
    const { address, identity } = (await request.json()) as { address?: string; identity?: string };
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return Response.json({ error: 'Invalid address.' }, { status: 400 });
    }
    const apiKey = process.env.RESEND_API_KEY ?? '';
    const from = process.env.EMAIL_FROM ?? '';
    if (!apiKey || !from) return Response.json({ skipped: true, reason: 'Email is not configured.' });

    const appUrl = process.env.APP_URL ?? 'https://scout.example';
    const logo = `${appUrl}/scout-icon.svg`;
    const resend = new Resend(apiKey);
    const to = (identity ?? '').includes('@') ? identity! : null;
    if (!to) return Response.json({ skipped: true, reason: 'No email address for this account.' });

    const { error } = await resend.emails.send({
      from,
      to,
      subject: 'Your Scout wallet is ready — earn for what you can see',
      html: `
<!doctype html>
<html><body style="margin:0;background:#FBFAF7;color:#10140F;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FBFAF7;padding:32px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #E5E2D9;border-radius:20px;padding:32px;">
<tr><td>
<img src="${logo}" width="56" height="56" alt="Scout" style="border-radius:12px;" />
<h1 style="font-size:24px;margin:16px 0 8px;color:#10140F;">Your Scout wallet is ready</h1>
<p style="color:#4C554E;font-size:15px;line-height:1.6;">Agents ask questions only someone on the ground can answer. Answer from your phone, and when your answer agrees with other contributors you are paid in USDC on Celo.</p>
<p style="font-family:monospace;font-size:13px;color:#4C554E;word-break:break-all;">${address}</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
<tr><td style="padding:8px 0;color:#4C554E;font-size:14px;">1. Find an open task</td></tr>
<tr><td style="padding:8px 0;color:#4C554E;font-size:14px;">2. Submit your answer on-chain</td></tr>
<tr><td style="padding:8px 0;color:#4C554E;font-size:14px;">3. Get paid when the answers agree</td></tr>
</table>
<a href="${appUrl}/contribute" style="display:inline-block;background:#06302A;color:#FFFFFF;font-weight:600;padding:12px 28px;border-radius:999px;text-decoration:none;font-size:15px;">Find a task</a>
<p style="color:#8A938C;font-size:12px;margin-top:24px;">Each answer costs under $0.01 in network fees. You were signed in as ${to}.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
    });
    if (error) throw new Error(error.message);
    return Response.json({ sent: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Email failed.' },
      { status: 500 },
    );
  }
}
