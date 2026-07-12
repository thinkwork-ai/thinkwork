/**
 * personalMemoryAutomation — the signed-in user's Personal Memory Automation
 * (THINK-193 U3, R4-R6).
 *
 * OWNER-ONLY by construction: the automation is resolved from the caller's
 * own user id — there is no argument to read another user's. Lazily ensures
 * the processor + agent_private workflow + current blueprint version so the
 * first configuration read provisions everything.
 */

import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { ensurePersonalMemoryAutomation } from "../../../lib/memory-sources/provisioning.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import { toGraphqlManagedMemoryWorkflow } from "./managed-memory-workflow.js";

export async function personalMemoryAutomation(
  _parent: unknown,
  _args: unknown,
  ctx: GraphQLContext,
) {
  const tenantId = ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  const userId = await resolveCallerUserId(ctx);
  if (!userId) {
    throw new Error(
      "A signed-in user is required — personal memory automations belong to a user, not a service caller",
    );
  }

  const ensured = await ensurePersonalMemoryAutomation(db, {
    tenantId,
    userId,
  });
  return toGraphqlManagedMemoryWorkflow(ensured);
}
