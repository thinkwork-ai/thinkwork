import React from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/typography';
import type { NormalizedTask, TaskFieldSpec } from '../types';

function renderValue(field: TaskFieldSpec, item: NormalizedTask): string {
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
  if (field.type === 'user') {
    // The assignee field's raw value is a provider-opaque user id. The
    // normalizer already resolved a human-readable `core.assignee.name`
    // (e.g. "Eric Odom" from `first_name`+`last_name`, or email fallback)
    // — prefer that so the card doesn't dump a raw id string on the user.
    const key = field.key.toLowerCase();
    if (key === 'assignee' || key === 'owner') {
      const name = item.core.assignee?.name;
      if (name && name !== String(field.value)) return name;
      return item.core.assignee?.email ?? String(field.value);
    }
    return String(field.value);
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
  // `columns` is retained on the block type for backwards compat with the
  // adapter signature, but the mobile renderer now always uses a single-column
  // definition-list layout (label left, value right). See PR feat/external-
  // task-card-ui-cleanup for the rationale.
  columns: _columns,
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
      <View className="gap-y-2">
        {visible.map((f) => (
          <View key={f.key} className="flex-row items-baseline">
            <Text
              size="xs"
              weight="medium"
              variant="muted"
              className="uppercase tracking-wide w-24"
            >
              {f.label}
            </Text>
            <Text size="sm" className="flex-1 dark:text-neutral-200">
              {renderValue(f, item)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
