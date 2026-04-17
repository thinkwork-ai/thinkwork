import { useState, useCallback } from "react";
import { View, Pressable, ActivityIndicator, Dimensions } from "react-native";
import { useColorScheme } from "nativewind";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import {
  ChevronRight,
  AlertCircle,
  Clock,
  CloudOff,
  RefreshCw,
  Archive,
} from "lucide-react-native";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { ShimmerProcessing } from "./ThreadRow";

const SCREEN_WIDTH = Dimensions.get("window").width;
const SNAP_THRESHOLD = SCREEN_WIDTH * 0.5;

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
    /** JSONB blob; we read `workflowName` for the line-2 label. */
    metadata?: Record<string, unknown> | null;
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
  /** Swipe-left-to-archive handler. Same contract as ThreadRow.
   *  Parent resolves true on success so the row slides off; false
   *  springs back. Omit to disable the gesture entirely. */
  onArchive?: (taskId: string) => Promise<boolean>;
  /** True while the agent is mid-turn on this task (useTurnCompletion).
   *  Replaces the subtitle row with a "Processing..." shimmer so the
   *  user sees work-in-progress between create → first response. */
  isActive?: boolean;
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

export function TaskRow({ task, onPress, hideAssignee, onRetrySync, onArchive, isActive }: TaskRowProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const [isArchiving, setIsArchiving] = useState(false);

  // Reanimated shared values for the custom swipe gesture — mirrors
  // ThreadRow so the archive UX is identical on both tabs.
  const translateX = useSharedValue(0);
  const hasSnapped = useSharedValue(false);
  const isArchivingShared = useSharedValue(false);

  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const triggerArchive = useCallback(async () => {
    if (!onArchive || isArchivingShared.value) return;
    isArchivingShared.value = true;
    setIsArchiving(true);
    const success = await onArchive(task.id);
    if (!success) {
      setIsArchiving(false);
      isArchivingShared.value = false;
      translateX.value = withSpring(0);
    }
  }, [onArchive, task.id, translateX, isArchivingShared]);

  const panGesture = Gesture.Pan()
    .activeOffsetX(-10)
    .failOffsetY([-10, 10])
    .onUpdate((e) => {
      if (hasSnapped.value) return;
      const clampedX = Math.min(0, e.translationX);
      translateX.value = clampedX;
      if (clampedX < -SNAP_THRESHOLD && !hasSnapped.value) {
        hasSnapped.value = true;
        runOnJS(triggerHaptic)();
        translateX.value = withTiming(-SCREEN_WIDTH, { duration: 200 });
        runOnJS(triggerArchive)();
      }
    })
    .onEnd(() => {
      if (!hasSnapped.value) {
        translateX.value = withSpring(0);
      }
    })
    .onFinalize(() => {
      if (!hasSnapped.value) {
        hasSnapped.value = false;
      }
    });

  const rowAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));
  const iconAnimatedStyle = useAnimatedStyle(() => {
    const revealedWidth = -translateX.value;
    return {
      position: "absolute" as const,
      right: 0,
      top: 0,
      bottom: 0,
      width: Math.max(revealedWidth, 0),
      justifyContent: "center" as const,
      alignItems: "center" as const,
    };
  });

  const statusUpper = (task.status || "").toUpperCase();
  const isDone = statusUpper === "DONE";
  // Treat `null` and the legacy value "synced" the same way — no badge.
  // Rows coming in via the LastMile webhook ingest don't have syncStatus
  // set because they're already canonical in the external system.
  const syncStatus = task.syncStatus ?? null;
  const showSyncBadge =
    syncStatus === "pending" ||
    syncStatus === "local" ||
    syncStatus === "error";

  // Workflow name rendered as a purple badge next to the title. Stamped
  // at create time from the workflow picker (tasks/new flow in
  // apps/mobile/app/(tabs)/index.tsx: `metadata: { workflowId,
  // workflowName }`). Absent for tasks created before workflow
  // selection shipped — badge just doesn't render in that case.
  const workflowName =
    (task.metadata?.workflowName as string | undefined) || null;

  const due = task.dueAt ? new Date(task.dueAt) : null;
  const isOverdue = due && due < new Date() && !isDone;

  // Show an orange "Need Information" badge when the task hasn't been
  // minted yet (`syncStatus='local'`) AND the agent isn't mid-turn.
  // This is the "user owes a form submission" state — the intake
  // Question Card is sitting in the thread waiting to be filled.
  // Hidden while processing (the shimmer already communicates state)
  // and once the task is synced (external_task_id stamped).
  const needsInfo = !isActive && syncStatus === "local";

  const content = (
    <Pressable
      onPress={onPress}
      className="flex-row items-start py-2 px-4 active:bg-neutral-50 dark:active:bg-neutral-900"
      style={{ backgroundColor: colors.background }}
    >
      {/* Content — no icon column; tasks tab is implicitly all tasks. */}
      <View className="flex-1">
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
        {/* Line 3: workflow badge on the left, shimmer on the right
         *  while the agent runs. Badge stays visible during processing
         *  so the user keeps the workflow context. If no badge, fall
         *  back to description (when idle) or full shimmer (when active). */}
        {workflowName ? (
          <View className="flex-row items-center gap-2">
            <View
              className="rounded-full px-2 py-0.5"
              style={{ backgroundColor: "transparent", borderWidth: 1, borderColor: isDark ? "#c084fc" : "#9333ea" }}
            >
              <Text style={{ fontSize: 10, fontWeight: "600", color: isDark ? "#c084fc" : "#9333ea" }} numberOfLines={1}>
                {workflowName}
              </Text>
            </View>
            {isActive ? (
              <ShimmerProcessing />
            ) : needsInfo ? (
              <View
                className="rounded-full px-2 py-0.5"
                style={{ backgroundColor: "transparent", borderWidth: 1, borderColor: isDark ? "#fb923c" : "#ea580c" }}
              >
                <Text style={{ fontSize: 10, fontWeight: "600", color: isDark ? "#fb923c" : "#ea580c" }} numberOfLines={1}>
                  Need Information
                </Text>
              </View>
            ) : null}
          </View>
        ) : isActive ? (
          <ShimmerProcessing />
        ) : needsInfo ? (
          <View
            className="rounded-full px-2 py-0.5 self-start"
            style={{ backgroundColor: "transparent", borderWidth: 1, borderColor: isDark ? "#fb923c" : "#ea580c" }}
          >
            <Text style={{ fontSize: 10, fontWeight: "600", color: isDark ? "#fb923c" : "#ea580c" }} numberOfLines={1}>
              Need Information
            </Text>
          </View>
        ) : task.description ? (
          <Muted style={{ fontSize: 14, lineHeight: 18 }} numberOfLines={1}>
            {task.description}
          </Muted>
        ) : null}
      </View>
    </Pressable>
  );

  if (!onArchive) return content;

  return (
    <View style={{ overflow: "hidden" }}>
      {/* Red reveal layer with archive icon */}
      <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "#dc2626" }}>
        <Animated.View style={iconAnimatedStyle}>
          {isArchiving ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Archive size={20} color="#ffffff" />
          )}
        </Animated.View>
      </View>
      {/* Sliding row content */}
      <GestureDetector gesture={panGesture}>
        <Animated.View style={rowAnimatedStyle}>{content}</Animated.View>
      </GestureDetector>
    </View>
  );
}
