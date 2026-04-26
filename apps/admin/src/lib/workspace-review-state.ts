export type WorkspaceReviewDecision = "accept" | "cancel" | "resume";

export function workspaceReviewActionsForStatus(status?: string | null): {
  accept: boolean;
  cancel: boolean;
  resume: boolean;
} {
  const normalized = (status ?? "").toLowerCase();
  if (normalized === "awaiting_review") {
    return { accept: true, cancel: true, resume: true };
  }
  if (normalized === "pending") {
    return { accept: false, cancel: false, resume: true };
  }
  return { accept: false, cancel: false, resume: false };
}

export function workspaceReviewDecisionLabel(
  decision: WorkspaceReviewDecision,
): string {
  if (decision === "accept") return "Accept and continue";
  if (decision === "resume") return "Continue run";
  return "Reject / cancel";
}

export function workspaceReviewDecisionToast(
  decision: WorkspaceReviewDecision,
): string {
  if (decision === "accept") return "Review accepted";
  if (decision === "resume") return "Run queued";
  return "Run cancelled";
}

export function workspaceReviewErrorMessage(message: string): string {
  if (/review changed since you opened it/i.test(message)) {
    return "Review changed since you opened it";
  }
  return message;
}
