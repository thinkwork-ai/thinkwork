import type { GraphQLContext } from "../../context.js";
import { requireTenantMember } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { listBrainEnrichmentSources } from "../../../lib/brain/enrichment-service.js";

export const brainEnrichmentSources = async (
  _parent: unknown,
  args: { tenantId: string; pageTable: string; pageId: string },
  ctx: GraphQLContext,
) => {
  await requireTenantMember(ctx, args.tenantId);
  const userId = await resolveCallerUserId(ctx);
  return listBrainEnrichmentSources({
    tenantId: args.tenantId,
    caller: {
      tenantId: args.tenantId,
      userId,
      agentId: ctx.auth.agentId ?? null,
    },
  });
};
