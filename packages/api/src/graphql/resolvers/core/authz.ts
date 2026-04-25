/**
 * Shared authorization helpers for tenant-scoped resolvers.
 *
 * `requireTenantAdmin` encapsulates the owner-or-admin check that was
 * duplicated inline across several resolvers (e.g. `allTenantAgents.query.ts`
 * lines 30-40). Callers that need atomicity between the role check and a
 * subsequent write (e.g. last-owner invariant in tenant member mutations)
 * can pass a transaction handle as `dbOrTx`.
 *
 * `requireAdminOrApiKeyCaller` is the admin-skill entry point: same role
 * gate semantics for cognito callers (delegates), plus an apikey branch
 * that independently verifies the caller's principal has admin/owner on
 * the target tenant AND that the calling agent has the operation
 * explicitly allow-listed in `agent_skills.permissions.operations`. The
 * per-agent allowlist (verified by `requireAgentAllowsOperation`) is the
 * defense against the shared-service-secret impersonation gap: a rogue
 * skill holding the service secret and claiming an admin's principalId
 * fails the allowlist check because its agent doesn't have
 * `thinkwork-admin` assigned.
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  db as defaultDb,
  eq,
  and,
  tenantMembers,
  agentSkills,
} from "../../utils.js";
import { resolveCallerUserId } from "./resolve-auth-user.js";

export type TenantAdminRole = "owner" | "admin";

/**
 * Minimal duck-type that covers both the module-level `db` and a Drizzle
 * transaction handle (`tx`). Drizzle's `db` and `PgTransaction<...>` have
 * subtly different full types (e.g. only `db` has `$client`), but both
 * expose the `select` API we use for the role lookup.
 */
type DbOrTx = { select: typeof defaultDb.select };

function forbidden(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "FORBIDDEN" },
  });
}

function unauthenticated(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: "UNAUTHENTICATED" },
  });
}

/**
 * Ensures the caller is an `owner` or `admin` of `tenantId`. Returns the
 * caller's role on success. Throws a `FORBIDDEN` GraphQLError otherwise.
 *
 * The optional `dbOrTx` handle routes the role lookup through a transaction
 * when one is provided — matching Drizzle's `db.transaction(async tx => ...)`
 * API. The caller-identity lookup (`resolveCallerUserId`) always runs on the
 * module-level `db`; that lookup is a prerequisite to the transactional
 * invariant, not part of it.
 */
export async function requireTenantAdmin(
  ctx: GraphQLContext,
  tenantId: string,
  dbOrTx: DbOrTx = defaultDb,
): Promise<TenantAdminRole> {
  if (ctx.auth.authType !== "cognito") {
    throw forbidden("Tenant admin role required");
  }
  const callerUserId = await resolveCallerUserId(ctx);
  if (!callerUserId) {
    throw forbidden("Tenant admin role required");
  }
  const [member] = await dbOrTx
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenant_id, tenantId),
        eq(tenantMembers.principal_id, callerUserId),
      ),
    );
  const role = member?.role;
  if (role === "owner" || role === "admin") {
    return role;
  }
  throw forbidden("Tenant admin role required");
}

/**
 * Verify that the calling agent (asserted via `x-agent-id`) has the given
 * operation listed in its `agent_skills.permissions.operations` jsonb
 * array for `skill_id='thinkwork-admin'`. Refuses if:
 *   - `ctx.auth.agentId` is null (no agent asserted),
 *   - no `agent_skills` row exists for `(agent_id, 'thinkwork-admin')`,
 *   - the row is `enabled=false`,
 *   - `permissions.operations` is missing / not an array,
 *   - `operationName` is not present in the array.
 *
 * This is the per-agent defense layer in the three-layer admin-skill
 * authz story: invoker role + agent allowlist + scoped role-check. The
 * allowlist layer is what prevents a rogue skill holding the shared
 * service secret (and claiming an admin's principalId) from calling
 * gated mutations — its agent doesn't have `thinkwork-admin` assigned,
 * so this check refuses.
 */
