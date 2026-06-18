import { getConfig, getSecret } from "@thinkwork/runtime-config";
import { GraphQLError } from "graphql";
import { emailProviderInstalls } from "@thinkwork/database-pg/schema";
import { db, eq, randomBytes } from "../../utils.js";
import { createEmailChannelService } from "../../../lib/email-channel/channel-service.js";
import { readStoredEmailProviderApiKey } from "../../../lib/email-channel/secrets.js";
import { providerSafeError } from "../../../lib/email-channel/provider-contract.js";

export type InviteEmailChannelDelivery = {
  providerInstallId: string;
  provider: "resend" | "sendgrid" | "ses";
  from: string;
  credential: string;
};

export async function resolveInviteEmailChannel(
  tenantId: string,
): Promise<InviteEmailChannelDelivery | null> {
  const rows = await db
    .select()
    .from(emailProviderInstalls)
    .where(eq(emailProviderInstalls.tenant_id, tenantId));
  const providers = Array.isArray(rows) ? rows : [];
  const activeProvider = providers.find(
    (provider) => provider.active_for_production,
  );
  const configuredResendProvider = providers.find(
    (provider) =>
      provider.provider === "resend" &&
      provider.credential_secret_ref &&
      provider.default_from_email,
  );
  const provider = activeProvider ?? configuredResendProvider ?? null;

  if (!provider) {
    return null;
  }

  if (provider.provider === "ses") {
    return null;
  }

  if (provider.provider === "sendgrid" && provider.status !== "ready") {
    throw new GraphQLError(
      "Invite delivery is configured for SendGrid, but SendGrid is not ready. Check the API key and authenticated sending domain in Settings.",
      {
        extensions: { code: "DELIVERY_FAILED" },
      },
    );
  }

  if (!provider.credential_secret_ref || !provider.default_from_email) {
    throw new GraphQLError(
      `Invite delivery is configured for the ${provider.provider} email channel, but the provider credential or sender address is missing.`,
      {
        extensions: { code: "DELIVERY_FAILED" },
      },
    );
  }

  const secret = await getSecret(provider.credential_secret_ref);
  const credential = readStoredEmailProviderApiKey(secret);
  if (!credential) {
    throw new GraphQLError(
      `Invite delivery is configured for the ${provider.provider} email channel, but the stored credential could not be read.`,
      {
        extensions: { code: "DELIVERY_FAILED" },
      },
    );
  }

  return {
    providerInstallId: provider.id,
    provider: provider.provider as "resend" | "sendgrid" | "ses",
    from: provider.default_from_email,
    credential,
  };
}

export async function deliverInviteViaEmailChannel(input: {
  tenantId: string;
  email: string;
  name: string | null;
  tempPassword: string;
  delivery: InviteEmailChannelDelivery;
  idempotencyKey?: string;
}) {
  const appUrl = (getConfig("ADMIN_URL", "") || "https://app.thinkwork.ai")
    .trim()
    .replace(/\/$/, "");
  const signInUrl = `${appUrl}/sign-in`;
  const logoUrl = `${appUrl}/logo.png`;
  const displayName = input.name || input.email;
  const text = [
    `Hi ${displayName},`,
    "",
    "You've been invited to ThinkWork.",
    "",
    `Sign in: ${signInUrl}`,
    `Temporary password: ${input.tempPassword}`,
    "",
    "You'll be asked to choose a new password after signing in.",
  ].join("\n");
  const html = `
    <!doctype html>
    <html>
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>You're invited to ThinkWork</title>
      </head>
      <body style="margin:0; padding:0; background:#f5f7fb; color:#111827; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb; margin:0; padding:32px 16px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden;">
                <tr>
                  <td style="padding:32px 32px 20px;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="vertical-align:middle; padding-right:12px;">
                          <img src="${escapeHtml(logoUrl)}" width="40" height="40" alt="ThinkWork" style="display:block; border:0; border-radius:10px;" />
                        </td>
                        <td style="vertical-align:middle;">
                          <div style="font-size:18px; font-weight:700; color:#111827; line-height:24px;">ThinkWork</div>
                          <div style="font-size:13px; color:#6b7280; line-height:18px;">Workspace invitation</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 32px 32px;">
                    <h1 style="margin:0 0 16px; font-size:28px; line-height:36px; color:#111827; font-weight:700;">You're invited to ThinkWork</h1>
                    <p style="margin:0 0 20px; font-size:16px; line-height:24px; color:#374151;">Hi ${escapeHtml(displayName)}, an admin invited you to join their ThinkWork workspace.</p>
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                      <tr>
                        <td bgcolor="#111827" style="border-radius:8px;">
                          <a href="${escapeHtml(signInUrl)}" style="display:inline-block; padding:12px 18px; color:#ffffff; text-decoration:none; font-size:15px; line-height:20px; font-weight:700;">Sign in to ThinkWork</a>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:0 0 8px; font-size:13px; line-height:18px; color:#6b7280; text-transform:uppercase; font-weight:700;">Temporary password</p>
                    <div style="margin:0 0 20px; padding:14px 16px; background:#f9fafb; border:1px solid #d1d5db; border-radius:8px; color:#111827; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace; font-size:18px; line-height:24px; font-weight:700;">${escapeHtml(input.tempPassword)}</div>
                    <p style="margin:0 0 20px; font-size:15px; line-height:23px; color:#4b5563;">You'll be asked to choose a new password after signing in.</p>
                    <p style="margin:0; font-size:13px; line-height:20px; color:#6b7280;">If the button does not work, paste this URL into your browser:<br /><a href="${escapeHtml(signInUrl)}" style="color:#2563eb; text-decoration:underline;">${escapeHtml(signInUrl)}</a></p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  try {
    await createEmailChannelService().send(input.delivery.provider, {
      tenantId: input.tenantId,
      providerInstallId: input.delivery.providerInstallId,
      from: input.delivery.from,
      to: [input.email],
      subject: "You're invited to ThinkWork",
      text,
      html,
      credential: input.delivery.credential,
      idempotencyKey:
        input.idempotencyKey ??
        `tenant-invite:${input.tenantId}:${input.email}`,
      tags: {
        category: "tenant_invite",
        tenantId: input.tenantId,
      },
    });
  } catch (error) {
    const safe = providerSafeError(error);
    console.warn("inviteMember: email channel invite delivery failed", {
      tenantId: input.tenantId,
      provider: input.delivery.provider,
      code: safe.code,
      message: safe.message,
    });
    throw new GraphQLError(
      `Invite delivery failed through the active email channel: ${safe.message}`,
      {
        extensions: { code: "DELIVERY_FAILED" },
      },
    );
  }
}

export function generateTemporaryPassword(): string {
  return `${randomBytes(12).toString("base64url")}Aa1!`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
