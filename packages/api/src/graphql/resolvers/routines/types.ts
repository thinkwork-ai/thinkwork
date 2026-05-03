/**
 * Routine domain type-resolvers.
 *
 * Surfaces fields that aren't a direct column read — currently the
 * `RoutineExecution.aslVersion` pointer that closes the run-detail
 * step-manifest gap. New execution rows carry `routine_asl_version_id`
 * for deterministic historical lookup; older rows fall back to the
 * original `state_machine_arn` + `version_arn` pair.
 */

import { and, eq } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import {
  routineAslVersions,
  routineStepEvents,
  routines,
  scheduledJobs,
} from "@thinkwork/database-pg/schema";

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
