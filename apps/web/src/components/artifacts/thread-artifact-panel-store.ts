/**
 * THINK-168: per-thread docked artifact panel state.
 *
 * Clicking an ArtifactCard in a thread transcript opens the artifact in a
 * right-hand panel beside the conversation. The open-artifact selection is
 * keyed by thread id and lives in this module-scoped store (consumed via
 * useSyncExternalStore) rather than component state, so it survives the
 * refetch/re-render churn that sending a message causes — and even a full
 * remount of the thread view (route-level refetches can replace the whole
 * TaskThreadView subtree while a turn is streaming).
 */

import { useCallback, useSyncExternalStore } from "react";

const openArtifactByThread = new Map<string, string>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) listener();
}

export function subscribeThreadArtifactPanel(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getOpenThreadArtifactId(
  threadId: string | null | undefined,
): string | null {
  if (!threadId) return null;
  return openArtifactByThread.get(threadId) ?? null;
}

export function openThreadArtifactPanel(threadId: string, artifactId: string) {
  if (openArtifactByThread.get(threadId) === artifactId) return;
  openArtifactByThread.set(threadId, artifactId);
  emit();
}

export function closeThreadArtifactPanel(threadId: string) {
  if (!openArtifactByThread.has(threadId)) return;
  openArtifactByThread.delete(threadId);
  emit();
}

/** Test-only: reset all per-thread panel state between cases. */
export function resetThreadArtifactPanels() {
  openArtifactByThread.clear();
}

export interface ThreadArtifactPanelHandle {
  /** Artifact currently open in this thread's panel, or null when closed. */
  artifactId: string | null;
  open: (artifactId: string) => void;
  close: () => void;
}

export function useThreadArtifactPanel(
  threadId: string | null | undefined,
): ThreadArtifactPanelHandle {
  const artifactId = useSyncExternalStore(
    subscribeThreadArtifactPanel,
    () => getOpenThreadArtifactId(threadId),
    () => getOpenThreadArtifactId(threadId),
  );
  const open = useCallback(
    (id: string) => {
      if (threadId) openThreadArtifactPanel(threadId, id);
    },
    [threadId],
  );
  const close = useCallback(() => {
    if (threadId) closeThreadArtifactPanel(threadId);
  }, [threadId]);
  return { artifactId, open, close };
}
