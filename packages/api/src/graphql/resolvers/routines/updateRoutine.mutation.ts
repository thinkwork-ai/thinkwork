/**
 * updateRoutine (Plan 2026-05-01-005 §U7).
 *
 * Edits routine metadata that does NOT affect ASL. ASL changes go
 * through `publishRoutineVersion`. The legacy update path (under
 * `triggers/`) accepted a free-form `config` blob — we deliberately
 * narrow this resolver to fields that don't require an SFN round trip.
 */

import { eq } from "drizzle-orm";
import { routines } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, snakeToCamel } from "../../utils.js";
import { requireAdminOrApiKeyCaller } from "../core/authz.js";

interface UpdateRoutineInput {
  name?: string;
  description?: string;
  type?: string;
  status?: string;
  schedule?: string;
  teamId?: string;
  agentId?: string;
}

export async function updateRoutine(
  _parent: unknown,
  args: { id: string; input: UpdateRoutineInput },
  ctx: GraphQLContext,
): Promise<unknown> {
  const [existing] = await db
    .select()
    .from(routines)
    .where(eq(routines.id, args.id));
  if (!existing) {
    throw new Error(`Routine ${args.id} not found`);
  }
  await requireAdminOrApiKeyCaller(
    ctx,
    existing.tenant_id,
    "update_routine",
  );

  const i = args.input;
  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (i.name !== undefined) updates.name = i.name;
  if (i.description !== undefined) updates.description = i.description;
  if (i.type !== undefined) updates.type = i.type;
  if (i.status !== undefined) updates.status = i.status;
  if (i.schedule !== undefined) updates.schedule = i.schedule;
  if (i.teamId !== undefined) updates.team_id = i.teamId;
  if (i.agentId !== undefined) updates.agent_id = i.agentId;

  const [row] = await db
    .update(routines)
    .set(updates)
    .where(eq(routines.id, args.id))
    .returning();
  return snakeToCamel(row);
}
