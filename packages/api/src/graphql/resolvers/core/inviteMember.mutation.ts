import { getConfig } from "@thinkwork/runtime-config";
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  users,
  tenantMembers,
  snakeToCamel,
  eq,
  and,
  or,
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
import {
  deliverInviteViaEmailChannel,
  generateTemporaryPassword,
  resolveInviteEmailChannel,
  type InviteEmailChannelDelivery,
} from "./member-invite-delivery.js";
import { issueEnrollmentGrants } from "../../../handlers/auth-enrollment.js";
import {
  authProviderResources,
  userAuthIdentities,
} from "@thinkwork/database-pg/schema";

const cognito = createCognitoInviteClient();
function userPoolId(): string {
  return getConfig("COGNITO_USER_POOL_ID", "");
}

function enrollmentRedirectUri(): string {
  const appUrl = (getConfig("ADMIN_URL", "") || "https://app.thinkwork.ai")
    .trim()
    .replace(/\/$/, "");
  return `${appUrl}/auth/callback`;
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

  // Cognito delivery proves possession of the local Cognito credential. Keep
  // the user, membership, and exact identity binding in one transaction so a
  // partial write can never create an admitted membership without its proof.
  // Custom-channel invitations stay pending and continue through the
  // recipient-challenge enrollment flow.
  const persisted = await db.transaction(async (tx) => {
    const existingUsers = await tx
      .select()
      .from(users)
      .where(or(eq(users.id, cognitoSub), eq(users.cognito_sub, cognitoSub)));
    if (existingUsers.length > 1) {
      throw inviteIdentityConflict();
    }

    const existingUser = existingUsers[0];
    if (existingUser?.cognito_sub && existingUser.cognito_sub !== cognitoSub) {
      throw inviteIdentityConflict();
    }
    const userId = existingUser?.id ?? cognitoSub;
    if (!existingUser) {
      await tx.insert(users).values({
        id: userId,
        cognito_sub: cognitoSub,
        tenant_id: tenantId,
        email,
        name: name || null,
        workspace_folder_name: workspaceFolderName(name || email, [], "user"),
      });
    }

    const existingMembers = await tx
      .select()
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenant_id, tenantId),
          eq(tenantMembers.principal_id, userId),
        ),
      );

    // principal_type must be lowercase 'user' — every reader gate filters on
    // the lowercase value, and the database CHECK constraint enforces it.
    const [member] =
      existingMembers.length > 0
        ? existingMembers
        : await tx
            .insert(tenantMembers)
            .values({
              tenant_id: tenantId,
              principal_type: "user",
              principal_id: userId,
              role: role ?? "member",
              status: emailChannelDelivery ? "pending" : "active",
            })
            .returning();
    if (!member) {
      throw new Error("Failed to persist tenant membership");
    }

    if (!emailChannelDelivery) {
      await bindDefaultCognitoInviteIdentity(tx, {
        tenantId,
        userId,
        cognitoSub,
      });
    }

    const enrollment = pendingChannelInvite
      ? await issueEnrollmentGrants({
          tenantId,
          intendedUserId: userId,
          membershipId: member.id,
          redirectUri: enrollmentRedirectUri(),
          additionalRoutes: [mobileEnrollmentRoute()],
          transaction: tx,
        })
      : null;

    return { member, enrollment };
  });

  if (pendingChannelInvite && persisted.enrollment) {
    await deliverInviteViaEmailChannel({
      tenantId,
      email,
      name: name ?? null,
      tempPassword: pendingChannelInvite.tempPassword,
      delivery: pendingChannelInvite.delivery,
      enrollment: persisted.enrollment,
    });
  }

  return snakeToCamel(persisted.member);
}

type InviteTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function bindDefaultCognitoInviteIdentity(
  tx: InviteTransaction,
  input: { tenantId: string; userId: string; cognitoSub: string },
): Promise<void> {
  const poolId = userPoolId();
  const localResources = await tx
    .select()
    .from(authProviderResources)
    .where(
      and(
        eq(authProviderResources.cognito_user_pool_id, poolId),
        eq(authProviderResources.provider_kind, "local"),
        eq(authProviderResources.cognito_identity_provider_name, "COGNITO"),
        eq(authProviderResources.lifecycle_state, "native"),
      ),
    );
  const admittedResources = localResources.filter((resource) =>
    ["valid", "partially_valid"].includes(resource.validation_status),
  );
  if (admittedResources.length !== 1) {
    throw new GraphQLError(
      "The local Cognito authentication route is not ready for invitations.",
      { extensions: { code: "AUTH_ROUTE_UNAVAILABLE" } },
    );
  }

  const resource = admittedResources[0];
  const cognitoIssuer = cognitoIssuerForPool(poolId);
  const identities = await tx
    .select()
    .from(userAuthIdentities)
    .where(
      and(
        eq(userAuthIdentities.cognito_issuer, cognitoIssuer),
        eq(userAuthIdentities.cognito_sub, input.cognitoSub),
      ),
    );
  if (identities.length > 1) {
    throw inviteIdentityConflict();
  }
  const identity = identities[0];
  if (identity) {
    if (
      identity.user_id !== input.userId ||
      identity.auth_provider_resource_id !== resource.id ||
      identity.provider_issuer !== cognitoIssuer ||
      identity.provider_subject !== input.cognitoSub ||
      identity.status !== "active"
    ) {
      throw inviteIdentityConflict();
    }
    return;
  }

  const now = new Date();
  await tx.insert(userAuthIdentities).values({
    tenant_id: input.tenantId,
    user_id: input.userId,
    auth_provider_resource_id: resource.id,
    cognito_issuer: cognitoIssuer,
    cognito_sub: input.cognitoSub,
    provider_issuer: cognitoIssuer,
    provider_subject: input.cognitoSub,
    status: "active",
    proof_kind: "cognito_temporary_password_invite",
    evidence: {
      source: "cognito_default_invite",
      userPoolId: poolId,
      connectionKey: resource.connection_key,
    },
    activated_at: now,
  });
}

function cognitoIssuerForPool(poolId: string): string {
  const poolRegion = /^([a-z]{2}(?:-gov)?-[a-z]+-\d)_/.exec(poolId)?.[1];
  const region =
    poolRegion || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region) {
    throw new Error("AWS region is required to bind a Cognito invitation");
  }
  return `https://cognito-idp.${region}.amazonaws.com/${poolId}`;
}

function inviteIdentityConflict(): GraphQLError {
  return new GraphQLError(
    "This Cognito identity is already bound to another ThinkWork identity.",
    { extensions: { code: "IDENTITY_CONFLICT" } },
  );
}

function mobileEnrollmentRoute() {
  return {
    clientFamily: "mobile" as const,
    redirectUri:
      process.env.MOBILE_OAUTH_REDIRECT_URI ?? "thinkwork://auth/callback",
  };
}
