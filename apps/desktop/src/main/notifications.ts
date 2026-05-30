import { BrowserWindow, Notification } from "electron";
import {
  OPEN_THREAD_EVENT_CHANNEL,
  type RaiseThreadNotificationRequest,
} from "@thinkwork/desktop-ipc";

/**
 * Active notifications keyed by threadId. Electron's main-process `Notification`
 * has no web-style `tag` for OS-level replace, so we coalesce manually: a new
 * raise for a thread closes the prior one before showing, so the OS shows at
 * most one notification per thread at a time (R4 — no stacking/flooding).
 */
const activeByThread = new Map<string, Notification>();

/** Restore + focus the first window (mirrors focusExistingWindow in index.ts). */
function focusExistingWindow(): void {
  const [window] = BrowserWindow.getAllWindows();
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
}

/** Send an open-thread event to every renderer (mirrors the deep-link broadcast). */
function broadcastOpenThread(threadId: string): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(OPEN_THREAD_EVENT_CHANNEL, { threadId });
  }
}

/**
 * Raises a native OS notification for a thread. On click, focuses the window and
 * pushes an open-thread event to the renderer (R7/R8). No-op (never throws) when
 * notifications aren't supported on the platform.
 */
export function raiseThreadNotification(
  request: RaiseThreadNotificationRequest,
): void {
  if (!Notification.isSupported()) return;

  // Coalesce: drop any prior notification still showing for this thread.
  const existing = activeByThread.get(request.threadId);
  if (existing) {
    existing.close();
    activeByThread.delete(request.threadId);
  }

  const notification = new Notification({
    title: request.title,
    body: request.body,
  });

  notification.on("click", () => {
    activeByThread.delete(request.threadId);
    focusExistingWindow();
    broadcastOpenThread(request.threadId);
  });

  notification.on("close", () => {
    if (activeByThread.get(request.threadId) === notification) {
      activeByThread.delete(request.threadId);
    }
  });

  activeByThread.set(request.threadId, notification);
  notification.show();
}

/** Test-only: clears the per-thread coalescing map between cases. */
export function __resetThreadNotificationsForTest(): void {
  activeByThread.clear();
}
