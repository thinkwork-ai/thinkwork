/**
 * Send the "finish setting up your account" email after a successful
 * Stripe Checkout Session. Called by stripe-webhook after
 * provisionTenantFromStripeSession commits.
 *
 * Non-fatal: if SES fails, we log + return false so the webhook still
 * ack's 200 (the tenant row exists with pending_owner_email set, so the
 * operator has a manual-recovery path). Stripe already ack'd the event
 * via the stripe_events idempotency gate, so letting the webhook fail
 * here would just put Stripe into retry → PK conflict → 200 replay,
 * which never re-triggers the email. Better to leave a single loud log
 * line for the operator.
 *
 * Sender defaults to hello@agents.thinkwork.ai (the already-verified SES
 * inbound domain). Override via STRIPE_WELCOME_FROM_EMAIL env var once a
 * hello@thinkwork.ai identity is verified in SES.
 */

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

export interface WelcomeEmailInput {
	email: string;
	plan: string;
	tenantId: string;
	sessionId: string;
	adminUrl: string;
}

const DEFAULT_FROM_EMAIL = "hello@agents.thinkwork.ai";

let sesClient: SESClient | null = null;
function getSes(): SESClient {
	if (!sesClient) {
		sesClient = new SESClient({
			region: process.env.AWS_REGION || "us-east-1",
		});
	}
	return sesClient;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function buildWelcomeLink(adminUrl: string, sessionId: string): string {
	// Mirrors the Stripe success_url. Clicking this link is equivalent to
	// re-visiting the post-checkout landing page (which kicks Google OAuth
	// and lets bootstrapUser claim the paid tenant).
	const base = adminUrl.replace(/\/$/, "");
	return `${base}/onboarding/welcome?session_id=${encodeURIComponent(sessionId)}`;
}

export async function sendStripeWelcomeEmail(
	input: WelcomeEmailInput,
): Promise<boolean> {
	const fromEmail =
		process.env.STRIPE_WELCOME_FROM_EMAIL || DEFAULT_FROM_EMAIL;
	const link = buildWelcomeLink(input.adminUrl, input.sessionId);

	const planLabel =
		input.plan && input.plan !== "unknown"
			? input.plan.charAt(0).toUpperCase() + input.plan.slice(1)
			: "";
	const subject = planLabel
		? `Welcome to ThinkWork ${planLabel} — finish setting up your account`
		: "Welcome to ThinkWork — finish setting up your account";

	const textBody = [
		`Payment received — thank you.`,
		``,
		planLabel
			? `Your ThinkWork ${planLabel} workspace is ready.`
			: `Your ThinkWork workspace is ready.`,
		``,
		`Finish setting up your account:`,
		link,
		``,
		`You'll sign in with Google to claim your workspace. If you paid with a different email than the one tied to your Google account, let us know — hello@thinkwork.ai.`,
		``,
		`— ThinkWork`,
	].join("\n");

	const htmlBody = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#070a0f;color:#e2e8f0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="background:#0b1220;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:32px;">
            <tr><td style="font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:#38bdf8;">Payment received</td></tr>
            <tr><td style="padding-top:16px;font-size:22px;font-weight:700;line-height:1.25;color:#f1f5f9;">
              ${planLabel ? `Welcome to ThinkWork ${escapeHtml(planLabel)}.` : `Welcome to ThinkWork.`}
            </td></tr>
            <tr><td style="padding-top:12px;font-size:15px;line-height:1.6;color:#cbd5e1;">
              Your workspace is ready. Sign in with Google to claim it and finish onboarding.
            </td></tr>
            <tr><td style="padding-top:28px;">
              <a href="${escapeHtml(link)}" style="display:inline-block;background:#38bdf8;color:#020617;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:12px;">Finish setting up my account</a>
            </td></tr>
            <tr><td style="padding-top:28px;font-size:12px;line-height:1.6;color:#64748b;">
              If the button doesn't work, paste this URL into your browser:<br>
              <span style="word-break:break-all;">${escapeHtml(link)}</span>
            </td></tr>
            <tr><td style="padding-top:28px;font-size:12px;line-height:1.6;color:#64748b;">
              Paid with a different email than your Google account? Reply to this message or email hello@thinkwork.ai.
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

	try {
		const res = await getSes().send(
			new SendEmailCommand({
				Source: fromEmail,
				Destination: { ToAddresses: [input.email] },
				Message: {
					Subject: { Data: subject, Charset: "UTF-8" },
					Body: {
						Text: { Data: textBody, Charset: "UTF-8" },
						Html: { Data: htmlBody, Charset: "UTF-8" },
					},
				},
				ReplyToAddresses: ["hello@thinkwork.ai"],
			}),
		);
		console.log(
			`[stripe-welcome-email] Sent from=${fromEmail} to=${input.email} tenantId=${input.tenantId} sesMessageId=${res.MessageId}`,
		);
		return true;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(
			`[stripe-welcome-email] SES send failed from=${fromEmail} to=${input.email} tenantId=${input.tenantId}: ${msg}`,
		);
		return false;
	}
}
