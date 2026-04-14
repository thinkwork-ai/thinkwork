import React from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/typography';
import type { NormalizedTask } from '../types';

export function TaskHeader({
  item,
  showSource,
  showUpdatedAt,
}: {
  item: NormalizedTask;
  showSource?: boolean;
  showUpdatedAt?: boolean;
}) {
  const providerLabel =
    item.core.provider === 'lastmile'
      ? 'LastMile Tasks'
      : item.core.provider;

  return (
    <View className="px-4 pt-4 pb-3">
      <Text size="lg" weight="bold" className="dark:text-white">
        {item.core.title}
      </Text>
      {item.core.description ? (
        <Text size="sm" variant="muted" className="mt-1">
          {item.core.description}
        </Text>
      ) : null}
      <View className="flex-row items-center gap-3 mt-2">
        {showSource ? (
          <Text size="xs" variant="muted" className="uppercase tracking-wider">
            {providerLabel}
          </Text>
        ) : null}
        {showUpdatedAt && item.core.updatedAt ? (
          <Text size="xs" variant="muted">
            Updated {new Date(item.core.updatedAt).toLocaleString()}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
