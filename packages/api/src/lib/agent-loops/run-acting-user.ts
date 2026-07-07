/**
 * Run-derived acting user for scheduled document emission (THINK-155 U1).
 *
 * Scheduled turns have no triggering user message, so THINK-147's acting-user
 * derivation yields null and finalize-into-space is rejected. This resolver
 * gives emission a second SERVER-SIDE derivation source: the automation's
 * run-as identity (THINK-137 — `agent_loops.run_as_user_id`, default the
 * creator), resolved from the turn in the database, never from the callback
 * payload.
 *
 * Mapping: `agent_loop_iterations` by (tenant_id, thread_turn_id) — stamped at
 * dispatch by `linkAgentLoopIterationTurn` — → `agent_loop_runs` →
 * `agent_loops.run_as_user_id`. The user is returned only when it passes an
 * active tenant-membership cross-check (THINK-137 R5 discipline: a narrow
 * service path, never a widened `resolveCaller`); a stale or removed run-as
 * reference resolves to null so the existing finalize guard fires.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agentLoopIterations,
  agentLoopRuns,
  agentLoops,
  tenantMembers,
} from "@thinkwork/database-pg/schema";

/** Injectable query seam so the composition logic is testable without a DB. */
export interface RunActingUserQueries {
  /** run_as_user_id of the run linked to this turn, or null when unlinked/unset. */
  findRunAsUserForTurn(input: {
    tenantId: string;
    turnId: string;
  }): Promise<string | null>;
  /** True when the user holds an active `tenant_members` row on the tenant. */
  isActiveTenantMember(input: {
    tenantId: string;
    userId: string;
  }): Promise<boolean>;
}

export function drizzleRunActingUserQueries(): RunActingUserQueries {
  return {
    findRunAsUserForTurn: async ({ tenantId, turnId }) => {
      const rows = await getDb()
        .select({ runAsUserId: agentLoops.run_as_user_id })
        .from(agentLoopIterations)
        .innerJoin(
          agentLoopRuns,
          eq(agentLoopIterations.agent_loop_run_id, agentLoopRuns.id),
        )
        .innerJoin(agentLoops, eq(agentLoopRuns.agent_loop_id, agentLoops.id))
        .where(
          and(
            eq(agentLoopIterations.tenant_id, tenantId),
            eq(agentLoopIterations.thread_turn_id, turnId),
          ),
        )
        .limit(1);
      return rows[0]?.runAsUserId ?? null;
    },
    isActiveTenantMember: async ({ tenantId, userId }) => {
      const rows = await getDb()
        .select({ status: tenantMembers.status })
        .from(tenantMembers)
        .where(
          and(
            eq(tenantMembers.tenant_id, tenantId),
            eq(tenantMembers.principal_type, "user"),
            eq(tenantMembers.principal_id, userId),
          ),
        )
        .limit(1);
      return rows[0]?.status === "active";
    },
  };
}

/**
 * Resolve the run-as user acting on behalf of a scheduled turn. Returns null
 * when the turn has no run linkage, the run's automation carries no run-as
 * user, or the run-as user fails the tenant-membership cross-check.
 */
export async function resolveRunActingUserId(
  input: { tenantId: string; turnId: string },
  queries: RunActingUserQueries = drizzleRunActingUserQueries(),
): Promise<string | null> {
  const runAsUserId = await queries.findRunAsUserForTurn(input);
  if (!runAsUserId) return null;
  const isMember = await queries.isActiveTenantMember({
    tenantId: input.tenantId,
    userId: runAsUserId,
  });
  return isMember ? runAsUserId : null;
}
