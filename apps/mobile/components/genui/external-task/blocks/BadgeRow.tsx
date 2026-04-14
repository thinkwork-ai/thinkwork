import React from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/typography';
import type { NormalizedTask } from '../types';

export function BadgeRow({
  item,
  fieldKeys,
}: {
  item: NormalizedTask;
  fieldKeys: string[];
}) {
  const byKey = new Map(item.fields.map((f) => [f.key, f]));
  const chips: string[] = [];

  for (const key of fieldKeys) {
    const field = byKey.get(key);
    if (!field?.value) continue;
    if (Array.isArray(field.value)) {
      for (const v of field.value as unknown[]) {
        if (v) chips.push(String(v));
      }
    } else {
      chips.push(String(field.value));
    }
  }

  if (chips.length === 0) return null;

  return (
    <View className="px-4 py-3 border-t border-neutral-100 dark:border-neutral-700 flex-row flex-wrap gap-1">
      {chips.map((chip, i) => (
        <View
          key={`${chip}-${i}`}
          className="px-2 py-0.5 rounded-full"
          style={{ backgroundColor: 'rgba(156,163,175,0.15)' }}
        >
          <Text size="xs" weight="medium" className="text-neutral-500 dark:text-neutral-300">
            {chip}
          </Text>
        </View>
      ))}
    </View>
  );
}
