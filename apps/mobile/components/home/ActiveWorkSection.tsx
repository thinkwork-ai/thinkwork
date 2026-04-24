import { View, Pressable } from "react-native";
import { useColorScheme } from "nativewind";
import { ChevronRight } from "lucide-react-native";
import { Text, Muted } from "@/components/ui/typography";
import { Badge } from "@/components/ui/badge";
import { COLORS } from "@/lib/theme";

interface ThreadRow {
  id: string;
  identifier?: string | null;
  title: string;
  lifecycleStatus?: string | null;
  channel?: string;
  agentId?: string;
  updatedAt: string;
}

// ThreadLifecycleStatus → operator-facing label. Mirrors admin's
// ThreadLifecycleBadge.
const LIFECYCLE_LABELS: Record<string, string> = {
  RUNNING: "Running",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
  IDLE: "Idle",
  AWAITING_USER: "Awaiting user",
};

function lifecycleVariant(status: string | null | undefined): "default" | "secondary" | "destructive" | "outline" {
  if (!status) return "outline";
  switch (status) {
    case "RUNNING": return "secondary";
    case "FAILED": return "destructive";
    case "COMPLETED":
    case "CANCELLED":
    case "IDLE":
    case "AWAITING_USER":
    default: return "outline";
  }
}

interface ActiveWorkSectionProps {
  threads: ThreadRow[];
  onThreadPress: (thread: ThreadRow) => void;
  onViewAll: () => void;
  agentNames?: Record<string, string>;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ActiveWorkSection({ threads, onThreadPress, onViewAll, agentNames }: ActiveWorkSectionProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const display = threads.slice(0, 5);

  return (
    <View className="mt-6 px-4">
      {/* Header */}
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center gap-2">
          <Text className="text-base font-semibold">Active</Text>
          {threads.length > 0 && (
            <View className="bg-neutral-200 dark:bg-neutral-800 rounded-full px-2 py-0.5 min-w-[22px] items-center">
              <Text className="text-xs font-medium">{threads.length}</Text>
            </View>
          )}
        </View>
        {threads.length > 5 && (
          <Pressable onPress={onViewAll} className="active:opacity-70">
            <Text className="text-sm text-primary">View All</Text>
          </Pressable>
        )}
      </View>

      {/* Thread list */}
      {display.length === 0 ? (
        <View className="items-center py-6">
          <Muted className="text-sm">No active threads</Muted>
        </View>
      ) : (
        <View className="gap-1">
          {display.map((thread) => (
            <Pressable
              key={thread.id}
              onPress={() => onThreadPress(thread)}
              className="flex-row items-center gap-3 py-3 px-3 rounded-lg active:bg-neutral-100 dark:active:bg-neutral-900"
            >
              {/* Prefix + title */}
              <View className="flex-1 gap-0.5">
                <View className="flex-row items-center gap-2">
                  {thread.identifier && (
                    <Text className="text-xs font-mono text-primary">
                      {thread.identifier}
                    </Text>
                  )}
                  <Badge variant={lifecycleVariant(thread.lifecycleStatus)}>
                    <Text className="text-[10px]">
                      {thread.lifecycleStatus
                        ? (LIFECYCLE_LABELS[thread.lifecycleStatus] ?? "Idle")
                        : "—"}
                    </Text>
                  </Badge>
                </View>
                <Text className="text-sm" numberOfLines={1}>
                  {thread.title || "Untitled"}
                </Text>
                {thread.agentId && agentNames?.[thread.agentId] && (
                  <Muted className="text-xs">{agentNames[thread.agentId]}</Muted>
                )}
              </View>

              {/* Time + chevron */}
              <View className="flex-row items-center gap-1">
                <Muted className="text-xs">{formatRelativeTime(thread.updatedAt)}</Muted>
                <ChevronRight size={14} color={colors.mutedForeground} />
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
