import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  and,
  computers,
  db,
  eq,
  ne,
  routines,
  sql,
} from "../../utils.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import { requireTenantMember } from "../core/authz.js";

export interface DisableWorkflowArgs {
  input: { computerId: string; slug: string };
}

/**
 * Disable a workflow binding for the caller's Computer. Flips status
 * to 'inactive' rather than deleting so last_run_at / next_run_at /
 * trigger run history are preserved. Idempotent — if no binding exists
 * (or the Computer has no primary agent), returns true without writing.
 *
 * Plan: docs/plans/2026-05-09-010-feat-customize-workflows-live-plan.md U6-2.
 */
export async function disableWorkflow(
  _parent: unknown,
  args: DisableWorkflowArgs,
  ctx: GraphQLContext,
) {
  const { computerId, slug } = args.input;
  const caller = await resolveCaller(ctx);
  if (!caller.userId || !caller.tenantId) {
    throw new GraphQLError("Authentication required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  const [computer] = await db
    .select({
      id: computers.id,
      tenant_id: computers.tenant_id,
      owner_user_id: computers.owner_user_id,
      primary_agent_id: computers.primary_agent_id,
      migrated_from_agent_id: computers.migrated_from_agent_id,
    })
    .from(computers)
    .where(
      and(
        eq(computers.id, computerId),
        eq(computers.owner_user_id, caller.userId),
        ne(computers.status, "archived"),
      ),
    );
  if (!computer) {
    throw new GraphQLError("Computer not found or not accessible", {
      extensions: { code: "COMPUTER_NOT_FOUND" },
    });
  }

  await requireTenantMember(ctx, computer.tenant_id);

  const agentId =
    computer.primary_agent_id ?? computer.migrated_from_agent_id ?? null;
  if (!agentId) {
    // Nothing to disable when the Computer has no primary agent — disable
    // is idempotent end-to-end. Mirrors disableSkill's silent no-op path.
    return true;
  }

  // tenant_id predicate is defense-in-depth — agents.tenant_id is FK-bound
  // to the agent's tenant today, but a future schema bug shouldn't be able
  // to flip a routine in the wrong tenant.
  await db
    .update(routines)
    .set({ status: "inactive", updated_at: sql`now()` })
    .where(
      and(
        eq(routines.tenant_id, computer.tenant_id),
        eq(routines.agent_id, agentId),
        eq(routines.catalog_slug, slug),
      ),
    );

  return true;
}
