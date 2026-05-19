import type { GraphQLContext } from "../../context.js";
import {
  and,
  db,
  eq,
  snakeToCamel,
  spaceMembers,
  tenantMembers,
} from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";

const SPACE_ENUM_FIELDS = new Set(["status", "kind"]);
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
        eq(tenantMembers.principal_id, callerUserId),
      ),
    );
  return Boolean(member);
}

export async function hasSpaceMemberAccess(
  ctx: GraphQLContext,
  tenantId: string,
  spaceId: string,
): Promise<boolean> {
  if (!(await canReadTenantSpaces(ctx, tenantId))) return false;
  if (ctx.auth.authType !== "cognito") return true;

  const callerUserId = await resolveCallerUserId(ctx);
  if (!callerUserId) return false;
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
