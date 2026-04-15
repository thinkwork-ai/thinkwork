import { View, Pressable, ActivityIndicator } from "react-native";
import { useColorScheme } from "nativewind";
import { ChevronRight, Check, CheckSquare, ListChecks, AlertCircle, Clock, CloudOff, RefreshCw } from "lucide-react-native";
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
    /** External-sync state for mobile-created task rows. See
     *  packages/api/src/integrations/external-work-items/syncExternalTaskOnCreate.ts
     *  for the full state machine. null for webhook-ingested rows. */
    syncStatus?: string | null;
    syncError?: string | null;
  };
  onPress: () => void;
  hideAssignee?: boolean;
  /** Fires retryTaskSync(threadId) for error-state rows. Parent is
   *  responsible for debouncing and refetching the list after. */
  onRetrySync?: (taskId: string) => void;
}

/**
 * Small chip that communicates the outbound-sync state of a mobile-created
 * task. The state machine is owned by the backend (see
 * `syncExternalTaskOnCreate.ts`); this component is purely presentational
 * and reacts to `task.syncStatus`.
 *
 *   pending → spinner + "Syncing…"   (in-flight create/retry call)
 *   local   → cloud-off + "Local"    (no connector, or API not wired)
 *   error   → refresh + "Retry sync" (tap to fire retryTaskSync)
 */
function SyncBadge({
  status,
  error,
  onRetry,
  isDark,
}: {
  status: "pending" | "local" | "error";
  error: string | null;
  onRetry?: () => void;
  isDark: boolean;
}) {
  const palette = (() => {
    if (status === "pending") {
      return {
        bg: isDark ? "rgba(96,165,250,0.15)" : "rgba(37,99,235,0.08)",
        fg: isDark ? "#60a5fa" : "#2563eb",
      };
    }
    if (status === "local") {
      return {
        bg: isDark ? "rgba(163,163,163,0.15)" : "rgba(115,115,115,0.08)",
        fg: isDark ? "#a3a3a3" : "#737373",
      };
    }
    // error
    return {
      bg: isDark ? "rgba(248,113,113,0.15)" : "rgba(220,38,38,0.08)",
      fg: isDark ? "#f87171" : "#dc2626",
    };
  })();

  const label =
    status === "pending" ? "Syncing…" : status === "local" ? "Local" : "Retry sync";

  const inner = (
    <View
      className="flex-row items-center gap-1 rounded-full"
      style={{ backgroundColor: palette.bg, paddingHorizontal: 6, paddingVertical: 2 }}
    >
      {status === "pending" ? (
        <ActivityIndicator size="small" color={palette.fg} style={{ transform: [{ scale: 0.6 }] }} />
      ) : status === "local" ? (
        <CloudOff size={10} color={palette.fg} />
      ) : (
        <RefreshCw size={10} color={palette.fg} />
      )}
      <Text style={{ fontSize: 10, fontWeight: "600", color: palette.fg }}>{label}</Text>
    </View>
  );

  // Error rows are tappable for retry. The Pressable stops event
  // propagation so the tap doesn't also open the thread detail.
  if (status === "error" && onRetry) {
    return (
      <Pressable
        onPress={(e) => {
          e.stopPropagation?.();
          onRetry();
        }}
        accessibilityLabel={error ? `Retry sync — ${error}` : "Retry sync"}
        className="active:opacity-70"
      >
        {inner}
      </Pressable>
    );
  }
  return inner;
}

const STATUS_ICON_COLORS: Record<string, { bg: string; fg: string }> = {
  TODO:        { bg: "rgba(167,139,250,0.15)", fg: "#a78bfa" },
  IN_PROGRESS: { bg: "rgba(96,165,250,0.15)",  fg: "#60a5fa" },
  BLOCKED:     { bg: "rgba(248,113,113,0.15)", fg: "#f87171" },
  DONE:        { bg: "rgba(74,222,128,0.15)",  fg: "#4ade80" },
  CANCELLED:   { bg: "rgba(163,163,163,0.15)", fg: "#a3a3a3" },
};

const PARENT_ICON = { bg: "rgba(20,184,166,0.15)", fg: "#14b8a6" };

export function TaskRow({ task, onPress, hideAssignee, onRetrySync }: TaskRowProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;

  const statusUpper = (task.status || "").toUpperCase();
  const isDone = statusUpper === "DONE";
  const isParent = (task.childCount ?? 0) > 0;
  // Treat `null` and the legacy value "synced" the same way — no badge.
  // Rows coming in via the LastMile webhook ingest don't have syncStatus
  // set because they're already canonical in the external system.
  const syncStatus = task.syncStatus ?? null;
  const showSyncBadge =
    syncStatus === "pending" ||
    syncStatus === "local" ||
    syncStatus === "error";

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
            {showSyncBadge && (
              <SyncBadge
                status={syncStatus as "pending" | "local" | "error"}
                error={task.syncError ?? null}
                onRetry={onRetrySync ? () => onRetrySync(task.id) : undefined}
                isDark={isDark}
              />
            )}
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
