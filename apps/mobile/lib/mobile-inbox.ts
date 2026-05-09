export const COMPUTER_APPROVAL_INBOX_TYPE = "computer_approval";

export type InboxItemLike = {
  type?: string | null;
};

export function visibleMobileInboxItems<T extends InboxItemLike>(items: T[]): T[] {
  return items.filter((item) => item.type !== COMPUTER_APPROVAL_INBOX_TYPE);
}
