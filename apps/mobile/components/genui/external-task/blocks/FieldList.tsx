import React from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/typography';
import type { NormalizedTask, TaskFieldSpec } from '../types';

function renderValue(field: TaskFieldSpec): string {
  if (field.value == null) return '—';
  if (field.type === 'date') {
    const s = String(field.value);
    try {
      return new Date(s).toLocaleDateString();
    } catch {
      return s;
    }
  }
  if (field.type === 'select') {
    const opt = field.options?.find((o) => o.value === field.value);
    return opt?.label ?? String(field.value);
  }
  if (field.type === 'chips' && Array.isArray(field.value)) {
    return (field.value as unknown[]).join(', ');
  }
  if (typeof field.value === 'object') return JSON.stringify(field.value);
  return String(field.value);
}

export function FieldList({
  item,
  fieldKeys,
  columns = 2,
  title,
}: {
  item: NormalizedTask;
  fieldKeys: string[];
  columns?: 1 | 2;
  title?: string;
}) {
  const byKey = new Map(item.fields.map((f) => [f.key, f]));
  const visible = fieldKeys
    .map((k) => byKey.get(k))
    .filter((f): f is TaskFieldSpec => Boolean(f));

  if (visible.length === 0) return null;

  return (
    <View className="px-4 py-3 border-t border-neutral-100 dark:border-neutral-700">
      {title ? (
        <Text size="xs" weight="medium" variant="muted" className="uppercase tracking-wider mb-2">
          {title}
        </Text>
      ) : null}
      <View className={`flex-row flex-wrap ${columns === 2 ? 'gap-y-3' : 'gap-y-2'}`}>
        {visible.map((f) => (
          <View
            key={f.key}
            className={columns === 2 ? 'w-1/2 pr-3' : 'w-full'}
          >
            <Text size="xs" weight="medium" variant="muted" className="uppercase tracking-wide">
              {f.label}
            </Text>
            <Text size="sm" className="mt-0.5 dark:text-neutral-200">
              {renderValue(f)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
