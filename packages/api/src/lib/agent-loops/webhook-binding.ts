import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, webhooks } from "../../graphql/utils.js";

/**
 * Webhook-trigger row binding for an Automation (THINK-137 U6, R6).
 *
 * Saving an automation whose trigger family is `webhook` mints (or reuses) a
 * single `webhooks` row bound to the loop via `agent_loop_id`, with
 * `target_type = 'automation'`. The inbound handler resolves that row by token
 * and dispatches through the shared dispatcher.
 *
 * Token continuity is preserved: the row is NEVER deleted. Disabling the loop,
 * re-enabling it, or switching the trigger family away from `webhook` only
 * flips `enabled` — the same token keeps working when the automation is a
 * webhook trigger again.
 */
export const AUTOMATION_WEBHOOK_TARGET_TYPE = "automation";

export async function syncAgentLoopWebhookBinding(input: {
  tenantId: string;
  agentLoopId: string;
  name: string;
  triggerFamily: string;
  loopEnabled: boolean;
  actorId: string | null;
}): Promise<void> {
  const isWebhookTrigger = input.triggerFamily === "webhook";

  const [existing] = await db
    .select({ id: webhooks.id, enabled: webhooks.enabled })
    .from(webhooks)
    .where(
      and(
        eq(webhooks.tenant_id, input.tenantId),
        eq(webhooks.agent_loop_id, input.agentLoopId),
      ),
    )
    .limit(1);

  const now = new Date();

  if (isWebhookTrigger) {
    if (existing) {
      // Reuse the row — keep its token. Name mirrors the loop; enabled mirrors
      // the loop's enabled flag so disabling/re-enabling the automation gates
      // the endpoint without churning the token.
      await db
        .update(webhooks)
        .set({
          name: input.name,
          target_type: AUTOMATION_WEBHOOK_TARGET_TYPE,
          enabled: input.loopEnabled,
          updated_at: now,
        })
        .where(eq(webhooks.id, existing.id));
      return;
    }
    const token = randomBytes(32).toString("base64url");
    await db.insert(webhooks).values({
      tenant_id: input.tenantId,
      name: input.name,
      token,
      target_type: AUTOMATION_WEBHOOK_TARGET_TYPE,
      agent_loop_id: input.agentLoopId,
      enabled: input.loopEnabled,
      created_by_type: input.actorId ? "user" : "system",
      created_by_id: input.actorId,
    });
    return;
  }

  // Not a webhook trigger: if a bound row exists and is still enabled, disable
  // it (do NOT delete — token continuity). No-op when already disabled.
  if (existing && existing.enabled) {
    await db
      .update(webhooks)
      .set({ enabled: false, updated_at: now })
      .where(eq(webhooks.id, existing.id));
  }
}
