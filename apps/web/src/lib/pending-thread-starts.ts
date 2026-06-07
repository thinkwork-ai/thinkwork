export interface PendingThreadStartAttachment {
  name: string;
  sizeBytes?: number | null;
  mimeType?: string | null;
}

export interface PendingThreadStart {
  threadId: string;
  title: string;
  content: string;
  expectAssistantResponse: boolean;
  startedAt?: string | null;
  /** Attached files, shown optimistically on the first user message. */
  attachments?: PendingThreadStartAttachment[];
}

const pendingThreadStarts = new Map<string, PendingThreadStart>();

export function setPendingThreadStart(start: PendingThreadStart) {
  pendingThreadStarts.set(start.threadId, start);
}

export function getPendingThreadStart(threadId: string) {
  return pendingThreadStarts.get(threadId) ?? null;
}

export function clearPendingThreadStart(threadId: string) {
  pendingThreadStarts.delete(threadId);
}
