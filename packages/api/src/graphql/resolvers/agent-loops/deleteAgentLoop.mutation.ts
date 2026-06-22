import { eq } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { agentLoops, db } from "../../utils.js";
import { syncAgentLoopScheduleBinding } from "../../../lib/agent-loops/schedule-binding.js";
import { requireAgentLoopAdmin } from "./types.js";

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

  await requireAgentLoopAdmin(ctx, row.tenant_id, "delete_agent_loop");

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
