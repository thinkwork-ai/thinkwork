import { useSyncExternalStore } from "react";

const pendingThreadDeletes = new Set<string>();
const listeners = new Set<() => void>();
let snapshot = new Set<string>();

function emit() {
  snapshot = new Set(pendingThreadDeletes);
  for (const listener of listeners) listener();
}

export function setThreadDeletePending(threadId: string, pending: boolean) {
  if (!threadId) return;
  if (pending) pendingThreadDeletes.add(threadId);
  else pendingThreadDeletes.delete(threadId);
  emit();
}

export function clearMissingThreadDeletes(threadIds: Iterable<string>) {
  const visible = new Set(threadIds);
  let changed = false;
  for (const id of pendingThreadDeletes) {
    if (!visible.has(id)) {
      pendingThreadDeletes.delete(id);
      changed = true;
    }
  }
  if (changed) emit();
}

export function usePendingThreadDeletes() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => new Set<string>(),
  );
}
