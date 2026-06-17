import { getConfig } from "@thinkwork/runtime-config";
import {
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { and, db, eq, tenantMembers, users } from "../../utils.js";
import { runWithIdempotency } from "../../../lib/idempotency.js";
import { requireTenantAdmin } from "./authz.js";
import { resolveCallerUserId } from "./resolve-auth-user.js";
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
} from "./member-invite-delivery.js";

const cognito = createCognitoInviteClient();

type ResendMemberInviteStatus = "RESENT" | "NOT_PENDING" | "DELIVERY_FAILED";

interface ResendMemberInviteInput {
  memberId: string;
  idempotencyKey: string;
}

interface ResendMemberInviteArgs {
  tenantId: string;
  input: ResendMemberInviteInput;
}

interface ResendMemberInviteResult {
  status: ResendMemberInviteStatus;
  message: string;
}

function userPoolId(): string {
  return getConfig("COGNITO_USER_POOL_ID", "");
}

export const resendMemberInvite = async (
  _parent: unknown,
  args: ResendMemberInviteArgs,
  ctx: GraphQLContext,
): Promise<ResendMemberInviteResult> => {
  const { tenantId } = args;
  const { input } = args;

  await requireTenantAdmin(ctx, tenantId);
  validateInput(input);

  const invokerUserId =
    ctx.auth.authType === "apikey"
      ? ctx.auth.principalId
      : await resolveCallerUserId(ctx);

  const target = await resolveResendTarget(tenantId, input.memberId);
  if (!isResendableInviteStatus(target.cognitoStatus)) {
    return notPendingResult(target.cognitoStatus);
  }

  return runWithIdempotency<ResendMemberInviteResult>({
    tenantId,
    invokerUserId,
    mutationName: "resendMemberInvite",
    inputs: { memberId: input.memberId },
    clientKey: input.idempotencyKey,
    fn: () =>
      resendPendingInvite(
        tenantId,
        input.memberId,
        target.email,
        target.name,
        input.idempotencyKey,
      ),
  });
};

function validateInput(input: ResendMemberInviteInput): void {
  if (input.idempotencyKey.trim().length === 0) {
    throw new GraphQLError("idempotencyKey is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
}

function notPendingResult(
  cognitoStatus: string | null,
): ResendMemberInviteResult {
  return {
    status: "NOT_PENDING",
    message: cognitoStatus
      ? `Invite not resent because Cognito user status is ${cognitoStatus}.`
      : "Invite not resent because Cognito user status is unavailable.",
  };
}

async function resolveResendTarget(
  tenantId: string,
  memberId: string,
): Promise<{
  email: string;
  name: string | null;
  cognitoStatus: string | null;
}> {
  const [member] = await db
    .select()
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.id, memberId),
        eq(tenantMembers.tenant_id, tenantId),
      ),
    );

  if (!member || member.principal_type?.toLowerCase() !== "user") {
    throw new GraphQLError("Member not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, member.principal_id));

  if (!user?.email) {
    throw new GraphQLError("Member user email not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }

  const existing = await cognito.send(
    new AdminGetUserCommand({
      UserPoolId: userPoolId(),
      Username: user.email,
    }),
  );
  return {
    email: user.email,
    name: typeof user.name === "string" ? user.name : null,
    cognitoStatus: existing.UserStatus ?? null,
  };
}

async function resendPendingInvite(
  tenantId: string,
  memberId: string,
  email: string,
  name: string | null,
  idempotencyKey: string,
): Promise<ResendMemberInviteResult> {
  const emailChannelDelivery = await resolveInviteEmailChannel(tenantId);
  if (emailChannelDelivery) {
    return resendPendingInviteViaEmailChannel({
      tenantId,
      memberId,
      email,
      name,
      idempotencyKey,
      delivery: emailChannelDelivery,
    });
  }

  try {
    await resendCognitoInvite(cognito, {
      userPoolId: userPoolId(),
      email,
    });
  } catch (err) {
    if (isCognitoInviteDeliveryFailure(err)) {
      console.warn("resendMemberInvite: Cognito invite delivery failed", {
        tenantId,
        memberId,
        errorName: cognitoInviteErrorName(err),
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return {
        status: "DELIVERY_FAILED",
        message: COGNITO_INVITE_DELIVERY_FAILURE_MESSAGE,
      };
    }
    throw err;
  }

  return {
    status: "RESENT",
    message: "Invite resent.",
  };
}

async function resendPendingInviteViaEmailChannel(input: {
  tenantId: string;
  memberId: string;
  email: string;
  name: string | null;
  idempotencyKey: string;
  delivery: Awaited<ReturnType<typeof resolveInviteEmailChannel>>;
}): Promise<ResendMemberInviteResult> {
  if (!input.delivery) {
    throw new Error("email channel delivery is required");
  }

  const tempPassword = generateTemporaryPassword();
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId(),
      Username: input.email,
      Password: tempPassword,
      Permanent: false,
    }),
  );

  try {
    await deliverInviteViaEmailChannel({
      tenantId: input.tenantId,
      email: input.email,
      name: input.name,
      tempPassword,
      delivery: input.delivery,
      idempotencyKey: `tenant-invite-resend:${input.tenantId}:${input.memberId}:${input.idempotencyKey}`,
    });
  } catch (error) {
    if (error instanceof GraphQLError) {
      return {
        status: "DELIVERY_FAILED",
        message: error.message,
      };
    }
    throw error;
  }

  return {
    status: "RESENT",
    message: "Invite resent.",
  };
}
