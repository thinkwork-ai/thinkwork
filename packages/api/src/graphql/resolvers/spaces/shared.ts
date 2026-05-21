import type { GraphQLContext } from "../../context.js";
import {
  and,
  db,
  eq,
  sql,
  snakeToCamel,
  spaceMembers,
  spaces,
  tenantMembers,
} from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";

const SPACE_ENUM_FIELDS = new Set(["status", "kind", "accessMode"]);
const SPACE_CHILD_ENUM_FIELDS = new Set([
  "role",
  "notificationPreference",
  "status",
  "provider",
  "writebackPolicy",
]);

export function parseSpaceStatus(value: unknown): string | undefined {
  return parseSpaceEnum(value, ["active", "archived"]);
}

export function parseSpaceAccessMode(value: unknown): string | undefined {
  return parseSpaceEnum(value, ["public", "private"]);
}

export async function canReadTenantSpaces(
  ctx: GraphQLContext,
  tenantId: string,
): Promise<boolean> {
  if (ctx.auth.authType === "service") {
    return ctx.auth.tenantId === tenantId;
  }
  if (ctx.auth.authType === "apikey") {
    try {
      await requireAdminOrServiceCaller(ctx, tenantId, "spaces:read");
      return true;
    } catch {
      return false;
    }
  }
  if (ctx.auth.authType !== "cognito") {
    return false;
  }

  const callerUserId = await resolveCallerUserId(ctx);
  if (!callerUserId) return false;
  const [member] = await db
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenant_id, tenantId),
        eq(tenantMembers.principal_type, "user"),
        eq(tenantMembers.principal_id, callerUserId),
        eq(tenantMembers.status, "active"),
      ),
    );
  return Boolean(member);
}

export async function canManageTenantSpaces(
  ctx: GraphQLContext,
  tenantId: string,
): Promise<boolean> {
  if (ctx.auth.authType === "service") {
    return ctx.auth.tenantId === tenantId;
  }
  try {
    await requireAdminOrServiceCaller(ctx, tenantId, "spaces:read");
    return true;
  } catch {
    return false;
  }
}

export async function hasSpaceMemberAccess(
  ctx: GraphQLContext,
  tenantId: string,
  spaceId: string,
): Promise<boolean> {
  return canAccessSpace(ctx, tenantId, spaceId);
}

export async function canPostToSpace(
  ctx: GraphQLContext,
  tenantId: string,
  spaceId: string,
): Promise<boolean> {
  return canAccessSpace(ctx, tenantId, spaceId);
}

export async function canAccessSpace(
  ctx: GraphQLContext,
  tenantId: string,
  spaceId: string,
): Promise<boolean> {
  if (!(await canReadTenantSpaces(ctx, tenantId))) return false;
  if (ctx.auth.authType !== "cognito") return true;

  const callerUserId = await resolveCallerUserId(ctx);
  if (!callerUserId) return false;
  const [space] = await db
    .select({
      id: spaces.id,
      access_mode: spaces.access_mode,
      status: spaces.status,
    })
    .from(spaces)
    .where(and(eq(spaces.tenant_id, tenantId), eq(spaces.id, spaceId)));
  if (!space || space.status !== "active") return false;
  if (space.access_mode === "public") return true;

  const [member] = await db
    .select({ id: spaceMembers.id })
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.tenant_id, tenantId),
        eq(spaceMembers.space_id, spaceId),
        eq(spaceMembers.user_id, callerUserId),
      ),
    );
  return Boolean(member);
}

export function userAccessibleSpacePredicate(
  tenantId: string,
  callerUserId: string,
) {
  return sql`(
    ${spaces.access_mode} = 'public'
    OR EXISTS (
      SELECT 1
        FROM ${spaceMembers} caller_sm
       WHERE caller_sm.tenant_id = ${tenantId}
         AND caller_sm.space_id = ${spaces.id}
         AND caller_sm.user_id = ${callerUserId}
    )
  )`;
}

export function toGraphqlSpace(row: Record<string, unknown>) {
  const result = snakeToCamel(row);
  uppercaseFields(result, SPACE_ENUM_FIELDS);
  return result;
}

export function toGraphqlSpaceChild(row: Record<string, unknown>) {
  const result = snakeToCamel(row);
  uppercaseFields(result, SPACE_CHILD_ENUM_FIELDS);
  return result;
}

function parseSpaceEnum(
  value: unknown,
  allowed: readonly string[],
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = String(value).toLowerCase();
  return allowed.includes(normalized) ? normalized : undefined;
}

function uppercaseFields(
  row: Record<string, unknown>,
  fields: ReadonlySet<string>,
): void {
  for (const field of fields) {
    if (typeof row[field] === "string") {
      row[field] = (row[field] as string).toUpperCase();
    }
  }
}
