/**
 * Routine domain type-resolvers.
 *
 * Surfaces fields that aren't a direct column read — currently the
 * `RoutineExecution.aslVersion` pointer that closes the run-detail
 * step-manifest gap. New execution rows carry `routine_asl_version_id`
 * for deterministic historical lookup; older rows fall back to the
 * original `state_machine_arn` + `version_arn` pair.
 */

import { and, desc, eq } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import {
  capabilityBrokerCalls,
  routineAslVersions,
  routineStepEvents,
  routines,
  scheduledJobs,
} from "@thinkwork/database-pg/schema";

/**
 * THINK-280 U7: project one capability_broker_calls row onto the
 * CapabilityBrokerCall GraphQL type. The two jsonb columns whose GraphQL names
 * drop the `_json` suffix (`budget_delta_json` → `budgetDelta`,
 * `durable_ref_json` → `durableRef`) are mapped explicitly; snakeToCamel would
 * otherwise leave them as `budgetDeltaJson`/`durableRefJson` and the fields
 * would resolve null. Secret material never reaches this row — only bounded
 * digests + policy/budget/effect metadata are persisted upstream.
 */
export function brokerCallRowToGraphql(row: Record<string, unknown>): unknown {
  return {
    ...(snakeToCamel(row) as Record<string, unknown>),
    budgetDelta: row.budget_delta_json ?? null,
    durableRef: row.durable_ref_json ?? null,
  };
}

export const routineExecutionTypeResolvers = {
  routine: async (
    execution: { routineId?: string },
    _args: unknown,
    _ctx: GraphQLContext,
  ) => {
    if (!execution.routineId) return null;
    const [row] = await db
      .select()
      .from(routines)
      .where(eq(routines.id, execution.routineId))
      .limit(1);
    return row ? snakeToCamel(row) : null;
  },

  trigger: async (
    execution: { triggerId?: string | null },
    _args: unknown,
    _ctx: GraphQLContext,
  ) => {
    if (!execution.triggerId) return null;
    const [row] = await db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.id, execution.triggerId))
      .limit(1);
    return row ? snakeToCamel(row) : null;
  },

  stepEvents: async (
    execution: { id?: string },
    _args: unknown,
    _ctx: GraphQLContext,
  ) => {
    if (!execution.id) return [];
    const rows = await db
      .select()
      .from(routineStepEvents)
      .where(eq(routineStepEvents.execution_id, execution.id))
      .orderBy(routineStepEvents.started_at, routineStepEvents.created_at)
      .limit(1_000);
    return rows.map(snakeToCamel);
  },

  // THINK-280 U7: append-only broker-call evidence for a capability-headless
  // run, joined from capability_broker_calls by routine execution id. Newest
  // first; empty for ordinary runs. The row is already tenant-scoped through
  // the RoutineExecution parent's read authorization.
  brokerCalls: async (
    execution: { id?: string },
    _args: unknown,
    _ctx: GraphQLContext,
  ) => {
    if (!execution.id) return [];
    const rows = await db
      .select()
      .from(capabilityBrokerCalls)
      .where(eq(capabilityBrokerCalls.routine_execution_id, execution.id))
      .orderBy(desc(capabilityBrokerCalls.created_at))
      .limit(500);
    return rows.map(brokerCallRowToGraphql);
  },

  aslVersion: async (
    execution: {
      stateMachineArn?: string;
      versionArn?: string | null;
      routineAslVersionId?: string | null;
    },
    _args: unknown,
    _ctx: GraphQLContext,
  ) => {
    if (execution.routineAslVersionId) {
      const [row] = await db
        .select()
        .from(routineAslVersions)
        .where(eq(routineAslVersions.id, execution.routineAslVersionId))
        .limit(1);
      if (row) return snakeToCamel(row);
    }

    if (!execution.stateMachineArn || !execution.versionArn) {
      return null;
    }
    const [row] = await db
      .select()
      .from(routineAslVersions)
      .where(
        and(
          eq(routineAslVersions.state_machine_arn, execution.stateMachineArn),
          eq(routineAslVersions.version_arn, execution.versionArn),
        ),
      )
      .limit(1);
    return row ? snakeToCamel(row) : null;
  },
};
