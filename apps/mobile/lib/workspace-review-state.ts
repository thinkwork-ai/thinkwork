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
  if (decision === "accept") return "Approve";
  if (decision === "resume") return "Continue";
  return "Reject";
}

export function workspaceReviewDecisionToast(
  decision: WorkspaceReviewDecision,
): string {
  if (decision === "accept") return "Agent cleared to continue";
  if (decision === "resume") return "Agent queued to continue";
  return "Agent run cancelled";
}

export function workspaceReviewErrorMessage(message: string): string {
  if (/review changed since you opened it/i.test(message)) {
    return "This review changed. Refresh before deciding.";
  }
  if (/tenant membership required/i.test(message)) {
    return "You do not have access to this request.";
  }
  return message.replace(/^\[GraphQL\]\s*/i, "");
}

export function parseWorkspaceReviewPayload(
  payload?: string | Record<string, unknown> | null,
): Record<string, unknown> {
  if (!payload) return {};
  if (typeof payload !== "string") {
    return Array.isArray(payload) ? {} : payload;
  }
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function shortWorkspaceId(id?: string | null): string {
  return id ? id.slice(0, 8) : "-";
}

export function formatWorkspaceReviewTime(dateStr?: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.max(0, Math.floor(diff / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
