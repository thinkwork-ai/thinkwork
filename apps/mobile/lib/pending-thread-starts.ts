export interface PendingThreadStart {
  threadId: string;
  title: string;
  content: string;
  persistedContent?: string;
  expectAssistantResponse: boolean;
  userId?: string | null;
  clientTurnId?: string | null;
  createdAt: string;
}

const pendingThreadStarts = new Map<string, PendingThreadStart>();

export function setPendingThreadStart(start: PendingThreadStart) {
  pendingThreadStarts.set(start.threadId, start);
}

export function getPendingThreadStart(threadId: string | null | undefined) {
  if (!threadId) return null;
  return pendingThreadStarts.get(threadId) ?? null;
}

export function clearPendingThreadStart(threadId: string | null | undefined) {
  if (!threadId) return;
  pendingThreadStarts.delete(threadId);
}
