export const COMPUTER_APPROVAL_INBOX_TYPE = "computer_approval";

export type InboxItemLike = {
  type?: string | null;
  config?: unknown;
};

export function visibleMobileInboxItems<T extends InboxItemLike>(
  items: T[],
): T[] {
  return items.filter(
    (item) =>
      item.type !== COMPUTER_APPROVAL_INBOX_TYPE ||
      isEmailSendApprovalConfig(item.config),
  );
}

export function isEmailSendApprovalConfig(config: unknown): boolean {
  const parsed = parseConfig(config);
  return parsed?.actionType === "email_send" || Boolean(parsed?.emailDraft);
}

function parseConfig(config: unknown): Record<string, unknown> | null {
  if (typeof config === "string" && config.trim()) {
    try {
      const parsed = JSON.parse(config) as unknown;
      return parseConfig(parsed);
    } catch {
      return null;
    }
  }
  if (typeof config === "object" && config !== null && !Array.isArray(config)) {
    return config as Record<string, unknown>;
  }
  return null;
}
