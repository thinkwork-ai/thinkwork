import { useState } from "react";
import { View, Pressable, Platform } from "react-native";
import { CheckCircle, XCircle, Clock, Play, Flag, ChevronRight, ChevronDown } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { Text, Muted } from "@/components/ui/typography";

export type TimelineNodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";

const WEB_WRAP_STYLE = Platform.OS === "web" ? ({ wordBreak: "break-word" } as any) : undefined;

export function TimelineNode({
  status,
  name,
  duration,
  time,
  output,
  error,
  isFirst,
  isLast,
  isSynthetic,
  collapsible,
  onFixError,
}: {
  status: TimelineNodeStatus;
  name: string;
  duration?: string;
  time?: string;
  output?: unknown;
  error?: string;
  isFirst?: boolean;
  isLast?: boolean;
  isSynthetic?: boolean;
  collapsible?: boolean;
  onFixError?: (error: string) => void;
}) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const [expanded, setExpanded] = useState(false);

  const lineColor = colorScheme === "dark" ? "#404040" : "#d4d4d4";

  const statusColor =
    status === "completed"
      ? "#22c55e"
      : status === "failed"
      ? "#ef4444"
      : status === "running"
      ? "#f59e0b"
      : colors.mutedForeground;

  const StatusIconComponent =
    status === "completed"
      ? CheckCircle
      : status === "failed"
      ? XCircle
      : status === "running"
      ? Clock
      : Clock;

  const hasContent = (output !== undefined && output !== null) || !!error;
  const iconNudgeStyle = isSynthetic && isFirst
    ? { marginTop: 5 }
    : { marginTop: 2.5 };
  const topConnectorHeight = isFirst ? 0 : 2;

  const header = (
    <View className="flex-1 min-w-0 flex-row items-start gap-2">
      <Text
        weight={isSynthetic ? "semibold" : "medium"}
        className={`flex-1 min-w-0 text-base ${
          isSynthetic
            ? "text-neutral-500 dark:text-neutral-400"
            : "text-neutral-900 dark:text-neutral-100"
        }`}
        style={WEB_WRAP_STYLE}
      >
        {name}
      </Text>
      {duration && (
        <View className="bg-neutral-200 dark:bg-neutral-700 rounded-full px-2 py-0.5 ml-auto self-start">
          <Text className="text-xs text-neutral-600 dark:text-neutral-300 font-medium">
            {duration}
          </Text>
        </View>
      )}
      {collapsible && hasContent && (
        <View className="self-start pt-2">
          {expanded
            ? <ChevronDown size={14} color={colors.mutedForeground} />
            : <ChevronRight size={14} color={colors.mutedForeground} />}
        </View>
      )}
    </View>
  );

  return (
    <View className="flex-row">
      <View className="items-center" style={{ width: 18 }}>
        {!isFirst && <View className="w-0.5" style={{ height: topConnectorHeight, backgroundColor: lineColor }} />}
        <View className="justify-start" style={{ minHeight: 18 }}>
          {isSynthetic && isFirst ? (
            <Play size={16} color={statusColor} style={iconNudgeStyle} />
          ) : isSynthetic && isLast ? (
            <Flag size={16} color={statusColor} style={iconNudgeStyle} />
          ) : (
            <StatusIconComponent size={16} color={statusColor} style={iconNudgeStyle} />
          )}
        </View>
        {!isLast && <View className="w-0.5 flex-1" style={{ backgroundColor: lineColor }} />}
      </View>

      <View className="ml-2 flex-1 min-w-0 pb-3">
        {collapsible && hasContent ? (
          <Pressable onPress={() => setExpanded(!expanded)} className="flex-1 min-w-0">
            {header}
          </Pressable>
        ) : (
          header
        )}

        {time && <Muted className="text-xs mt-0.5">{time}</Muted>}

        {(expanded || !collapsible) && error && (
          <View className="bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 mt-2">
            <Text className="text-sm text-red-600 dark:text-red-400" style={WEB_WRAP_STYLE}>{error}</Text>
          </View>
        )}

        {(expanded || !collapsible) && error && onFixError && (
          <Pressable
            onPress={() => onFixError(error)}
            className="flex-row items-center gap-1.5 mt-2"
          >
            <Play size={14} color="#0ea5e9" />
            <Text className="text-sm font-semibold" style={{ color: "#0ea5e9" }}>
              Fix in Builder
            </Text>
          </Pressable>
        )}

        {(expanded || !collapsible) && output !== undefined && output !== null && (
          <View className="bg-neutral-100 dark:bg-neutral-800 rounded-lg px-3 py-2 mt-2">
            <Text className="text-xs text-neutral-600 dark:text-neutral-400 font-mono" style={WEB_WRAP_STYLE}>
              {typeof output === "string" ? output : JSON.stringify(output, null, 2)}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
