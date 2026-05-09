export type NotificationData = Record<string, unknown> | undefined | null;

export type PushNavigationTarget =
  | { kind: "computer_approval"; url: string }
  | { kind: "thread"; threadId: string }
  | null;

export function pushNavigationTarget(
  contentData: NotificationData,
  triggerPayload: NotificationData,
): PushNavigationTarget {
  const data = { ...(triggerPayload ?? {}), ...(contentData ?? {}) };
  if (
    data.type === "computer_approval" &&
    typeof data.deepLinkUrl === "string" &&
    data.deepLinkUrl.trim()
  ) {
    return { kind: "computer_approval", url: data.deepLinkUrl.trim() };
  }

  if (typeof data.threadId === "string" && data.threadId.trim()) {
    return { kind: "thread", threadId: data.threadId.trim() };
  }

  return null;
}
