import { getConfig } from "@thinkwork/runtime-config";
import { AdminSetUserPasswordCommand } from "@aws-sdk/client-cognito-identity-provider";
import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { and, db, eq, tenantMembers, users } from "../../utils.js";
import { requireTenantAdmin } from "./authz.js";
import { createCognitoInviteClient } from "./cognitoInvites.js";

const cognito = createCognitoInviteClient();

interface SetTenantMemberPasswordInput {
  memberId: string;
  password: string;
  permanent?: boolean | null;
}

interface SetTenantMemberPasswordArgs {
  tenantId: string;
  input: SetTenantMemberPasswordInput;
}

function userPoolId(): string {
  return getConfig("COGNITO_USER_POOL_ID", "");
}

export const setTenantMemberPassword = async (
  _parent: unknown,
  args: SetTenantMemberPasswordArgs,
  ctx: GraphQLContext,
) => {
  const input = normalizeInput(args.input);

  await requireTenantAdmin(ctx, args.tenantId);
  const target = await resolveTarget(args.tenantId, input.memberId);

  const poolId = userPoolId();
  if (!poolId) {
    throw new GraphQLError("COGNITO_USER_POOL_ID not configured", {
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  }

  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: poolId,
      Username: target.email,
      Password: input.password,
      Permanent: input.permanent,
    }),
  );

  return {
    status: input.permanent ? "PASSWORD_SET" : "TEMPORARY_PASSWORD_SET",
    message: input.permanent
      ? "Password set."
      : "Temporary password set. The user must choose a new password at next sign-in.",
  };
};

function normalizeInput(input: SetTenantMemberPasswordInput) {
  const memberId = input.memberId?.trim();
  const password = input.password ?? "";
  if (!memberId) {
    throw new GraphQLError("memberId is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  if (password.length < 8) {
    throw new GraphQLError("Password must be at least 8 characters.", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  return {
    memberId,
    password,
    permanent: input.permanent ?? true,
  };
}

async function resolveTarget(tenantId: string, memberId: string) {
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

  return {
    email: user.email,
  };
}
