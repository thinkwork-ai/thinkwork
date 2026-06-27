import type { GraphQLContext } from "../../context.js";
import { claimNextOpenEngineWorkItem as claimNextOpenEngineWorkItemRow } from "../../../lib/work-items/open-engine-queue-service.js";
import { resolveWorkItemTenant } from "../../../lib/work-items/auth.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { toGraphqlWorkItem } from "./shared.js";

export async function claimNextOpenEngineWorkItem(
  _: unknown,
  args: { input: Record<string, any> },
  ctx: GraphQLContext,
) {
  const input = args.input ?? {};
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  await requireAdminOrServiceCaller(
    ctx,
    tenantId,
    "open_engine_work_items:claim",
  );
  const row = await claimNextOpenEngineWorkItemRow({
    tenantId,
    queueKey: input.queueKey ?? null,
    agentId: input.agentId,
    now: input.now ? new Date(input.now) : undefined,
    leaseSeconds: input.leaseSeconds,
  });
  return row ? toGraphqlWorkItem(row as Record<string, unknown>) : null;
}