export async function requireAgentAllowsOperation(
  ctx: GraphQLContext,
  operationName: string,
  dbOrTx: DbOrTx = defaultDb,
): Promise<void> {
  const agentId = ctx.auth.agentId;
  if (!agentId) {
    throw forbidden("Agent identity required for admin-skill operations");
  }
  const [row] = await dbOrTx
    .select({
      enabled: agentSkills.enabled,
      permissions: agentSkills.permissions,
    })
    .from(agentSkills)
    .where(
      and(
        eq(agentSkills.agent_id, agentId),
        eq(agentSkills.skill_id, "thinkwork-admin"),
      ),
    );
  if (!row) {
    throw forbidden("Agent is not assigned thinkwork-admin");
  }
  if (row.enabled === false) {
    throw forbidden("Agent's thinkwork-admin assignment is disabled");
  }
  const operations = (row.permissions as { operations?: unknown } | null)
    ?.operations;
  if (!Array.isArray(operations) || !operations.includes(operationName)) {
    throw forbidden(`Operation not in agent's allowlist: ${operationName}`);
  }
}

/**
 * Admin-skill-aware variant of `requireTenantAdmin`. Cognito callers
 * delegate to the existing helper (preserving admin SPA / CLI
 * semantics). Apikey callers — the thinkwork-admin skill and any other
 * service caller — go through two additional gates:
 *
 *   1. Live DB check that `ctx.auth.principalId` has owner/admin on
 *      `tenantId`. No caching (R16 — roles must be DB-live-revocable).
 *   2. Per-agent allowlist verification via
 *      `requireAgentAllowsOperation` — refuses unless the calling
 *      agent has `skill_id='thinkwork-admin'` assigned AND the named
 *      operation is explicitly present in `permissions.operations`.
 *
 * The `operationName` argument IS load-bearing — it gates the
 * per-agent allowlist check and must match the canonical snake_case
 * operation name the skill's SKILL.md frontmatter declares.
 */
export async function requireAdminOrApiKeyCaller(
  ctx: GraphQLContext,
  tenantId: string,
  operationName: string,
  dbOrTx: DbOrTx = defaultDb,
): Promise<void> {
  if (ctx.auth.authType === "cognito") {
    await requireTenantAdmin(ctx, tenantId, dbOrTx);
    return;
  }
  if (ctx.auth.authType === "apikey") {
    const invokerUserId = ctx.auth.principalId;
    if (!invokerUserId) {
      throw forbidden("Invoker identity required (x-principal-id missing)");
    }
    const [member] = await dbOrTx
      .select({ role: tenantMembers.role })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenant_id, tenantId),
          eq(tenantMembers.principal_id, invokerUserId),
        ),
      );
    const role = member?.role;
    if (role !== "owner" && role !== "admin") {
      throw forbidden("Invoker lacks admin role on target tenant");
    }
    await requireAgentAllowsOperation(ctx, operationName, dbOrTx);
    return;
  }
  throw unauthenticated("Unsupported authentication type");
}

/**
 * Guard for the never-exposed tier — catastrophic mutations that no
 * service-auth caller (including the thinkwork-admin skill) may reach.
 * Cognito callers pass through unchanged; every other authType
 * refuses. Allow-list Cognito-only is stronger than an `x-skill-id`
 * deny-list: no service principal — regardless of which skill holds
 * the shared secret — can trigger a catastrophic op.
 *
 * Usage: call at the top of any resolver that implements a
 * never-exposed op (deleteTenant, transferTenantOwnership,
 * billing / spend mutations, bulk purges). None of those resolvers
 * exist today; the thinkwork-admin plan (Unit 11) ships this helper
 * as a primitive ready for when they land. The thinkwork-admin
 * manifest also enforces a name-exclusion invariant — see
 * `packages/skill-catalog/thinkwork-admin/SKILL.md` lint test.
 */
export function requireNotFromAdminSkill(ctx: GraphQLContext): void {
  if (ctx.auth.authType !== "cognito") {
    throw forbidden(
      "Catastrophic operations are restricted to Cognito-authenticated callers",
    );
  }
}
