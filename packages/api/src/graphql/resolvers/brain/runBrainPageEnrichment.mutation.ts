import type { GraphQLContext } from "../../context.js";
import { requireTenantMember } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
  runBrainPageEnrichment as runBrainPageEnrichmentService,
  type RunBrainPageEnrichmentInput,
} from "../../../lib/brain/enrichment-service.js";

export const runBrainPageEnrichment = async (
  _parent: unknown,
  args: { input: RunBrainPageEnrichmentInput },
  ctx: GraphQLContext,
) => {
  await requireTenantMember(ctx, args.input.tenantId);
  const userId = await resolveCallerUserId(ctx);
  if (!userId) throw new Error("User identity required");
  return runBrainPageEnrichmentService({
    input: args.input,
    caller: {
      tenantId: args.input.tenantId,
      userId,
      agentId: ctx.auth.agentId ?? null,
    },
  });
};
