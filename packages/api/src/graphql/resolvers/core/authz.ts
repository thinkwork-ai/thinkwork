/**
 * Shared authorization helpers for tenant-scoped resolvers.
 *
 * `requireTenantAdmin` encapsulates the owner-or-admin check that was
 * duplicated inline across tenant-scoped resolvers. Callers that need
 * atomicity between the role check and a
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

import {
  readSkillAssignmentState,
  resolveAgentWorkspacePrefix,
} from "../../../lib/skills/assignment-state.js";
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
export type TenantMemberRole = TenantAdminRole | "member";

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
 * True when the request authenticated via the shared service secret —
 * regardless of whether the caller declared an identity (`apikey`) or
 * arrived bearer-only (`service`). Both classes hold the same secret;
 * use this when the intent is "secret-holder detection" rather than
 * "declared-identity detection".
 *
 * Use the raw `authType === "apikey"` / `=== "service"` check only when
 * the code path genuinely depends on whether identity headers are
 * present (e.g., x-agent-id self-edit guards, x-principal-id role
 * lookups).
 */
export function hasServiceSecret(ctx: GraphQLContext): boolean {
  return ctx.auth.authType === "apikey" || ctx.auth.authType === "service";
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
 * Ensures the caller belongs to `tenantId`, regardless of role. This is for
 * user-facing collaboration surfaces where any tenant member may respond to
 * an agent request, while cross-tenant access must still fail closed.
 */
export async function requireTenantMember(
  ctx: GraphQLContext,
  tenantId: string,
  dbOrTx: DbOrTx = defaultDb,
): Promise<TenantMemberRole> {
  if (ctx.auth.authType !== "cognito") {
    throw forbidden("Tenant membership required");
  }
  const callerUserId = await resolveCallerUserId(ctx);
  if (!callerUserId) {
    throw forbidden("Tenant membership required");
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
  if (role === "owner" || role === "admin" || role === "member") {
    return role;
  }
  throw forbidden("Tenant membership required");
}

/**
 * Acting-user-aware variant of {@link requireTenantMember} — the KTD8
 * identity seam.
 *
 * The Pi runtime's canvas provider calls the GraphQL API with the shared
 * service secret (`authorization: Bearer <API_AUTH_SECRET>`) AND the acting
 * user asserted via `x-principal-id` / `x-tenant-id` (which resolves to
 * `authType === "apikey"`). `requireTenantMember` hard-rejects any non-cognito
 * caller, so the service+principal path can NEVER pass it — that is why all four
 * agent canvas tools were dead on production. This helper gates the SAME
 * member-or-above check on the ACTING user named by the assertion, so the agent
 * acts with exactly the tenant reach of the human it acts for.
 *
 * Acceptance branches:
 *   1. `cognito` — delegate to {@link requireTenantMember} (byte-identical
 *      behavior for web / CLI / mobile callers).
 *   2. `apikey` or `service` WITH a non-empty `ctx.auth.principalId` — the
 *      shared service secret is the documented trust boundary for the
 *      assertion (see `resolveCallerFromAuth`, which already returns the
 *      asserted principal for these auth types). Look up `tenant_members` for
 *      `(tenantId, principal_id = that principal)` and return the role if the
 *      acting user is a member (owner/admin/member), else the same forbidden.
 *   3. service/apikey with NO principal, or any other authType — forbidden.
 *      Bare infrastructure cannot act on a tenant surface without naming the
 *      user it acts for.
 *
 * This is deliberately SEPARATE from {@link requireTenantMember}: that helper
 * has many other call sites (inbox, threads, workflows, knowledge, slack, …)
 * whose strict cognito-only posture must NOT be loosened. Only the canvas
 * resolvers the agent provider hits swap to this variant.
 */
export async function requireActingTenantMember(
  ctx: GraphQLContext,
  tenantId: string,
  dbOrTx: DbOrTx = defaultDb,
): Promise<TenantMemberRole> {
  if (ctx.auth.authType === "cognito") {
    return requireTenantMember(ctx, tenantId, dbOrTx);
  }
  if (ctx.auth.authType === "apikey" || ctx.auth.authType === "service") {
    const actingPrincipalId = ctx.auth.principalId;
    if (!actingPrincipalId) {
      throw forbidden("Tenant membership required");
    }
    const [member] = await dbOrTx
      .select({ role: tenantMembers.role })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenant_id, tenantId),
          eq(tenantMembers.principal_id, actingPrincipalId),
        ),
      );
    const role = member?.role;
    if (role === "owner" || role === "admin" || role === "member") {
      return role;
    }
    throw forbidden("Tenant membership required");
  }
  throw forbidden("Tenant membership required");
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
  // KTD-8 (plan U9): the workspace state file is the target source of
  // truth; the agent_skills row is the fallback for assignments that
  // predate the file. This path only runs on apikey admin-skill
  // mutations, so the S3 read is off the general request path.
  let enabled: boolean | null | undefined;
  let permissions: unknown;
  const targetPrefix = await resolveAgentWorkspacePrefix(agentId).catch(
    () => null,
  );
  const fileState = targetPrefix
    ? await readSkillAssignmentState(targetPrefix, "thinkwork-admin")
    : null;
  if (fileState) {
    enabled = fileState.enabled ?? true;
    permissions = fileState.permissions ?? null;
  } else {
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
    enabled = row.enabled;
    permissions = row.permissions;
  }
  if (enabled === false) {
    throw forbidden("Agent's thinkwork-admin assignment is disabled");
  }
  const operations = (permissions as { operations?: unknown } | null)
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
 * Tenant-admin gate that ALSO accepts bare service-secret callers.
 *
 * Three acceptance branches:
 *   1. `cognito` — delegate to `requireTenantAdmin` (existing behavior;
 *      preserves admin SPA / mobile / `thinkwork login` semantics).
 *   2. `service` — bearer-only caller (CLI / Strands runtime back-channel
 *      / scheduled jobs). The bearer IS the credential; allow tenant-
 *      scoped operations against `tenantId` without further identity
 *      check. NOT for mutations that stamp a specific user identity onto
 *      the row — those stay Cognito-required so service callers can't
 *      ghost-write as a user.
 *   3. `apikey` — declared-identity caller (thinkwork-admin skill path).
 *      Verify the asserted invoker has owner/admin on the target tenant
 *      AND that the calling agent has the named operation in its
 *      per-agent allowlist. Delegates to `requireAdminOrApiKeyCaller`.
 *
 * `operationName` is forwarded to the apikey branch for allowlist
 * checking. The service branch ignores it because there's no agent to
 * check against — the bearer secret is the gate.
 */
export async function requireAdminOrServiceCaller(
  ctx: GraphQLContext,
  tenantId: string,
  operationName: string,
  dbOrTx: DbOrTx = defaultDb,
): Promise<void> {
  if (ctx.auth.authType === "cognito") {
    await requireTenantAdmin(ctx, tenantId, dbOrTx);
    return;
  }
  if (ctx.auth.authType === "service") {
    return;
  }
  if (ctx.auth.authType === "apikey") {
    await requireAdminOrApiKeyCaller(ctx, tenantId, operationName, dbOrTx);
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
 * manifest also enforced a name-exclusion invariant while the legacy
 * repo-backed admin skill existed.
 */
export function requireNotFromAdminSkill(ctx: GraphQLContext): void {
  if (ctx.auth.authType !== "cognito") {
    throw forbidden(
      "Catastrophic operations are restricted to Cognito-authenticated callers",
    );
  }
}
