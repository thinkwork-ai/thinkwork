import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  and,
  eq,
  ne,
  computers,
  agents,
  agentTemplates,
  users,
  computerToCamel,
} from "../../utils.js";
import { requireTenantAdmin, requireTenantMember } from "../core/authz.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

export function parseComputerStatus(value: unknown): string | undefined {
  return parseEnum(value, ["active", "provisioning", "failed", "archived"]);
}

export function parseDesiredRuntimeStatus(value: unknown): string | undefined {
  return parseEnum(value, ["running", "stopped"]);
}

export function parseRuntimeStatus(value: unknown): string | undefined {
  return parseEnum(value, [
    "pending",
    "starting",
    "running",
    "stopped",
    "failed",
    "unknown",
  ]);
}

export function parseJsonInput(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return JSON.parse(value);
}

export function parseOptionalDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(String(value));
}

export async function requireComputerTemplate(
  tenantId: string,
  templateId: string,
): Promise<void> {
  const [template] = await db
    .select({
      id: agentTemplates.id,
      template_kind: agentTemplates.template_kind,
    })
    .from(agentTemplates)
    .where(
      and(
        eq(agentTemplates.id, templateId),
        eq(agentTemplates.tenant_id, tenantId),
      ),
    );
  if (!template) {
    throw new GraphQLError("Computer template not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  if (template.template_kind !== "computer") {
    throw new GraphQLError("Computer must use a Computer Template", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
}

export async function requireTenantUser(
  tenantId: string,
  userId: string,
): Promise<void> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenant_id, tenantId)));
  if (!user) {
    throw new GraphQLError("Computer owner user not found in tenant", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
}

export async function requireTenantAgent(
  tenantId: string,
  agentId: string,
): Promise<void> {
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.tenant_id, tenantId)));
  if (!agent) {
    throw new GraphQLError("Source Agent not found in tenant", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
}

export async function assertNoActiveComputer(
  tenantId: string,
  ownerUserId: string,
): Promise<void> {
  const [existing] = await db
    .select({ id: computers.id })
    .from(computers)
    .where(
      and(
        eq(computers.tenant_id, tenantId),
        eq(computers.owner_user_id, ownerUserId),
        ne(computers.status, "archived"),
      ),
    );
  if (existing) {
    throw new GraphQLError("User already has an active Computer", {
      extensions: { code: "CONFLICT" },
    });
  }
}

export async function requireComputerReadAccess(
  ctx: GraphQLContext,
  row: typeof computers.$inferSelect,
): Promise<void> {
  await requireTenantMember(ctx, row.tenant_id);
  const caller = await resolveCaller(ctx);
  if (caller.userId === row.owner_user_id) return;
  await requireTenantAdmin(ctx, row.tenant_id);
}

export function toGraphqlComputer(row: Record<string, unknown>) {
  return computerToCamel(row);
}

function parseEnum(value: unknown, allowed: string[]): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return undefined;
  const normalized = String(value).toLowerCase();
  if (allowed.includes(normalized)) return normalized;
  throw new GraphQLError(`Invalid Computer enum value: ${String(value)}`, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}
