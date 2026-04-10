import React from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ui/typography';
import { MarkdownMessage } from './MarkdownMessage';
import { FileText, BarChart3, Notebook, ClipboardList, PenLine, Mail } from 'lucide-react-native';

const TYPE_CONFIG: Record<string, { label: string; Icon: typeof FileText }> = {
  report: { label: 'Report', Icon: BarChart3 },
  data_view: { label: 'Data View', Icon: BarChart3 },
  note: { label: 'Note', Icon: Notebook },
  plan: { label: 'Plan', Icon: ClipboardList },
  draft: { label: 'Draft', Icon: PenLine },
  digest: { label: 'Digest', Icon: Mail },
};

interface ArtifactCardProps {
  title: string;
  type?: string;
  content: string;
  status?: string;
}

export function ArtifactCard({ title, type, content, status }: ArtifactCardProps) {
  const config = TYPE_CONFIG[type ?? ''] ?? { label: type ?? 'Artifact', Icon: FileText };
  const { label, Icon } = config;

  return (
    <View className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
      <View className="flex-row items-center gap-2 px-3 py-2 bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
        <Icon size={14} className="text-neutral-500 dark:text-neutral-400" />
        <Text className="text-sm font-medium text-neutral-900 dark:text-neutral-100 flex-1" numberOfLines={1}>
          {title}
        </Text>
        <View className="bg-neutral-200 dark:bg-neutral-700 rounded px-1.5 py-0.5">
          <Text className="text-xs text-neutral-600 dark:text-neutral-300">
            {label}
          </Text>
        </View>
        {status === 'draft' && (
          <View className="bg-amber-100 dark:bg-amber-900/30 rounded px-1.5 py-0.5">
            <Text className="text-xs text-amber-700 dark:text-amber-400">
              Draft
            </Text>
          </View>
        )}
      </View>
      <View className="px-3 py-2">
        <MarkdownMessage content={content} isUser={false} />
      </View>
    </View>
  );
}
