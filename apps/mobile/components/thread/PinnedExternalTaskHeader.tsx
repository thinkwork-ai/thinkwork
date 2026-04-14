import React from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/typography';
import ExternalTaskCard from '@/components/genui/external-task/ExternalTaskCard';
import type { ExternalTaskEnvelope } from '@/components/genui/external-task/types';

/**
 * Pinned header for threads linked to an external task.
 *
 * Reads `thread.metadata.external.latestEnvelope` and renders it via
 * `ExternalTaskCard`, which owns the action/form submission. This is the
 * canonical task surface — the same card may also appear inline in the
 * timeline from `messages.tool_results[i]`, but this is the always-current
 * copy.
 */
export function PinnedExternalTaskHeader({
  threadMetadata,
  threadId,
  tenantId,
  currentUserId,
  messageId,
}: {
  threadMetadata: unknown;
  threadId: string;
  tenantId: string;
  currentUserId?: string;
  messageId?: string;
}) {
  const meta = (threadMetadata ?? {}) as Record<string, unknown>;
  const external = (meta.external ?? undefined) as
    | { latestEnvelope?: ExternalTaskEnvelope }
    | undefined;
  const envelope = external?.latestEnvelope;

  if (!envelope) {
    return (
      <View className="px-4 py-3 mx-3 mt-2 mb-1 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900">
        <Text size="xs" variant="muted">
          External task not yet synced
        </Text>
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
        }}
      />
    </View>
  );
}
