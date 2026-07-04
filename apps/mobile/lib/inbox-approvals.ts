import { visibleMobileInboxItems } from "@/lib/mobile-inbox";

export type ApprovalItemLike = {
  id: string;
  type?: string | null;
  status?: string | null;
  title?: string | null;
  description?: string | null;
  config?: unknown;
  expiresAt?: string | null;
};

export function visibleApprovalItems<T extends ApprovalItemLike>(
  items: T[],
): T[] {
  return visibleMobileInboxItems(items);
}

export function parseApprovalConfig(
  config: unknown,
): Record<string, unknown> {
  if (!config) return {};
  if (typeof config === "string") {
    try {
      const parsed = JSON.parse(config) as unknown;
      return parseApprovalConfig(parsed);
    } catch {
      return {};
    }
  }
  if (typeof config === "object" && !Array.isArray(config)) {
    return config as Record<string, unknown>;
  }
  return {};
}

export function approvalQuestion(item: ApprovalItemLike): string {
  const config = parseApprovalConfig(item.config);
  return (
    stringValue(config.question) ??
    stringValue(config.questionText) ??
    item.title?.trim() ??
    stringValue(config.actionDescription) ??
    stringValue(config.action_description) ??
    stringValue(config.description) ??
    item.description?.trim() ??
    "Approval needed"
  );
}

export function approvalReason(item: ApprovalItemLike): string | null {
  const config = parseApprovalConfig(item.config);
  return (
    stringValue(config.reason) ??
    stringValue(config.actionDescription) ??
    stringValue(config.action_description) ??
    stringValue(config.description) ??
    item.description?.trim() ??
    null
  );
}

export function isApprovalExpired(item: ApprovalItemLike): boolean {
  if (item.status === "EXPIRED" || item.status === "expired") return true;
  if (!item.expiresAt) return false;
  return new Date(item.expiresAt).getTime() <= Date.now();
}

export function formatExpiry(expiresAt?: string | null): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "Expired";
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes}m remaining`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours}h remaining`;
  return `${Math.ceil(hours / 24)}d remaining`;
}

export function buildApprovalDecisionVariables(
  id: string,
  reviewNotes?: string | null,
) {
  const notes = reviewNotes?.trim();
  return {
    id,
    input: notes ? { reviewNotes: notes } : {},
  };
}

export function isAlreadyResolvedInboxError(error: unknown): boolean {
  const messages = errorMessages(error);
  return messages.some(
    (message) =>
      message.includes("Invalid inbox item transition") ||
      message.includes("already resolved"),
  );
}

function errorMessages(error: unknown): string[] {
  if (!error) return [];
  if (typeof error === "string") return [error];
  if (error instanceof Error) return [error.message];
  const record = error as Record<string, unknown>;
  const messages: string[] = [];
  if (typeof record.message === "string") messages.push(record.message);
  const graphQLErrors = record.graphQLErrors;
  if (Array.isArray(graphQLErrors)) {
    for (const graphQLError of graphQLErrors) {
      if (
        graphQLError &&
        typeof graphQLError === "object" &&
        typeof (graphQLError as { message?: unknown }).message === "string"
      ) {
        messages.push((graphQLError as { message: string }).message);
      }
    }
  }
  return messages;
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
