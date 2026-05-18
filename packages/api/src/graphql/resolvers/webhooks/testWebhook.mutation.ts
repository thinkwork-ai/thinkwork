/**
 * testWebhook — record a synthetic delivery so operators can confirm
 * the webhook exists and the delivery-log pipeline is functioning.
 *
 * Deliberately does NOT trigger any downstream dispatch. The row is
 * stamped with `resolution_status = "test"` and a recognizable
 * `body_preview` so the operator (or admin UI / `webhook deliveries`)
 * can tell at a glance that it's a synthetic record. End-to-end
 * reachability against the public URL still requires a real POST
 * against `/webhooks/{token}` — the CLI's success message includes
 * the curl one-liner to do that.
 *
 * Auth: `requireAdminOrServiceCaller(ctx, row.tenant_id,
 * "test_webhook")`. Admin-tier, no user-identity stamping; service
 * callers admitted.
 */

import { createHash } from "node:crypto";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  webhooks,
  webhookDeliveries,
  snakeToCamel,
} from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";

export const testWebhook = async (
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
) => {
  const [webhook] = await db
    .select({
      id: webhooks.id,
      tenant_id: webhooks.tenant_id,
      target_type: webhooks.target_type,
    })
    .from(webhooks)
    .where(eq(webhooks.id, args.id));

  if (!webhook) {
    throw new Error(`Webhook ${args.id} not found`);
  }

  await requireAdminOrServiceCaller(ctx, webhook.tenant_id, "test_webhook");

  const body = JSON.stringify({
    _thinkwork_test: true,
    note: "Synthetic delivery created via testWebhook mutation. No downstream dispatch.",
    issued_at: new Date().toISOString(),
  });

  const [row] = await db
    .insert(webhookDeliveries)
    .values({
      webhook_id: webhook.id,
      tenant_id: webhook.tenant_id,
      target_type: webhook.target_type,
      received_at: new Date(),
      source_ip: "127.0.0.1",
      body_preview: body,
      body_sha256: createHash("sha256").update(body).digest("hex"),
      body_size_bytes: Buffer.byteLength(body, "utf8"),
      headers_safe: { "x-thinkwork-test": "true" },
      signature_status: "not_required",
      resolution_status: "test",
      status_code: 200,
      duration_ms: 0,
      retry_count: 0,
      is_replay: false,
    })
    .returning();

  return snakeToCamel(row);
};
