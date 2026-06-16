import { getConfig } from "@thinkwork/runtime-config";
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  and,
  db,
  eq,
  randomBytes,
  snakeToCamel,
  tenantMembers,
  users,
} from "../../utils.js";
import { runWithIdempotency } from "../../../lib/idempotency.js";
import { ensureDefaultThreadSpace } from "../../../lib/spaces/default-space.js";
import { requireTenantAdmin, type TenantAdminRole } from "./authz.js";
import { resolveCallerUserId } from "./resolve-auth-user.js";
import { workspaceFolderName } from "@thinkwork/database-pg/utils/workspace-folder-name";
import { createCognitoInviteClient } from "./cognitoInvites.js";

const cognito = createCognitoInviteClient();
const VALID_ROLES = new Set(["member", "admin", "owner"]);

interface AddManualUserInput {
  email: string;
  name?: string | null;
  role?: string | null;
  idempotencyKey: string;
}

interface AddManualUserArgs {
  tenantId: string;
  input: AddManualUserInput;
}

interface NormalizedAddManualUserInput {
  email: string;
  name: string | null;
  role: string;
  idempotencyKey: string;
}

function userPoolId(): string {
  return getConfig("COGNITO_USER_POOL_ID", "");
}

export const addManualUser = async (
  _parent: unknown,
  args: AddManualUserArgs,
  ctx: GraphQLContext,
) => {
  const tenantId = args.tenantId;
  const input = normalizeInput(args.input);
  const callerRole = await requireTenantAdmin(ctx, tenantId);
  validateRole(input.role, callerRole);
  await assertNotExistingTenantMember(tenantId, input.email);

  const invokerUserId =
    ctx.auth.authType === "apikey"
      ? ctx.auth.principalId
      : await resolveCallerUserId(ctx);

  return runWithIdempotency({
    tenantId,
    invokerUserId,
    mutationName: "addManualUser",
    inputs: {
      email: input.email,
      name: input.name,
      role: input.role,
    },
    clientKey: input.idempotencyKey,
    fn: () => addManualUserCore(tenantId, input),
  });
};

function normalizeInput(
  input: AddManualUserInput,
): NormalizedAddManualUserInput {
  const email = input.email.trim().toLowerCase();
  const name = input.name?.trim() || null;
  const role = input.role?.trim() || "member";
  const idempotencyKey = input.idempotencyKey.trim();

  if (!email || !email.includes("@")) {
    throw new GraphQLError(
      "email is required and must look like an email address",
      {
        extensions: { code: "BAD_USER_INPUT" },
      },
    );
  }
  if (!idempotencyKey) {
    throw new GraphQLError("idempotencyKey is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  if (!VALID_ROLES.has(role)) {
    throw new GraphQLError("role must be member, admin, or owner", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  return { email, name, role, idempotencyKey };
}

function validateRole(role: string, callerRole: TenantAdminRole): void {
  if (role === "owner" && callerRole !== "owner") {
    throw new GraphQLError("Only owners can add another owner", {
      extensions: { code: "FORBIDDEN" },
    });
  }
}

async function assertNotExistingTenantMember(
  tenantId: string,
  email: string,
): Promise<void> {
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  if (!existingUser) return;

  const [existingMember] = await db
    .select({ id: tenantMembers.id })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenant_id, tenantId),
        eq(tenantMembers.principal_type, "user"),
        eq(tenantMembers.principal_id, existingUser.id),
        eq(tenantMembers.status, "active"),
      ),
    );

  if (existingMember) {
    throw new GraphQLError("User is already an active member of this tenant", {
      extensions: { code: "ALREADY_MEMBER" },
    });
  }
}

