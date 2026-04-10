import { View } from "react-native";
import { Text, Muted } from "@/components/ui/typography";

interface AuditEntry {
  _id: string;
  eventType: string;
  toolName?: string;
  durationMs?: number;
  status: string;
  timestamp: number;
}

interface AuditLogTableProps {
  entries: AuditEntry[];
}

export function AuditLogTable({ entries }: AuditLogTableProps) {
  const statusColor = (status: string) => {
    if (status === "success") return "text-green-600 dark:text-green-400";
    if (status === "error" || status === "denied")
      return "text-red-600 dark:text-red-400";
    return "text-amber-600 dark:text-amber-400";
  };

  return (
    <View className="gap-2 pb-8">
      {entries.map((entry) => (
        <View
          key={entry._id}
          className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-medium">{entry.eventType}</Text>
            <Text className={`text-xs font-medium ${statusColor(entry.status)}`}>
              {entry.status}
            </Text>
          </View>
          <View className="mt-1 flex-row items-center gap-3">
            {entry.toolName && (
              <Muted className="text-xs">tool: {entry.toolName}</Muted>
            )}
            {entry.durationMs !== undefined && (
              <Muted className="text-xs">{entry.durationMs}ms</Muted>
            )}
            <Muted className="ml-auto text-xs">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </Muted>
          </View>
        </View>
      ))}
    </View>
  );
}
