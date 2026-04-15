import React from 'react';
import { Pressable, View } from 'react-native';
import { Pencil } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { Text } from '@/components/ui/typography';
import { COLORS } from '@/lib/theme';
import type { NormalizedTask } from '../types';

export function TaskHeader({
  item,
  showSource,
  showUpdatedAt,
  onEditPress,
}: {
  item: NormalizedTask;
  showSource?: boolean;
  showUpdatedAt?: boolean;
  onEditPress?: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const colors = isDark ? COLORS.dark : COLORS.light;

  const providerLabel =
    item.core.provider === 'lastmile'
      ? 'LastMile Tasks'
      : item.core.provider;

  // Only expose the pencil if the task advertises an edit_fields action; that
  // keeps the button from showing up on envelopes from providers that haven't
  // wired the edit form yet.
  const hasEditAction = item.actions.some(
    (a) => a.type === 'external_task.edit_fields',
  );
  const showEdit = hasEditAction && !!onEditPress;

  return (
    <View className="px-4 pt-4 pb-3 flex-row items-start">
      <View className="flex-1 min-w-0 pr-3">
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
      {showEdit ? (
        <Pressable
          onPress={onEditPress}
          accessibilityLabel="Edit task"
          accessibilityRole="button"
          hitSlop={8}
          className="p-2 -mr-1 rounded-lg active:opacity-60"
        >
          <Pencil size={18} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );
}
