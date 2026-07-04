/**
 * createCanvasRefreshSchedule (Living Artifacts THINK-145 U7, R6 schedule leg).
 *
 * Create a recurring headless data-refresh schedule for a canvas. Unlike the
 * one-shot `refreshCanvasData` (a read-side freshness action any member may
 * take), standing up persistent background infra is a WRITE-side action gated
 * on member-or-above space access. The lib helper enforces the interval floor
 * and per-tenant cap and provisions the EventBridge schedule; `job-trigger`'s
 * `canvas_refresh` branch fires it on the interval.
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, artifacts } from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import { assertCanvasAccess } from "../../../lib/artifacts/canvas-access.js";
import { createCanvasRefreshSchedule as createSchedule } from "../../../lib/artifacts/canvas-refresh-schedule.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";

interface Args {
  artifactId: string;
  intervalMinutes: number;
  partId?: string | null;
}

export const createCanvasRefreshSchedule = async (
  _parent: unknown,
  args: Args,
  ctx: GraphQLContext,
): Promise<{ scheduledJobId: string; scheduleExpression: string }> => {
  const artifactId = requiredString(args.artifactId, "artifactId");
  if (typeof args.intervalMinutes !== "number") {
    throw new GraphQLError(
      "createCanvasRefreshSchedule intervalMinutes is required",
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }

  const caller = await resolveCallerFromAuth(ctx.auth);
  if (!caller.userId || !caller.tenantId) {
    throw new GraphQLError("Requester user identity required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  const [row] = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.id, artifactId));
  if (!row) {
    throw new GraphQLError("Canvas artifact not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  await requireTenantMember(ctx, row.tenant_id);
  // Standing up a recurring background schedule is a write-side config action.
  await assertCanvasAccess(ctx, row, "write");

  const result = await createSchedule({
    tenantId: row.tenant_id,
    artifactId,
    partId: args.partId ?? null,
    intervalMinutes: args.intervalMinutes,
    spaceId: (row.space_id as string | null) ?? null,
    actorId: caller.userId,
  });
  return result;
};

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GraphQLError(
      `createCanvasRefreshSchedule ${field} is required`,
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }
  return value.trim();
}
