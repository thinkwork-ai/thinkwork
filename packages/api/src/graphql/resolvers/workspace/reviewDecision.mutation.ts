import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { snakeToCamel } from "../../utils.js";
import { requireTenantMember } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import {
  createDrizzleWorkspaceReviewActionStore,
  decideWorkspaceReview as decideWorkspaceReviewAction,
  WorkspaceReviewActionError,
  type WorkspaceReviewDecision,
} from "../../../lib/workspace-events/review-actions.js";

interface DecisionArgs {
  runId: string;
  input?: {
    notes?: string | null;
    idempotencyKey?: string | null;
    expectedReviewEtag?: string | null;
    responseMarkdown?: string | null;
  } | null;
}

export async function acceptAgentWorkspaceReview(
  _parent: unknown,
  args: DecisionArgs,
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  return decideWorkspaceReview(args, ctx, "accepted");
}

export async function cancelAgentWorkspaceReview(
  _parent: unknown,
  args: DecisionArgs,
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  return decideWorkspaceReview(args, ctx, "cancelled");
}

export async function resumeAgentWorkspaceRun(
  _parent: unknown,
  args: DecisionArgs,
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  return decideWorkspaceReview(args, ctx, "resumed");
}

async function decideWorkspaceReview(
  args: DecisionArgs,
  ctx: GraphQLContext,
  decision: WorkspaceReviewDecision,
): Promise<Record<string, unknown>> {
  const store = createDrizzleWorkspaceReviewActionStore();
  const run = await store.findRunById(args.runId);
  if (!run) {
    throw new GraphQLError("Workspace run not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }

  await requireTenantMember(ctx, run.tenant_id);
  const actorId = await resolveCallerUserId(ctx);

  try {
    const result = await decideWorkspaceReviewAction(
      {
        runId: args.runId,
        decision,
        actorId: actorId ?? null,
        values: args.input,
      },
      { store },
    );
    if (!result) {
      throw new GraphQLError("Workspace run not found", {
        extensions: { code: "NOT_FOUND" },
      });
    }
    return snakeToCamel(result.run as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof WorkspaceReviewActionError) {
      throw new GraphQLError(err.message, {
        extensions: { code: err.code },
      });
    }
    throw err;
  }
}
