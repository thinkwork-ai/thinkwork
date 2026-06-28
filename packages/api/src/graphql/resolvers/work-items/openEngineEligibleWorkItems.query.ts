import type { GraphQLContext } from "../../context.js";
import { listEligibleOpenEngineWorkItems } from "../../../lib/work-items/open-engine-queue-service.js";
import { resolveWorkItemTenant } from "../../../lib/work-items/auth.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { toGraphqlWorkItem } from "./shared.js";

export async function openEngineEligibleWorkItems(
  _: unknown,
  args: { input: Record<string, any> },
  ctx: GraphQLContext,
) {
  const input = args.input ?? {};
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  await requireAdminOrServiceCaller(
    ctx,
    tenantId,
    "open_engine_work_items:read",
  );
  const rows = await listEligibleOpenEngineWorkItems({
    tenantId,
    queueKey: input.queueKey ?? null,
    spaceId: input.spaceId ?? null,
    statusId: input.statusId ?? null,
    labelSlugs: Array.isArray(input.labelSlugs) ? input.labelSlugs : null,
    ownerUserId: input.ownerUserId ?? null,
    ownerAgentId: input.ownerAgentId ?? null,
    now: input.now ? new Date(input.now) : undefined,
    limit: input.limit,
  });
  return rows.map((row) => toGraphqlWorkItem(row as Record<string, unknown>));
}
