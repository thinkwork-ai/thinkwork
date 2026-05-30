import { useSyncExternalStore } from "react";

/**
 * Global on/off preference for desktop thread notifications (U7, R10).
 * Persisted in localStorage so it survives reloads; defaults ON. Per-thread
 * mute is out of scope (the thread_participants.notification_preference column
 * is reserved for a future iteration).
 */
const STORAGE_KEY = "thinkwork:thread-notifications-enabled";

function read(): boolean {
  if (typeof window === "undefined") return true;
  // Default ON: only an explicit "false" disables.
  return window.localStorage.getItem(STORAGE_KEY) !== "false";
}

export function getThreadNotificationsEnabled(): boolean {
  return read();
}

export function setThreadNotificationsEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
  // Notify same-tab subscribers (the storage event only fires cross-tab).
  window.dispatchEvent(new Event(THREAD_NOTIFICATIONS_PREF_EVENT));
}

const THREAD_NOTIFICATIONS_PREF_EVENT = "thinkwork:thread-notifications-pref";

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) callback();
  };
  window.addEventListener(THREAD_NOTIFICATIONS_PREF_EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(THREAD_NOTIFICATIONS_PREF_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

/** React binding for the preference; re-renders on same-tab and cross-tab changes. */
export function useThreadNotificationsEnabled(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}
