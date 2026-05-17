import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  and,
  eq,
  isNull,
  ne,
  or,
  computers,
  computerAssignments,
  teamUsers,
  agents,
  agentTemplates,
  users,
  teams,
  computerToCamel,
  snakeToCamel,
  generateSlug,
} from "../../utils.js";
import { requireTenantAdmin, requireTenantMember } from "../core/authz.js";
import { resolveCaller } from "../core/resolve-auth-user.js";

export type CreateComputerCoreInput = {
  tenantId: string;
  ownerUserId?: string | null;
  templateId: string;
  name: string;
  slug?: string | null;
  scope?: string | null;
  runtimeConfig?: unknown;
  budgetMonthlyCents?: number | null;
  migratedFromAgentId?: string | null;
  migrationMetadata?: unknown;
  /**
   * The user id to record on `computers.created_by`. Pass `null` (or omit) when
   * the call site has no caller user — for example, the server-side auto-provision
   * helper firing inside `bootstrapUser`, where the new user is mid-creation and
   * the resolver's `ctx.auth` has not yet been resolved to a tenant member.
   */
  createdBy?: string | null;
};

/**
 * Insert a Computer after validating ownership, template kind, optional source
 * agent linkage, and the one-active-Computer-per-(tenant, user) invariant. Used
 * by the `createComputer` GraphQL resolver (after its `requireTenantAdmin` gate)
 * AND by the server-side `provisionComputerForMember` helper which fires inside
 * membership-creation paths and must NOT call `requireTenantAdmin` — the new
 * user is not yet tenant-admin-resolvable at the moment auto-provisioning runs.
 *
 * Throws on validation failure or on the `assertNoActiveComputer` conflict.
 * Callers that need idempotency wrap the call and catch the `CONFLICT`
 * GraphQLError (and the Postgres 23505 race-loss path) themselves.
 */
export async function createComputerCore(
  input: CreateComputerCoreInput,
): Promise<typeof computers.$inferSelect> {
  const scope = parseComputerScope(input.scope) ?? "shared";
  if (input.ownerUserId) {
    await requireTenantUser(input.tenantId, input.ownerUserId);
    await assertNoActiveComputer(input.tenantId, input.ownerUserId);
  } else if (scope !== "shared") {
    throw new GraphQLError("Historical personal Computers require an owner", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  await requireComputerTemplate(input.tenantId, input.templateId);
  if (input.migratedFromAgentId) {
    await requireTenantAgent(input.tenantId, input.migratedFromAgentId);
  }

  const [row] = await db
    .insert(computers)
    .values({
      tenant_id: input.tenantId,
      owner_user_id: input.ownerUserId ?? null,
      template_id: input.templateId,
      name: input.name,
      slug: input.slug ?? generateSlug(),
      scope,
      runtime_config:
        input.runtimeConfig === undefined
          ? undefined
          : parseJsonInput(input.runtimeConfig),
      budget_monthly_cents: input.budgetMonthlyCents,
      migrated_from_agent_id: input.migratedFromAgentId,
      migration_metadata:
        input.migrationMetadata === undefined
          ? undefined
          : parseJsonInput(input.migrationMetadata),
      created_by: input.createdBy ?? null,
    })
    .returning();
  return row;
}

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

export function parseComputerScope(value: unknown): string | undefined {
  return parseEnum(value, ["shared", "historical_personal"]);
}

export function parseJsonInput(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return JSON.parse(value);
}

export function parseOptionalDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new GraphQLError(`Invalid date value: ${String(value)}`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return parsed;
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
        or(
          eq(agentTemplates.tenant_id, tenantId),
          isNull(agentTemplates.tenant_id),
        ),
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

export async function requireTenantTeam(
  tenantId: string,
  teamId: string,
): Promise<void> {
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.tenant_id, tenantId)));
  if (!team) {
    throw new GraphQLError("Team not found in tenant", {
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
  if (
    caller.userId &&
    (await hasComputerAssignmentAccess({
      tenantId: row.tenant_id,
      computerId: row.id,
      userId: caller.userId,
    }))
  ) {
    return;
  }
  await requireTenantAdmin(ctx, row.tenant_id);
}

export function toGraphqlComputer(row: Record<string, unknown>) {
  return computerToCamel(row);
}

export function toGraphqlComputerAssignment(row: Record<string, unknown>) {
  const result = snakeToCamel(row);
  if (typeof result.subjectType === "string") {
    result.subjectType = (result.subjectType as string).toUpperCase();
  }
  return result;
}

export async function loadComputerOrThrow(computerId: string) {
  const [row] = await db
    .select()
    .from(computers)
    .where(eq(computers.id, computerId))
    .limit(1);
  if (!row) {
    throw new GraphQLError("Computer not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  return row;
}

export async function hasComputerAssignmentAccess(input: {
  tenantId: string;
  computerId: string;
  userId: string;
}): Promise<boolean> {
  const [direct] = await db
    .select({ id: computerAssignments.id })
    .from(computerAssignments)
    .where(
      and(
        eq(computerAssignments.tenant_id, input.tenantId),
        eq(computerAssignments.computer_id, input.computerId),
        eq(computerAssignments.subject_type, "user"),
        eq(computerAssignments.user_id, input.userId),
      ),
    )
    .limit(1);
  if (direct) return true;

  const [team] = await db
    .select({ id: computerAssignments.id })
    .from(computerAssignments)
    .innerJoin(teamUsers, eq(teamUsers.team_id, computerAssignments.team_id))
    .where(
      and(
        eq(computerAssignments.tenant_id, input.tenantId),
        eq(computerAssignments.computer_id, input.computerId),
        eq(computerAssignments.subject_type, "team"),
        eq(teamUsers.tenant_id, input.tenantId),
        eq(teamUsers.user_id, input.userId),
      ),
    )
    .limit(1);
  return Boolean(team);
}

export function accessSource(input: { direct: boolean; team: boolean }) {
  if (input.direct && input.team) return "BOTH";
  if (input.team) return "TEAM";
  return "DIRECT";
}

export function parseAssignmentSubjectType(value: unknown) {
  return parseEnum(value, ["user", "team"]);
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
