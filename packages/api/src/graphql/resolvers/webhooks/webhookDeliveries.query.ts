/**
 * webhookDeliveries — admin-tier list of recent inbound webhook
 * requests for one webhook.
 *
 * Two-step lookup so the auth gate runs against the webhook's
 * authoritative tenant_id (not whatever the caller asserted):
 *   1. Load the webhook row, extract tenant_id.
 *   2. requireAdminOrServiceCaller(ctx, tenant_id, "webhook_deliveries").
 *   3. Read `webhook_deliveries` filtered by `webhook_id`, newest first.
 *
 * Cross-tenant id resolves to an empty list (the webhook lookup
 * misses) — same fail-closed behavior as the threads queries.
 *
 * Hard cap of 500 rows guards against runaway responses; default 50
 * matches what the admin UI's webhook-detail panel renders. Rows are
 * PII-bearing (provider task titles, customer names in body_preview);
 * the GraphQL surface here intentionally does NOT redact — the auth
 * gate is the trust boundary.
 */

import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  desc,
  webhooks,
  webhookDeliveries,
  snakeToCamel,
} from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export const webhookDeliveries_ = async (
  _parent: unknown,
  args: { webhookId: string; limit?: number | null },
  ctx: GraphQLContext,
) => {
  const [webhook] = await db
    .select({ id: webhooks.id, tenant_id: webhooks.tenant_id })
    .from(webhooks)
    .where(eq(webhooks.id, args.webhookId));

  if (!webhook) {
    // Cross-tenant or genuinely-missing webhook → empty list, no auth
    // probe (mirrors threads.query / thread.query pattern).
    return [];
  }

  await requireAdminOrServiceCaller(
    ctx,
    webhook.tenant_id,
    "webhook_deliveries",
  );

  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const rows = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhook_id, args.webhookId))
    .orderBy(desc(webhookDeliveries.received_at))
    .limit(limit);

  return rows.map(snakeToCamel);
};
