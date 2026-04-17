import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useMutation } from 'urql';
import { Text } from '@/components/ui/typography';
import ExternalTaskCard from '@/components/genui/external-task/ExternalTaskCard';
import type { ExternalTaskEnvelope } from '@/components/genui/external-task/types';
import { ExecuteExternalTaskActionMutation } from '@/lib/graphql-queries';
import { buildExecuteExternalTaskActionVariables } from '@/lib/external-task-action';

/**
 * Pinned header for threads linked to an external task.
 *
 * Rendering model (B-first with A fallback):
 * - Preferred: fire `external_task.refresh` on mount to pull fresh envelope
 *   from the provider (MCP live-fetch). Render that.
 * - Fallback: if refresh is in-flight, blocked (missing connectionId/provider
 *   metadata on old rows), or fails, render the cached `latestEnvelope` from
 *   `thread.metadata.external`. If neither is present, show a loading or
 *   error placeholder.
 *
 * This decouples the mode-flip (thread → task card) from the cache, so a
 * freshly-stamped task with only an externalTaskId in metadata still renders
 * a card view immediately — it just resolves to live data instead of stale.
 */
export function PinnedExternalTaskHeader({
  threadMetadata,
  threadId,
  tenantId,
  currentUserId,
  messageId,
  activityRows,
  editRequestCounter,
}: {
  threadMetadata: unknown;
  threadId: string;
  tenantId: string;
  currentUserId?: string;
  messageId?: string;
  /**
   * Webhook-driven audit rows derived from the raw messages query in the
   * task detail screen (role=system + metadata.kind="external_task_event").
   * Passed through to ExternalTaskCard's `activity_list` block renderer.
   */
  activityRows?: Array<{ id: string; content: string; createdAt: string }>;
  /**
   * Monotonic counter from the task detail page's "Edit Task" dropdown.
   * When it increments the card opens its edit sheet.
   */
  editRequestCounter?: number;
}) {
  const meta = (threadMetadata ?? {}) as Record<string, unknown>;
  const external = (meta.external ?? undefined) as
    | {
        externalTaskId?: string;
        connectionId?: string;
        latestEnvelope?: ExternalTaskEnvelope;
      }
    | undefined;

  const externalTaskId = external?.externalTaskId;
  const cachedEnvelope = external?.latestEnvelope;
  const canRefresh = Boolean(external?.connectionId && externalTaskId);

  const [liveEnvelope, setLiveEnvelope] = useState<ExternalTaskEnvelope | null>(null);
  // Start in "loading" if we're about to fire a refresh AND we have no
  // cached envelope to render immediately. This avoids the empty-placeholder
  // flicker ("External task not yet synced" → "Loading…" → result) on cold
  // mounts, which looked like an error state even when everything was OK.
  const [refreshing, setRefreshing] = useState<boolean>(canRefresh && !cachedEnvelope);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const firedRef = useRef(false);
  const [, executeExternalTaskAction] = useMutation(ExecuteExternalTaskActionMutation);

  useEffect(() => {
    // One-shot refresh on mount. Suppressed if we have no route to MCP
    // (legacy rows missing connectionId) — cached envelope is the only
    // option there. Also suppressed if we already fired.
    if (firedRef.current) return;
    if (!canRefresh || !threadId) return;
    firedRef.current = true;
    setRefreshError(null);
    const vars = buildExecuteExternalTaskActionVariables({
      threadId,
      actionType: 'external_task.refresh',
      params: {},
    });
    void executeExternalTaskAction(vars).then((result) => {
      setRefreshing(false);
      if (result.error) {
        setRefreshError(result.error.message || 'Refresh failed');
        return;
      }
      const payload = result.data?.executeExternalTaskAction?.envelope;
      if (!payload) return;
      try {
        const parsed =
          typeof payload === 'string'
            ? (JSON.parse(payload) as ExternalTaskEnvelope)
            : (payload as unknown as ExternalTaskEnvelope);
        setLiveEnvelope(parsed);
      } catch {
        // Malformed envelope — fall back to cached.
      }
    });
  }, [canRefresh, threadId, executeExternalTaskAction]);

  // Preference order: live (B) → cached (A).
  const envelope = liveEnvelope ?? cachedEnvelope;

  if (!envelope) {
    // While the live MCP fetch is in flight, stay out of the layout —
    // the thread body already has a monospace ShimmerText loading
    // indicator, and a second placeholder at the top double-decks the
    // loading UI. Errors and the never-synced-yet state still render
    // since those are terminal signals the user needs to see.
    if (refreshing) return null;
    return (
      <View className="px-4 py-3 mx-3 mt-2 mb-1 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 flex-row items-center gap-2">
        {refreshError ? (
          <Text size="xs" variant="muted">
            {refreshError}
          </Text>
        ) : (
          <Text size="xs" variant="muted">
            External task not yet synced
          </Text>
        )}
      </View>
    );
  }

  return (
    <View className="px-3 pt-2 pb-1">
      <ExternalTaskCard
        data={envelope as unknown as Record<string, unknown>}
        context={{
          threadId,
          tenantId,
          messageId: messageId ?? `pinned-${threadId}`,
          toolIndex: 0,
          currentUserId,
          activityRows,
          hideEditButton: true,
          editRequestCounter,
        }}
      />
    </View>
  );
}
