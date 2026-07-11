import type { GraphQLContext } from "../../context.js";
import { requireMemoryTenantScope } from "../core/require-user-scope.js";
import { listTenantBankMemories } from "../../../lib/memory/promotion.js";

/**
 * Company-brain plan U11 — the Tenant Bank's contents with Governed
 * Promotion provenance and per-unit access_count, in one query. Tenant
 * membership suffices to read: the bank is already recalled by every tenant
 * member's agent (R9), so the inspection surface matches the recall surface.
 */
export const tenantBankMemories = async (
  _parent: unknown,
  args: { tenantId?: string | null; limit?: number | null },
  ctx: GraphQLContext,
) => {
  const { tenantId } = await requireMemoryTenantScope(ctx, args);
  return listTenantBankMemories({
    tenantId,
    limit: args.limit ?? undefined,
  });
};
