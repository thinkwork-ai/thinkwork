import { useSyncExternalStore } from "react";

/**
 * Per-section "show unread only" preference for the chat sidebar, persisted in
 * localStorage so a section's filter choice survives reloads. Mirrors
 * thread-notifications-pref.ts (useSyncExternalStore + same-tab event + cross-tab
 * `storage` listener).
 *
 * Stored as a single JSON object keyed by a stable section id (`"chats"`,
 * `"space:<id>"`). Default OFF (Show all) for any section not present in the
 * map; malformed stored JSON falls back to all-off.
 */
const STORAGE_KEY = "thinkwork:sidebar-section-unread-filter";
const EVENT = "thinkwork:sidebar-section-prefs";

function readMap(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, boolean>;
    }
    return {};
  } catch {
    // Corrupt/garbage value — treat every section as Show all.
    return {};
  }
}

export function getSectionUnreadFilter(sectionId: string): boolean {
  return readMap()[sectionId] === true;
}

export function setSectionUnreadFilter(sectionId: string, on: boolean): void {
  if (typeof window === "undefined") return;
  const next = readMap();
  if (on) {
    next[sectionId] = true;
  } else {
    delete next[sectionId];
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  // Notify same-tab subscribers (the storage event only fires cross-tab).
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) callback();
  };
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * React binding for one section's unread-filter preference; re-renders on
 * same-tab and cross-tab changes.
 */
export function useSectionUnreadFilter(sectionId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getSectionUnreadFilter(sectionId),
    () => false,
  );
}
