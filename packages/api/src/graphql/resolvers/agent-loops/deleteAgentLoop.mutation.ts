import { and, eq } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { agentLoops, db } from "../../utils.js";
import { workflows } from "@thinkwork/database-pg/schema";
import { syncAgentLoopScheduleBinding } from "../../../lib/agent-loops/schedule-binding.js";
import { syncWorkflowScheduleBinding } from "../../../lib/workflows/schedule-binding.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { requireAgentLoopWriteAccess } from "./write-access.js";

export async function deleteAgentLoop(
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
): Promise<{ id: string; ok: boolean }> {
  const [row] = await db
    .select()
    .from(agentLoops)
    .where(eq(agentLoops.id, args.id))
    .limit(1);

  if (!row) return { id: args.id, ok: false };

  // THINK-227 U11 (KTD10): admins keep general delete; a member may only
  // archive automations they own.
  await requireAgentLoopWriteAccess(ctx, row.tenant_id, {
    operationName: "delete_agent_loop",
    actorId: await resolveCallerUserId(ctx),
    existing: {
      ownerUserId: row.owner_user_id ?? null,
      runAsUserId: row.run_as_user_id ?? null,
    },
  });

  await syncAgentLoopScheduleBinding({
    tenantId: row.tenant_id,
    agentLoopId: row.id,
    name: row.name,
    description: row.description,
    goalObjective: "",
    workerAgentId: null,
    triggerSpec: {
      family: "manual",
      enabled: false,
      config: {},
    },
    loopEnabled: false,
  });

  // THINK-227 U13 follow-through: a report automation converged onto a
  // linked workflow whose schedule fires independently of the loop rows.
  // Archiving only the loop leaves EventBridge delivering an archived
  // automation — disable the workflow schedule and retire the workflow too.
  const [linked] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(
      and(
        eq(workflows.tenant_id, row.tenant_id),
        eq(workflows.source_agent_loop_id, row.id),
      ),
    )
    .limit(1);
  if (linked) {
    await syncWorkflowScheduleBinding({
      tenantId: row.tenant_id,
      workflowId: linked.id,
      name: row.name,
      description: row.description,
      schedule: null,
    });
    await db
      .update(workflows)
      .set({ lifecycle_status: "archived", updated_at: new Date() })
      .where(eq(workflows.id, linked.id));
  }

  await db
    .update(agentLoops)
    .set({
      lifecycle_status: "archived",
      enabled: false,
      updated_at: new Date(),
    })
    .where(eq(agentLoops.id, row.id));

  return { id: row.id, ok: true };
}
