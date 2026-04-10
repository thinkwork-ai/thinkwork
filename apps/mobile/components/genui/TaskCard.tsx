import React from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/typography';
import type { GenUIProps } from '@/lib/genui-registry';
import { StageBadge, PriorityBadge, personName } from './crm-utils';
import { Calendar, User, Users, Workflow, Tag } from 'lucide-react-native';

function TaskCard({ data }: GenUIProps) {
  const taskNumber = data.taskNumber as number | undefined;
  const title = String(data.title || '');
  const description = String(data.description || '');
  const priority = String(data.priority || '');
  const dueDate = String(data.dueDate || '');
  const status = data.status as { name: string; color: string } | undefined;
  const workflow = data.workflow as { name: string } | undefined;
  const assignee = data.assignee as { firstName: string; lastName: string; email: string } | undefined;
  const team = data.team as { name: string } | undefined;
  const taskType = data.taskType as { name: string } | undefined;
  const labels = (data.labels as Array<{ name: string; color: string }>) || [];

  const heading = taskNumber ? `#${taskNumber} ${title}` : title;

  return (
    <View className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 overflow-hidden">
      {/* Header */}
      <View className="px-4 pt-4 pb-3">
        <Text size="lg" weight="bold" className="dark:text-white">{heading}</Text>
      </View>

      {/* Status / Priority / Workflow */}
      <View className="px-4 py-3 border-t border-neutral-100 dark:border-neutral-700 flex-row items-center gap-2 flex-wrap">
        <StageBadge name={status?.name} color={status?.color} />
        <PriorityBadge priority={priority || undefined} />
        {workflow?.name && (
          <View className="flex-row items-center gap-1">
            <Workflow size={12} color="#9ca3af" />
            <Text size="xs" variant="muted">{workflow.name}</Text>
          </View>
        )}
      </View>

      {/* Due date / Task type */}
      {(dueDate || taskType?.name) && (
        <View className="px-4 py-3 border-t border-neutral-100 dark:border-neutral-700 flex-row items-center gap-4">
          {dueDate && (
            <View className="flex-row items-center gap-1">
              <Calendar size={12} color="#9ca3af" />
              <Text size="xs" variant="muted">{dueDate}</Text>
            </View>
          )}
          {taskType?.name && (
            <View className="flex-row items-center gap-1">
              <Tag size={12} color="#9ca3af" />
              <Text size="xs" variant="muted">{taskType.name}</Text>
            </View>
          )}
        </View>
      )}

      {/* Assignee / Team */}
      <View className="px-4 py-3 border-t border-neutral-100 dark:border-neutral-700 gap-2">
        {assignee && (
          <View className="flex-row items-center gap-2">
            <User size={12} color="#9ca3af" />
            <Text size="sm" className="dark:text-neutral-200">{personName(assignee)}</Text>
          </View>
        )}
        {team?.name && (
          <View className="flex-row items-center gap-2">
            <Users size={12} color="#9ca3af" />
            <Text size="sm" className="dark:text-neutral-200">{team.name}</Text>
          </View>
        )}
      </View>

      {/* Labels */}
      {labels.length > 0 && (
        <View className="px-4 py-3 border-t border-neutral-100 dark:border-neutral-700 flex-row flex-wrap gap-1">
          {labels.map((label, i) => (
            <View
              key={i}
              className="px-2 py-0.5 rounded-full"
              style={{ backgroundColor: label.color ? `${label.color}20` : 'rgba(156,163,175,0.15)' }}
            >
              <Text size="xs" weight="medium" style={{ color: label.color || '#9ca3af' }}>{label.name}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Description */}
      {description && (
        <View className="px-4 py-3 border-t border-neutral-100 dark:border-neutral-700">
          <Text size="xs" weight="medium" variant="muted" className="uppercase tracking-wider mb-1">Description</Text>
          <Text size="sm" className="dark:text-neutral-200">{description}</Text>
        </View>
      )}
    </View>
  );
}

export default TaskCard;
