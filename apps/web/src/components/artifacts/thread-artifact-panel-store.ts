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

/**
 * Sentinel "artifact id": the panel is open in LIST state (thread has
 * multiple card-rendered artifacts; the user picks one from the list).
 * Transient by design — choosing an artifact replaces it with the real id.
 */
export const THREAD_ARTIFACT_PANEL_LIST = "::artifact-list::";

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

/**
 * Panel width persistence — ONE global width (not per-thread): the split is
 * an ergonomic preference about how much room artifacts get on this screen,
 * not a property of any particular thread. localStorage-backed so it also
 * survives reloads; a module fallback keeps environments without
 * localStorage (tests) working.
 */
const PANEL_WIDTH_STORAGE_KEY = "thinkwork.thread-artifact-panel.width";
export const DEFAULT_THREAD_ARTIFACT_PANEL_WIDTH_PX = 480;
export const MIN_THREAD_ARTIFACT_PANEL_WIDTH_PX = 360;

let panelWidthFallbackPx = DEFAULT_THREAD_ARTIFACT_PANEL_WIDTH_PX;

export function getStoredThreadArtifactPanelWidthPx(): number {
  try {
    const raw = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
    const parsed = raw === null ? NaN : Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.max(MIN_THREAD_ARTIFACT_PANEL_WIDTH_PX, Math.round(parsed));
    }
  } catch {
    // fall through to the module fallback
  }
  return panelWidthFallbackPx;
}

export function storeThreadArtifactPanelWidthPx(widthPx: number) {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return;
  const rounded = Math.max(
    MIN_THREAD_ARTIFACT_PANEL_WIDTH_PX,
    Math.round(widthPx),
  );
  panelWidthFallbackPx = rounded;
  try {
    window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(rounded));
  } catch {
    // module fallback already updated
  }
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
