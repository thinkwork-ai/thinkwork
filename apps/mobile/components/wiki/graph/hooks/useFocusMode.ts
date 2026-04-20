import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import { useRecentWikiPages } from "@thinkwork/react-native-sdk";

const MAX_DEPTH = 2;
const STORAGE_PREFIX = "thinkwork:wiki-graph:last-focal:";
const FALLBACK_LIMIT = 5;

interface UseFocusModeArgs {
  tenantId: string | null | undefined;
  agentId: string | null | undefined;
  routeFocalPageId?: string | null;
}

/**
 * Resolves the focal page deterministically.
 *
 * Priority:
 *   1. Route param `routeFocalPageId` if provided.
 *   2. Last-focused page for this agent from AsyncStorage.
 *   3. Most recently compiled Entity for this agent (via
 *      `useRecentWikiPages` — falls back to most recent page of any
 *      type if none of the recent pages are Entities).
 *
 * The PRD's priority-2 ("highest-inbound Entity") was dropped from v1
 * because it requires either a denormalized inbound-link-count column
 * or a `GROUP BY to_page_id` resolver that doesn't yet exist.
 */
export function useFocusMode({
  agentId,
  routeFocalPageId,
}: UseFocusModeArgs) {
  const [focalPageId, setFocalPageId] = useState<string | null>(
    routeFocalPageId ?? null,
  );
  const [depth, setDepthState] = useState(1);
  const [storageChecked, setStorageChecked] = useState(false);

  const { results: recentPages } = useRecentWikiPages({
    agentId,
    limit: FALLBACK_LIMIT,
  });

  // Try AsyncStorage first.
  useEffect(() => {
    if (routeFocalPageId) {
      setFocalPageId(routeFocalPageId);
      setStorageChecked(true);
      return;
    }
    if (!agentId) return;
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(`${STORAGE_PREFIX}${agentId}`);
        if (cancelled) return;
        if (stored) setFocalPageId(stored);
      } finally {
        if (!cancelled) setStorageChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, routeFocalPageId]);

  // Apply the recent-Entity fallback when storage didn't resolve.
  useEffect(() => {
    if (!storageChecked || focalPageId || routeFocalPageId) return;
    const entity = recentPages.find((p) => p.type === "ENTITY");
    const fallback = entity ?? recentPages[0];
    if (fallback?.id) setFocalPageId(fallback.id);
  }, [storageChecked, focalPageId, routeFocalPageId, recentPages]);

  const setFocus = useCallback(
    (pageId: string) => {
      setFocalPageId(pageId);
      if (agentId) {
        AsyncStorage.setItem(`${STORAGE_PREFIX}${agentId}`, pageId).catch(
          () => {},
        );
      }
    },
    [agentId],
  );

  const setDepth = useCallback((next: number) => {
    setDepthState(Math.max(0, Math.min(MAX_DEPTH, next)));
  }, []);

  return { focalPageId, depth, setFocus, setDepth };
}
