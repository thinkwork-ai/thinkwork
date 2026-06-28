import type { GraphQLContext } from "../../context.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveWorkItemTenant } from "../../../lib/work-items/auth.js";
import {
  routeOpenEngineWorkItem as routeOpenEngineWorkItemRow,
  normalizeOpenEngineQueueKey,
} from "../../../lib/work-items/open-engine-queue-service.js";
import { parseAwsJsonObject } from "../../../lib/work-items/work-item-service.js";
import { toGraphqlWorkItemEvent } from "./shared.js";

export async function routeOpenEngineWorkItem(
  _: unknown,
  args: { input: Record<string, any> },
  ctx: GraphQLContext,
) {
  const input = args.input ?? {};
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  await requireAdminOrServiceCaller(ctx, tenantId, "open_engine_work_items:route");
  const actorUserId =
    ctx.auth?.authType === "cognito"
      ? await resolveCallerUserId(ctx).catch(() => null)
      : null;
  const result = await routeOpenEngineWorkItemRow({
    tenantId,
    workItemId: input.workItemId,
    targetQueueKey: normalizeOpenEngineQueueKey(input.targetQueueKey),
    targetOwnerUserId: input.targetOwnerUserId ?? undefined,
    targetOwnerAgentId: input.targetOwnerAgentId ?? undefined,
    actorUserId,
    actorAgentId: input.agentId ?? null,
    message: input.message,
    metadata: parseOptionalAwsJsonObject(input.metadata),
    idempotencyKey: input.idempotencyKey ?? null,
    now: input.now ? new Date(input.now) : undefined,
  });
  return toGraphqlWorkItemEvent(result.event as Record<string, unknown>);
}

function parseOptionalAwsJsonObject(value: unknown) {
  if (value === undefined) return undefined;
  return parseAwsJsonObject(value) ?? undefined;
}
