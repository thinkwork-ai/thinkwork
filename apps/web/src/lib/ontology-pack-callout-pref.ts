import { useSyncExternalStore } from "react";

/**
 * Per-admin dismissal of the Living Map's day-one "install a starter pack"
 * callout (THINK-320 U7, R12), persisted in localStorage so the nudge stays
 * gone across reloads. Mirrors sidebar-section-prefs.ts (useSyncExternalStore
 * + same-tab event + cross-tab `storage` listener).
 *
 * Stored as a single JSON object keyed by `<userId>:<tenantId>` so the
 * dismissal is scoped to one admin on one tenant. Malformed stored JSON falls
 * back to not-dismissed.
 */
const STORAGE_KEY = "thinkwork:ontology-pack-callout-dismissed";
const EVENT = "thinkwork:ontology-pack-callout-pref";

function prefKey(userId: string | null, tenantId: string | null): string {
  return `${userId ?? "unknown"}:${tenantId ?? "unknown"}`;
}

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
    // Corrupt/garbage value — treat the callout as never dismissed.
    return {};
  }
}

export function getPackCalloutDismissed(
  userId: string | null,
  tenantId: string | null,
): boolean {
  return readMap()[prefKey(userId, tenantId)] === true;
}

export function dismissPackCallout(
  userId: string | null,
  tenantId: string | null,
): void {
  if (typeof window === "undefined") return;
  const next = readMap();
  next[prefKey(userId, tenantId)] = true;
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
 * React binding for one admin's callout dismissal; re-renders on same-tab and
 * cross-tab changes.
 */
export function usePackCalloutDismissed(
  userId: string | null,
  tenantId: string | null,
): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getPackCalloutDismissed(userId, tenantId),
    () => false,
  );
}
