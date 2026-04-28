import {
  decideWorkspaceReview,
  type WorkspaceReviewDecision,
  type WorkspaceReviewDecisionInput,
} from "../../../lib/workspace-events/review-actions.js";

/**
 * Bridge from inbox decision to the underlying workspace review action.
 * Used by approveInboxItem / rejectInboxItem / requestRevision when the
 * inbox item materialized from a workspace review (type='workspace_review',
 * entity_type='agent_workspace_run').
 *
 * For non-workspace-review inbox items, callers should not invoke this.
 */
export async function bridgeInboxDecisionToWorkspaceReview(input: {
  inboxItem: {
    type: string;
    entity_type: string | null;
    entity_id: string | null;
  };
  decision: WorkspaceReviewDecision;
  actorId: string | null;
  values: WorkspaceReviewDecisionInput;
}): Promise<{ dispatched: boolean }> {
  if (
    input.inboxItem.type !== "workspace_review" ||
    input.inboxItem.entity_type !== "agent_workspace_run" ||
    !input.inboxItem.entity_id
  ) {
    return { dispatched: false };
  }
  await decideWorkspaceReview({
    runId: input.inboxItem.entity_id,
    decision: input.decision,
    actorId: input.actorId,
    values: input.values,
  });
  return { dispatched: true };
}

export function isWorkspaceReviewInboxItem(item: {
  type: string;
  entity_type: string | null;
}): boolean {
  return (
    item.type === "workspace_review" &&
    item.entity_type === "agent_workspace_run"
  );
}
