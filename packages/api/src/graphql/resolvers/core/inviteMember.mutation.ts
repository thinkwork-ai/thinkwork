import { getConfig, getSecret } from "@thinkwork/runtime-config";
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { GraphQLError } from "graphql";
import { emailProviderInstalls } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  users,
  tenantMembers,
  snakeToCamel,
  eq,
  and,
  randomBytes,
} from "../../utils.js";
import { requireTenantAdmin } from "./authz.js";
import { resolveCallerUserId } from "./resolve-auth-user.js";
import { runWithIdempotency } from "../../../lib/idempotency.js";
import { workspaceFolderName } from "@thinkwork/database-pg/utils/workspace-folder-name";
import {
  COGNITO_INVITE_DELIVERY_FAILURE_MESSAGE,
  createCognitoInviteClient,
  cognitoInviteErrorName,
  isCognitoInviteDeliveryFailure,
  isResendableInviteStatus,
  resendCognitoInvite,
} from "./cognitoInvites.js";
import { createEmailChannelService } from "../../../lib/email-channel/channel-service.js";
import { readStoredEmailProviderApiKey } from "../../../lib/email-channel/secrets.js";
import { providerSafeError } from "../../../lib/email-channel/provider-contract.js";

const cognito = createCognitoInviteClient();
function userPoolId(): string {
  return getConfig("COGNITO_USER_POOL_ID", "");
}

export const inviteMember = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const { tenantId } = args;

  // Gate BEFORE any Cognito write. If authz fails, no Cognito user is
  // created — otherwise a member could spam-create Cognito accounts by
  // calling this with arbitrary tenantIds.
  await requireTenantAdmin(ctx, tenantId);

  const invokerUserId =
    ctx.auth.authType === "apikey"
      ? ctx.auth.principalId
      : await resolveCallerUserId(ctx);

  // Idempotency matters A LOT here — inviteMember's Cognito
  // AdminCreateUser call sends an email to the invitee with a temp
  // password. A retry without the cache would spam the invitee.
  // Existing-user handling inside the core (line 54-71 below) already
  // protects against duplicate Cognito sub creation; runWithIdempotency
  // protects against duplicate email sends + duplicate tenant_members
  // rows on retry.
  return runWithIdempotency({
    tenantId,
    invokerUserId,
    mutationName: "inviteMember",
    inputs: args.input,
    clientKey: args.input?.idempotencyKey ?? null,
    fn: () => inviteMemberCore(tenantId, args.input),
  });
};

