import { eq } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { agentLoops, db } from "../../utils.js";
import { syncAgentLoopScheduleBinding } from "../../../lib/agent-loops/schedule-binding.js";
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
