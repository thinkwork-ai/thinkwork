import type { GraphQLContext } from "../../context.js";
import { agentWorkspaceRuns, db, eq, and } from "../../utils.js";
import {
  classifyWorkspaceReview,
  createDrizzleClassifyChainStore,
  type ClassifyChainStore,
} from "../../../lib/workspace-events/classify-review.js";
import { requireTenantMember } from "../core/authz.js";

export async function pendingSystemReviewsCount(
  _parent: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
  deps: { classifierStore?: ClassifyChainStore } = {},
): Promise<number> {
  await requireTenantMember(ctx, args.tenantId);

  const runs = await db
    .select({
      id: agentWorkspaceRuns.id,
      tenant_id: agentWorkspaceRuns.tenant_id,
      agent_id: agentWorkspaceRuns.agent_id,
    })
    .from(agentWorkspaceRuns)
    .where(
      and(
        eq(agentWorkspaceRuns.tenant_id, args.tenantId),
        eq(agentWorkspaceRuns.status, "awaiting_review"),
      ),
    );

  const classifierStore =
    deps.classifierStore ?? createDrizzleClassifyChainStore();

  let count = 0;
  for (const run of runs) {
    const classification = await classifyWorkspaceReview(classifierStore, {
      tenantId: run.tenant_id,
      agentId: run.agent_id,
    });
    if (classification.kind === "system") count += 1;
  }
  return count;
}
