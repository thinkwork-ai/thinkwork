/**
 * ensureSharedMemoryWorkflow — operator-only idempotent provisioning of the
 * shared Memory Workflow for one Space/Tenant target (THINK-193 U3, R8).
 */

import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { ensureSharedMemoryWorkflow as ensureShared } from "../../../lib/memory-sources/provisioning.js";
import { requireTenantAdmin } from "../core/authz.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import { toGraphqlManagedMemoryWorkflow } from "./managed-memory-workflow.js";

export async function ensureSharedMemoryWorkflow(
  _parent: unknown,
  args: { tenantId?: string | null; targetScope: string; targetId: string },
  ctx: GraphQLContext,
) {
  const tenantId =
    args.tenantId ?? ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  await requireTenantAdmin(ctx, tenantId);

  if (args.targetScope !== "space" && args.targetScope !== "tenant") {
    throw new Error(
      `targetScope must be 'space' or 'tenant' — shared memory never targets user banks (AE7)`,
    );
  }

  const ensured = await ensureShared(db, {
    tenantId,
    targetScope: args.targetScope,
    targetId: args.targetId,
    actorUserId: await resolveCallerUserId(ctx),
  });
  return toGraphqlManagedMemoryWorkflow(ensured);
}
