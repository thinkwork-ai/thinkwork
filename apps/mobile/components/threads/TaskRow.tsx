import { View, Pressable } from "react-native";
import { useColorScheme } from "nativewind";
import { ChevronRight, Check, CheckSquare, ListChecks, AlertCircle, Clock } from "lucide-react-native";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";

interface TaskRowProps {
  task: {
    id: string;
    identifier?: string | null;
    title: string;
    description?: string | null;
    status: string;
    childCount?: number;
    dueAt?: string | null;
    assignee?: { name?: string | null } | null;
  };
  onPress: () => void;
  hideAssignee?: boolean;
}

const STATUS_ICON_COLORS: Record<string, { bg: string; fg: string }> = {
  TODO:        { bg: "rgba(167,139,250,0.15)", fg: "#a78bfa" },
  IN_PROGRESS: { bg: "rgba(96,165,250,0.15)",  fg: "#60a5fa" },
  BLOCKED:     { bg: "rgba(248,113,113,0.15)", fg: "#f87171" },
  DONE:        { bg: "rgba(74,222,128,0.15)",  fg: "#4ade80" },
  CANCELLED:   { bg: "rgba(163,163,163,0.15)", fg: "#a3a3a3" },
};

const PARENT_ICON = { bg: "rgba(20,184,166,0.15)", fg: "#14b8a6" };

export function TaskRow({ task, onPress, hideAssignee }: TaskRowProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;

  const statusUpper = (task.status || "").toUpperCase();
  const isDone = statusUpper === "DONE";
  const isParent = (task.childCount ?? 0) > 0;

  const iconColors = isParent ? PARENT_ICON : (STATUS_ICON_COLORS[statusUpper] || STATUS_ICON_COLORS.TODO);
  const IconComponent = isParent ? ListChecks : (isDone ? Check : CheckSquare);

  const due = task.dueAt ? new Date(task.dueAt) : null;
  const isOverdue = due && due < new Date() && !isDone;

  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-start py-2 pr-4 active:bg-neutral-50 dark:active:bg-neutral-900"
      style={{ backgroundColor: colors.background }}
    >
      {/* Dot + icon — matches ThreadRow layout */}
      <View style={{ flexDirection: "row", alignItems: "center", width: 56 }}>
        <View style={{ width: 16 }} />
        <View
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: iconColors.bg, borderWidth: 0.25, borderColor: iconColors.fg, alignItems: "center", justifyContent: "center" }}
        >
          <IconComponent size={20} color={iconColors.fg} />
        </View>
      </View>

      {/* Content */}
      <View className="flex-1 ml-3">
        {/* Line 1: identifier + assignee + due date + chevron */}
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2 flex-1 mr-2">
            {task.identifier && (
              <Text className="text-xs font-mono text-primary" style={{ lineHeight: 14 }}>
                {task.identifier}
              </Text>
            )}
            {!hideAssignee && (
              <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: task.assignee?.name ? (isDark ? "rgba(96,165,250,0.15)" : "rgba(37,99,235,0.1)") : (isDark ? "rgba(163,163,163,0.15)" : "rgba(115,115,115,0.1)") }}>
                <Text style={{ fontSize: 10, fontWeight: "600", color: task.assignee?.name ? (isDark ? "#60a5fa" : "#2563eb") : (isDark ? "#a3a3a3" : "#737373") }} numberOfLines={1}>
                  {task.assignee?.name || "Unassigned"}
                </Text>
              </View>
            )}
          </View>
          <View className="flex-row items-center gap-1">
            {due && (
              <>
                {isOverdue ? (
                  <AlertCircle size={12} color={isDark ? "#f87171" : "#dc2626"} />
                ) : (
                  <Clock size={12} color={colors.mutedForeground} />
                )}
                <Text
                  className="text-xs"
                  style={{ color: isOverdue ? (isDark ? "#f87171" : "#dc2626") : colors.mutedForeground }}
                >
                  {due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </Text>
              </>
            )}
            <ChevronRight size={14} color={colors.mutedForeground} />
          </View>
        </View>
        {/* Line 2: title */}
        <Text
          className={`text-base ${isDone ? "line-through opacity-50" : ""}`}
          style={{ lineHeight: 20, marginTop: -1, marginBottom: 2 }}
          numberOfLines={1}
        >
          {task.title || "Untitled"}
        </Text>
        {/* Line 3: description */}
        {task.description ? (
          <Muted style={{ fontSize: 14, lineHeight: 18 }} numberOfLines={2}>{task.description}</Muted>
        ) : null}
      </View>
    </Pressable>
  );
}
