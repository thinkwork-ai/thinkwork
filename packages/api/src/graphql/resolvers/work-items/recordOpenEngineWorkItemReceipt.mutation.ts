import type { GraphQLContext } from "../../context.js";
import { recordOpenEngineReceipt } from "../../../lib/work-items/open-engine-receipt-service.js";
import { parseAwsJsonObject } from "../../../lib/work-items/work-item-service.js";
import { resolveWorkItemTenant } from "../../../lib/work-items/auth.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { toGraphqlWorkItemEvent } from "./shared.js";

export async function recordOpenEngineWorkItemReceipt(
  _: unknown,
  args: { input: Record<string, any> },
  ctx: GraphQLContext,
) {
  const input = args.input ?? {};
  const tenantId = await resolveWorkItemTenant(ctx, input.tenantId);
  await requireAdminOrServiceCaller(
    ctx,
    tenantId,
    "open_engine_work_item_receipts:create",
  );
  const event = await recordOpenEngineReceipt({
    tenantId,
    workItemId: input.workItemId,
    agentId: input.agentId,
    receiptType: input.receiptType,
    threadId: input.threadId ?? null,
    message: input.message,
    evidence: parseOptionalAwsJsonObject(input.evidence),
    metadata: parseOptionalAwsJsonObject(input.metadata),
    idempotencyKey: input.idempotencyKey ?? null,
    now: input.now ? new Date(input.now) : undefined,
  });
  return toGraphqlWorkItemEvent(event as Record<string, unknown>);
}

function parseOptionalAwsJsonObject(value: unknown) {
  if (value === undefined) return undefined;
  return parseAwsJsonObject(value) ?? undefined;
}
