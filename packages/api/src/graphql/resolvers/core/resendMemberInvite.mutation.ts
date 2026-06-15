import { getConfig } from "@thinkwork/runtime-config";
import { AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { and, db, eq, tenantMembers, users } from "../../utils.js";
import { runWithIdempotency } from "../../../lib/idempotency.js";
import { requireTenantAdmin } from "./authz.js";
import { resolveCallerUserId } from "./resolve-auth-user.js";
import {
  createCognitoInviteClient,
  isResendableInviteStatus,
  resendCognitoInvite,
} from "./cognitoInvites.js";

const cognito = createCognitoInviteClient();

const DELIVERY_FAILURE_NAMES = new Set([
  "CodeDeliveryFailureException",
  "InvalidEmailRoleAccessPolicyException",
]);
const DELIVERY_FAILURE_MESSAGE =
  "Invite delivery failed because the email provider rejected the send. Check SES recipient/domain verification.";

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
    fn: () => resendPendingInvite(tenantId, input.memberId, target.email),
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
): Promise<{ email: string; cognitoStatus: string | null }> {
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
  return { email: user.email, cognitoStatus: existing.UserStatus ?? null };
}

async function resendPendingInvite(
  tenantId: string,
  memberId: string,
  email: string,
): Promise<ResendMemberInviteResult> {
  try {
    await resendCognitoInvite(cognito, {
      userPoolId: userPoolId(),
      email,
    });
  } catch (err) {
    if (isDeliveryFailure(err)) {
      console.warn("resendMemberInvite: Cognito invite delivery failed", {
        tenantId,
        memberId,
        errorName: errorName(err),
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return {
        status: "DELIVERY_FAILED",
        message: DELIVERY_FAILURE_MESSAGE,
      };
    }
    throw err;
  }

  return {
    status: "RESENT",
    message: "Invite resent.",
  };
}

function isDeliveryFailure(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    typeof (err as { name?: unknown }).name === "string" &&
    DELIVERY_FAILURE_NAMES.has((err as { name: string }).name)
  );
}

function errorName(err: unknown): string | null {
  return typeof err === "object" &&
    err !== null &&
    "name" in err &&
    typeof (err as { name?: unknown }).name === "string"
    ? (err as { name: string }).name
    : null;
}