async function addManualUserCore(
  tenantId: string,
  input: NormalizedAddManualUserInput,
) {
  const cognitoSub = await ensureManualCognitoUser(tenantId, input);
  const userId = await upsertUserRow(tenantId, input, cognitoSub);

  const [existingMember] = await db
    .select()
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenant_id, tenantId),
        eq(tenantMembers.principal_type, "user"),
        eq(tenantMembers.principal_id, userId),
      ),
    );
  if (existingMember) {
    await ensureManualUserWorkspaceAccess(tenantId, userId);
    return snakeToCamel(existingMember);
  }

  const [row] = await db
    .insert(tenantMembers)
    .values({
      tenant_id: tenantId,
      principal_type: "user",
      principal_id: userId,
      role: input.role,
      status: "active",
    })
    .returning();

  await ensureManualUserWorkspaceAccess(tenantId, userId);

  return snakeToCamel(row);
}

async function ensureManualUserWorkspaceAccess(
  tenantId: string,
  userId: string,
) {
  await ensureDefaultThreadSpace({ tenantId, userId });
}

async function ensureManualCognitoUser(
  tenantId: string,
  input: NormalizedAddManualUserInput,
): Promise<string> {
  const poolId = userPoolId();
  if (!poolId) {
    throw new GraphQLError("COGNITO_USER_POOL_ID not configured", {
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  }

  let sub: string;
  try {
    const created = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: poolId,
        Username: input.email,
        UserAttributes: userAttributes(tenantId, input),
        MessageAction: "SUPPRESS",
      }),
    );
    sub = extractSub(created.User?.Attributes);
  } catch (err) {
    if (!isCognitoError(err, "UsernameExistsException")) throw err;
    sub = await resolveExistingCognitoSub(poolId, input.email);
  }

  await cognito.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: poolId,
      Username: input.email,
      UserAttributes: userAttributes(tenantId, input),
    }),
  );
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: poolId,
      Username: input.email,
      Password: generateHiddenPassword(),
      Permanent: true,
    }),
  );

  return sub;
}

async function resolveExistingCognitoSub(
  poolId: string,
  email: string,
): Promise<string> {
  const existing = await cognito.send(
    new AdminGetUserCommand({
      UserPoolId: poolId,
      Username: email,
    }),
  );
  return extractSub(existing.UserAttributes);
}

function userAttributes(tenantId: string, input: NormalizedAddManualUserInput) {
  return [
    { Name: "email", Value: input.email },
    { Name: "email_verified", Value: "true" },
    ...(input.name ? [{ Name: "name", Value: input.name }] : []),
    { Name: "custom:tenant_id", Value: tenantId },
  ];
}

function extractSub(
  attributes: { Name?: string; Value?: string }[] | undefined,
): string {
  const sub = attributes?.find((a) => a.Name === "sub")?.Value;
  if (!sub) {
    throw new Error("Could not resolve Cognito user sub");
  }
  return sub;
}

function generateHiddenPassword(): string {
  return `Tnwk-${randomBytes(24).toString("base64url")}Aa1!`;
}

async function upsertUserRow(
  tenantId: string,
  input: NormalizedAddManualUserInput,
  cognitoSub: string,
): Promise<string> {
  const [bySub] = await db.select().from(users).where(eq(users.id, cognitoSub));
  if (bySub) return bySub.id;

  const [byEmail] = await db
    .select()
    .from(users)
    .where(eq(users.email, input.email));
  if (byEmail) {
    if (byEmail.cognito_sub && byEmail.cognito_sub !== cognitoSub) {
      throw new GraphQLError(
        "User email is already linked to another identity",
        {
          extensions: { code: "CONFLICT" },
        },
      );
    }
    await db
      .update(users)
      .set({
        cognito_sub: cognitoSub,
        name: input.name ?? byEmail.name,
        updated_at: new Date(),
      })
      .where(eq(users.id, byEmail.id));
    return byEmail.id;
  }

  await db.insert(users).values({
    id: cognitoSub,
    cognito_sub: cognitoSub,
    tenant_id: tenantId,
    email: input.email,
    name: input.name,
    workspace_folder_name: workspaceFolderName(
      input.name || input.email,
      [],
      "user",
    ),
  });
  return cognitoSub;
}

function isCognitoError(err: unknown, name: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: unknown }).name === name
  );
}
