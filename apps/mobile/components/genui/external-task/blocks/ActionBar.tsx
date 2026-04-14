import React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/typography';
import type { NormalizedTask, TaskActionSpec } from '../types';

type ActionBarProps = {
  item: NormalizedTask;
  actionIds: string[];
  disabled?: boolean;
  onActionPress: (action: TaskActionSpec) => void;
};

function variantClass(variant: TaskActionSpec['variant']): string {
  switch (variant) {
    case 'primary':
      return 'bg-primary dark:bg-primary-dark';
    case 'danger':
      return 'bg-red-600';
    case 'ghost':
      return 'bg-transparent border border-neutral-200 dark:border-neutral-700';
    case 'secondary':
    default:
      return 'bg-neutral-100 dark:bg-neutral-700';
  }
}

function textClass(variant: TaskActionSpec['variant']): string {
  return variant === 'primary' || variant === 'danger'
    ? 'text-white'
    : 'text-neutral-900 dark:text-neutral-100';
}

export function ActionBar({ item, actionIds, disabled, onActionPress }: ActionBarProps) {
  const byId = new Map(item.actions.map((a) => [a.id, a]));
  const visible = actionIds
    .map((id) => byId.get(id))
    .filter((a): a is TaskActionSpec => Boolean(a));

  if (visible.length === 0) return null;

  return (
    <View className="px-4 py-3 border-t border-neutral-100 dark:border-neutral-700 flex-row flex-wrap gap-2">
      {visible.map((a) => (
        <Pressable
          key={a.id}
          onPress={disabled ? undefined : () => onActionPress(a)}
          disabled={disabled}
          className={`px-3 py-2 rounded-lg ${variantClass(a.variant)}`}
          style={{ opacity: disabled ? 0.6 : 1 }}
        >
          <Text size="sm" weight="medium" className={textClass(a.variant)}>
            {a.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
