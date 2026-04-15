import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { View, FlatList, RefreshControl, Pressable, AppState } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { useThreadUpdatedSubscription } from "@/lib/hooks/use-subscriptions";
import { useQuery } from "urql";
import { ThreadsQuery } from "@/lib/graphql-queries";
import { TabHeader } from "@/components/layout/tab-header";
import { WebContent } from "@/components/layout/web-content";
import { Text, Muted } from "@/components/ui/typography";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { COLORS } from "@/lib/theme";
import { CheckSquare, ListChecks, ChevronRight, AlertCircle, Clock } from "lucide-react-native";
import { ThreadChannel } from "@/lib/gql/graphql";

function formatDueDate(dateStr: string | null | undefined): { label: string; isOverdue: boolean } {
  if (!dateStr) return { label: "", isOverdue: false };
  const due = new Date(dateStr);
  const now = new Date();
  const isOverdue = due < now;
  const diff = Math.abs(due.getTime() - now.getTime());
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return { label: isOverdue ? "Overdue" : "Due today", isOverdue };
  }
  if (days === 1) {
    return { label: isOverdue ? "1d overdue" : "Due tomorrow", isOverdue };
  }
  if (days < 7) {
    return { label: isOverdue ? `${days}d overdue` : `Due in ${days}d`, isOverdue };
  }
  return {
    label: due.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    isOverdue,
  };
}

type TaskFilter = "active" | "done" | "all";

