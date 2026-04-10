import React from 'react';
import { View, Pressable } from 'react-native';
import { Text } from '@/components/ui/typography';
import { ChevronRight } from 'lucide-react-native';
import type { GenUIProps } from '@/lib/genui-registry';
import { StageBadge, PriorityBadge, personName, Pager, usePager } from './crm-utils';

interface TaskItem {
  id: string;
  taskNumber: number;
  title: string;
  priority: string;
  status: { name: string; color: string };
  assignee: { firstName: string; lastName: string };
  team: { name: string };
  dueDate: string;
}

function TaskList({ data }: GenUIProps) {
  const items = (data.items as unknown as TaskItem[]) || [];
  const pager = usePager();
  const slice = pager.slice(items);

  return (
    <View className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 overflow-hidden">
      <View className="px-4 py-2 bg-purple-50 dark:bg-purple-900/20">
        <Text size="xs" weight="medium" className="text-purple-700 dark:text-purple-300 uppercase tracking-wider">
          Tasks
        </Text>
      </View>
      {slice.map((item, i) => (
        <Pressable
          key={item.id || i}
          onPress={() => {}}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          className="flex-row items-start py-3 px-4 border-b border-neutral-100 dark:border-neutral-700/50"
        >
          <View className="flex-1 mr-3">
            <Text size="sm" weight="medium" className="dark:text-white" numberOfLines={1}>
              #{item.taskNumber} {item.title}
            </Text>
            <View className="flex-row items-center gap-2 mt-0.5">
              <StageBadge name={item.status?.name} color={item.status?.color} />
              <PriorityBadge priority={item.priority} />
            </View>
          </View>
          <ChevronRight size={16} color="#9ca3af" style={{ marginTop: 4 }} />
        </Pressable>
      ))}
      {items.length === 0 && (
        <View className="px-4 py-6 items-center">
          <Text size="sm" variant="muted">No tasks found</Text>
        </View>
      )}
      <Pager page={pager.page} total={items.length} onPrev={pager.prev} onNext={pager.next} />
    </View>
  );
}

export default TaskList;