async function inviteMemberCore(
  tenantId: string,
  input: {
    email: string;
    name?: string;
    role?: string;
  },
) {
  const { email, name, role } = input;
  const emailChannelDelivery = await resolveInviteEmailChannel(tenantId);
  let pendingChannelInvite: {
    tempPassword: string;
    delivery: InviteEmailChannelDelivery;
  } | null = null;

  // 1. Create the Cognito user (sends temp password email)
  let cognitoSub: string;
  try {
    const tempPassword = emailChannelDelivery
      ? generateTemporaryPassword()
      : null;
    const result = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId(),
        Username: email,
        ...(tempPassword
          ? {
              TemporaryPassword: tempPassword,
              MessageAction: "SUPPRESS" as const,
            }
          : {
              DesiredDeliveryMediums: ["EMAIL"],
            }),
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
          ...(name ? [{ Name: "name", Value: name }] : []),
          { Name: "custom:tenant_id", Value: tenantId },
        ],
      }),
    );
    cognitoSub =
      result.User?.Attributes?.find((a) => a.Name === "sub")?.Value || "";
    if (!cognitoSub) {
      throw new Error("Cognito did not return a sub for the created user");
    }
    if (tempPassword && emailChannelDelivery) {
      pendingChannelInvite = {
        tempPassword,
        delivery: emailChannelDelivery,
      };
    }
  } catch (err: any) {
    // If user already exists in Cognito, look up their sub
    if (err.name === "UsernameExistsException") {
      const existing = await cognito.send(
        new AdminGetUserCommand({
          UserPoolId: userPoolId(),
          Username: email,
        }),
      );
      cognitoSub =
        existing.UserAttributes?.find((a) => a.Name === "sub")?.Value || "";
      if (!cognitoSub) {
        throw new Error("Could not resolve existing Cognito user sub");
      }

      if (isResendableInviteStatus(existing.UserStatus)) {
        if (emailChannelDelivery) {
          const tempPassword = generateTemporaryPassword();
          await cognito.send(
            new AdminSetUserPasswordCommand({
              UserPoolId: userPoolId(),
              Username: email,
              Password: tempPassword,
              Permanent: false,
            }),
          );
          pendingChannelInvite = {
            tempPassword,
            delivery: emailChannelDelivery,
          };
        } else {
          try {
            const resent = await resendCognitoInvite(cognito, {
              userPoolId: userPoolId(),
              email,
            });
            cognitoSub =
              resent.User?.Attributes?.find((a) => a.Name === "sub")?.Value ||
              cognitoSub;
          } catch (resendError) {
            if (isCognitoInviteDeliveryFailure(resendError)) {
              console.warn("inviteMember: Cognito invite resend failed", {
                tenantId,
                errorName: cognitoInviteErrorName(resendError),
                errorMessage:
                  resendError instanceof Error
                    ? resendError.message
                    : String(resendError),
              });
              throw new GraphQLError(COGNITO_INVITE_DELIVERY_FAILURE_MESSAGE, {
                extensions: { code: "DELIVERY_FAILED" },
              });
            }
            throw resendError;
          }
        }
      }
    } else {
      if (isCognitoInviteDeliveryFailure(err)) {
        console.warn("inviteMember: Cognito invite delivery failed", {
          tenantId,
          errorName: cognitoInviteErrorName(err),
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        throw new GraphQLError(COGNITO_INVITE_DELIVERY_FAILURE_MESSAGE, {
          extensions: { code: "DELIVERY_FAILED" },
        });
      }
      throw err;
    }
  }

  // 2. Upsert user row in DB
  const existingUser = await db
    .select()
    .from(users)
    .where(eq(users.id, cognitoSub));
  if (existingUser.length === 0) {
    await db.insert(users).values({
      id: cognitoSub,
      cognito_sub: cognitoSub,
      tenant_id: tenantId,
      email,
      name: name || null,
      workspace_folder_name: workspaceFolderName(name || email, [], "user"),
    });
  }

  // 3. Check if already a tenant member
  const existingMember = await db
    .select()
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenant_id, tenantId),
        eq(tenantMembers.principal_id, cognitoSub),
      ),
    );
  if (existingMember.length > 0) {
    if (pendingChannelInvite) {
      await deliverInviteViaEmailChannel({
        tenantId,
        email,
        name: name ?? null,
        tempPassword: pendingChannelInvite.tempPassword,
        delivery: pendingChannelInvite.delivery,
      });
    }
    return snakeToCamel(existingMember[0]);
  }

  // 4. Add tenant member.
  // principal_type must be lowercase 'user' — every reader gate
  // (canReadTenantSpaces, requester-context, auth-me role lookup, etc.)
  // filters on the lowercase value, and a CHECK constraint enforces
  // lower(principal_type) in drizzle/0118_normalize_tenant_member_principal_type.sql.
  const [row] = await db
    .insert(tenantMembers)
    .values({
      tenant_id: tenantId,
      principal_type: "user",
      principal_id: cognitoSub,
      role: role ?? "member",
      status: "active",
    })
    .returning();

  if (pendingChannelInvite) {
    await deliverInviteViaEmailChannel({
      tenantId,
      email,
      name: name ?? null,
      tempPassword: pendingChannelInvite.tempPassword,
      delivery: pendingChannelInvite.delivery,
    });
  }

  return snakeToCamel(row);
}

type InviteEmailChannelDelivery = {
  providerInstallId: string;
  provider: "resend" | "ses";
  from: string;
  credential: string;
};

async function resolveInviteEmailChannel(
  tenantId: string,
): Promise<InviteEmailChannelDelivery | null> {
  const rows = await db
    .select()
    .from(emailProviderInstalls)
    .where(
      and(
        eq(emailProviderInstalls.tenant_id, tenantId),
        eq(emailProviderInstalls.active_for_production, true),
      ),
    );
  const [provider] = Array.isArray(rows) ? rows : [];
  if (
    !provider ||
    provider.status !== "ready" ||
    !provider.credential_secret_ref ||
    !provider.default_from_email
  ) {
    return null;
  }
  const secret = await getSecret(provider.credential_secret_ref);
  const credential = readStoredEmailProviderApiKey(secret);
  if (!credential) return null;
  return {
    providerInstallId: provider.id,
    provider: provider.provider as "resend" | "ses",
    from: provider.default_from_email,
    credential,
  };
}

async function deliverInviteViaEmailChannel(input: {
  tenantId: string;
  email: string;
  name: string | null;
  tempPassword: string;
  delivery: InviteEmailChannelDelivery;
}) {
  const appUrl = (getConfig("ADMIN_URL", "") || "https://app.thinkwork.ai")
    .trim()
    .replace(/\/$/, "");
  const displayName = input.name || input.email;
  const text = [
    `Hi ${displayName},`,
    "",
    "You've been invited to ThinkWork.",
    "",
    `Sign in: ${appUrl}`,
    `Temporary password: ${input.tempPassword}`,
    "",
    "You'll be asked to choose a new password after signing in.",
  ].join("\n");
  const html = `
    <p>Hi ${escapeHtml(displayName)},</p>
    <p>You've been invited to ThinkWork.</p>
    <p><a href="${escapeHtml(appUrl)}">Sign in to ThinkWork</a></p>
    <p>Temporary password: <strong>${escapeHtml(input.tempPassword)}</strong></p>
    <p>You'll be asked to choose a new password after signing in.</p>
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
      idempotencyKey: `tenant-invite:${input.tenantId}:${input.email}`,
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

function generateTemporaryPassword(): string {
  return `${randomBytes(12).toString("base64url")}Aa1!`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