export default function TasksScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const userId = user?.sub;
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();
  const { isWide } = useMediaQuery();

  const [filter, setFilter] = useState<TaskFilter>("active");

  const [{ data: tasksData, fetching }, reexecute] = useQuery({
    query: ThreadsQuery,
    variables: {
      tenantId: tenantId!,
      channel: ThreadChannel.Task,
      assigneeId: userId,
    },
    pause: !tenantId || !userId,
  });

  // Polling fallback — refetch every 15s while in foreground
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { appStateRef.current = s; });
    const interval = setInterval(() => {
      if (appStateRef.current === "active") reexecute({ requestPolicy: "network-only" });
    }, 15000);
    return () => { sub.remove(); clearInterval(interval); };
  }, [reexecute]);

  // Real-time updates
  const [{ data: threadEvent }] = useThreadUpdatedSubscription(tenantId);
  useEffect(() => {
    if (threadEvent?.onThreadUpdated) reexecute({ requestPolicy: "network-only" });
  }, [threadEvent?.onThreadUpdated?.updatedAt]);

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    reexecute({ requestPolicy: "network-only" });
    setTimeout(() => setRefreshing(false), 500);
  }, [reexecute]);

  const filteredTasks = useMemo(() => {
    let tasks = (tasksData?.threads ?? []) as any[];

    // Filter by active/done
    if (filter === "active") {
      tasks = tasks.filter((t: any) => {
        const s = (t.status || "").toUpperCase();
        return s !== "DONE" && s !== "CANCELLED";
      });
    } else if (filter === "done") {
      tasks = tasks.filter((t: any) => (t.status || "").toUpperCase() === "DONE");
    }

    // Sort: overdue first, then by due date (soonest first), then no-due-date last
    return tasks.sort((a: any, b: any) => {
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
      // Overdue items first
      const now = Date.now();
      const aOverdue = aDue < now ? 0 : 1;
      const bOverdue = bDue < now ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      // Then by due date ascending
      if (aDue !== bDue) return aDue - bDue;
      // Then by created date descending
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [tasksData?.threads, filter]);

  const renderTask = useCallback(({ item }: { item: any }) => {
    const due = formatDueDate(item.dueAt);
    const isDone = (item.status || "").toUpperCase() === "DONE";
    const isParent = (item.childCount ?? 0) > 0;
    const externalProvider =
      (item.metadata?.external?.provider as string | undefined) ?? null;
    // Parent tasks: ListChecks (teal), Child tasks: CheckSquare (green)
    const iconConfig = isParent
      ? { icon: ListChecks, bg: "rgba(20,184,166,0.15)", fg: "#14b8a6" }
      : { icon: CheckSquare, bg: "rgba(34,197,94,0.15)", fg: "#22c55e" };
    const IconComponent = iconConfig.icon;
    const providerLabel = externalProvider
      ? externalProvider.charAt(0).toUpperCase() + externalProvider.slice(1)
      : null;

    return (
      <Pressable
        onPress={() => router.push({ pathname: `/thread/${item.id}`, params: item.title ? { title: item.title } : {} })}
        className="flex-row items-start py-2 pr-4 active:bg-neutral-50 dark:active:bg-neutral-900"
        style={{ backgroundColor: colors.background }}
      >
        {/* Icon column — matches inbox ThreadRow */}
        <View style={{ width: 56, alignItems: "center", justifyContent: "center" }}>
          <View
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: iconConfig.bg, borderWidth: 0.25, borderColor: iconConfig.fg, alignItems: "center", justifyContent: "center" }}
          >
            <IconComponent size={20} color={iconConfig.fg} />
          </View>
        </View>

        {/* Content */}
        <View className="flex-1 ml-3">
          {/* Line 1: identifier + provider pill (left) + due date (right) */}
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-1.5">
              <Text className="text-xs font-mono text-primary" style={{ lineHeight: 14 }}>
                {item.identifier}
              </Text>
              {providerLabel ? (
                <View
                  style={{
                    paddingHorizontal: 6,
                    paddingVertical: 1,
                    borderRadius: 4,
                    backgroundColor: isDark ? "rgba(99,102,241,0.18)" : "rgba(99,102,241,0.12)",
                  }}
                >
                  <Text style={{ fontSize: 9, fontWeight: "600", color: isDark ? "#a5b4fc" : "#4f46e5", lineHeight: 12 }}>
                    {providerLabel}
                  </Text>
                </View>
              ) : null}
            </View>
            <View className="flex-row items-center gap-1">
              {due.label ? (
                <>
                  {due.isOverdue ? (
                    <AlertCircle size={12} color={isDark ? "#f87171" : "#dc2626"} />
                  ) : (
                    <Clock size={12} color={colors.mutedForeground} />
                  )}
                  <Text
                    className="text-xs"
                    style={{ color: due.isOverdue ? (isDark ? "#f87171" : "#dc2626") : colors.mutedForeground }}
                  >
                    {due.label}
                  </Text>
                </>
              ) : null}
              <ChevronRight size={14} color={colors.mutedForeground} />
            </View>
          </View>
          {/* Line 2: title */}
          <Text
            className={`text-base ${isDone ? "line-through opacity-50" : ""}`}
            style={{ lineHeight: 20, marginTop: -1, marginBottom: 2 }}
            numberOfLines={1}
          >
            {item.title}
          </Text>
          {/* Line 3: description (2 lines max) */}
          {item.description ? (
            <Muted style={{ fontSize: 14, lineHeight: 18 }} numberOfLines={2}>{item.description}</Muted>
          ) : null}
        </View>
      </Pressable>
    );
  }, [router, isDark, colors]);

  const filterChips: { key: TaskFilter; label: string }[] = [
    { key: "active", label: "Active" },
    { key: "done", label: "Done" },
    { key: "all", label: "All" },
  ];

  const content = (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      {/* Filter chips */}
      <View className="flex-row gap-2 px-4 py-2 border-b border-neutral-200 dark:border-neutral-800">
        {filterChips.map((chip) => (
          <Pressable
            key={chip.key}
            onPress={() => setFilter(chip.key)}
            className={`px-3 py-1 rounded-full ${
              filter === chip.key
                ? "bg-neutral-800 dark:bg-neutral-200"
                : "bg-neutral-200 dark:bg-neutral-800"
            }`}
          >
            <Text
              className={`text-xs font-medium ${
                filter === chip.key
                  ? "text-white dark:text-black"
                  : "text-neutral-600 dark:text-neutral-400"
              }`}
            >
              {chip.label}
            </Text>
          </Pressable>
        ))}
        {filteredTasks.length > 0 && (
          <View className="flex-1 items-end justify-center">
            <Muted className="text-xs">{filteredTasks.length} task{filteredTasks.length !== 1 ? "s" : ""}</Muted>
          </View>
        )}
      </View>

      {/* Task list */}
      <FlatList
        data={filteredTasks}
        keyExtractor={(item) => item.id}
        renderItem={renderTask}
        contentContainerStyle={filteredTasks.length === 0 ? { flex: 1 } : undefined}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center py-20">
            <CheckSquare size={48} color={colors.mutedForeground} strokeWidth={1} />
            <Text className="text-base text-neutral-500 dark:text-neutral-400 mt-3">
              {filter === "active" ? "No active tasks" : filter === "done" ? "No completed tasks" : "No tasks yet"}
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.mutedForeground} />
        }
      />
    </View>
  );

  if (isWide) {
    return (
      <>
        <TabHeader title="Tasks" />
        <WebContent>{content}</WebContent>
      </>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background, paddingTop: insets.top }}>
      {/* Header */}
      <View className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
        <Text className="text-2xl font-bold">Tasks</Text>
      </View>
      {content}
    </View>
  );
}
