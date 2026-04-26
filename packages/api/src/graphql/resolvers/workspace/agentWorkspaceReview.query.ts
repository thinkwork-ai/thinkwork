import type { GraphQLContext } from "../../context.js";
import { requireTenantMember } from "../core/authz.js";
import { loadWorkspaceReviewDetail } from "../../../lib/workspace-events/review-detail.js";

export async function agentWorkspaceReview(
  _parent: unknown,
  args: { runId: string },
  ctx: GraphQLContext,
): Promise<Record<string, unknown> | null> {
  const result = await loadWorkspaceReviewDetail(args.runId, {
    authorizeRun: async (run) => {
      await requireTenantMember(ctx, run.tenant_id);
    },
  });
  if (!result) return null;
  return result.detail as unknown as Record<string, unknown>;
}
