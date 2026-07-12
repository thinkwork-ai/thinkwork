/**
 * retryMemoryRetractionAttempt — operator DLQ retry (THINK-193 U2,
 * Codex round-5 P2): reset a dead_lettered (or remediated failed) retraction
 * attempt — saga child OR erase marker — back to a due queued state with a
 * fresh attempt budget. The underlying requeue bumps lock_generation, so any
 * stale worker still holding the old claim is fenced out. Tenant-admin
 * gated; RequestResponse (errors surface, incl. the per-document unique
 * violation when a NEWER attempt already covers the same document).
 */

import type { GraphQLContext } from "../../context.js";
import { requeueRetractionAttempt } from "../../../lib/memory-sources/retraction.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerTenantId } from "../core/resolve-auth-user.js";
import { toGraphqlRetractionAttempt } from "./memoryRetractionAttempts.query.js";

export async function retryMemoryRetractionAttempt(
  _parent: unknown,
  args: { tenantId?: string | null; attemptId: string },
  ctx: GraphQLContext,
) {
  const tenantId =
    args.tenantId ?? ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  await requireTenantAdmin(ctx, tenantId);

  const requeued = await requeueRetractionAttempt(ctx.db, {
    tenantId,
    attemptId: args.attemptId,
  });
  if (!requeued) {
    throw new Error(
      "Retraction attempt not found or not retryable (only failed/dead_lettered attempts can be retried)",
    );
  }
  return toGraphqlRetractionAttempt(requeued);
}
