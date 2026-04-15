/**
 * Compact activity-log renderer for the `activity_list` TaskBlock.
 *
 * Renders webhook-driven audit rows that arrived via the ingest pipeline and
 * were persisted into the `messages` table as system rows with
 * `metadata.kind = "external_task_event"`.
 *
 * Rows are pre-filtered on the task detail screen and passed down through
 * `GenUIContext.activityRows`, so this block does NOT fetch anything — it
 * just renders the list we were handed. If the list is empty the block
 * returns null (no "empty state" — the section simply doesn't appear).
 *
 * This is deliberately separate from ActivityTimeline, which is the agent
 * chat timeline. System audit rows do not belong in the chat history.
 */

import React from 'react';
import { View } from 'react-native';
import { History } from 'lucide-react-native';
import { Muted, Text } from '@/components/ui/typography';

export type ActivityRow = {
  id: string;
  content: string;
  createdAt: string;
};

/** Relative time formatter — mirrors ActivityTimeline's short form. */
function formatRelativeTime(dateStr: string): string {
  try {
    const then = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - then.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function ActivityList({
  rows,
  title,
  limit,
}: {
  rows: ActivityRow[];
  title?: string;
  limit?: number;
}) {
  if (!rows || rows.length === 0) return null;

  const cap = typeof limit === 'number' && limit > 0 ? limit : 10;
  // Newest first — PR A inserts in chronological order, so reverse to get desc.
  const sorted = [...rows].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    return tb - ta;
  });
  const visible = sorted.slice(0, cap);

  return (
    <View className="px-4 py-3 border-t border-neutral-100 dark:border-neutral-700">
      {title ? (
        <Text
          size="xs"
          weight="medium"
          variant="muted"
          className="uppercase tracking-wider mb-2"
        >
          {title}
        </Text>
      ) : null}
      <View className="gap-2">
        {visible.map((row) => (
          <View key={row.id} className="flex-row items-start gap-2">
            <View className="pt-0.5">
              <History size={12} color="#9ca3af" />
            </View>
            <View className="flex-1 flex-row items-start justify-between gap-2">
              <Text size="xs" variant="muted" className="flex-1" numberOfLines={3}>
                {row.content}
              </Text>
              <Muted className="text-[10px] shrink-0">
                {formatRelativeTime(row.createdAt)}
              </Muted>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
