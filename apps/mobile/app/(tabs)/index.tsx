import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { View, FlatList, RefreshControl, Pressable, Platform, KeyboardAvoidingView, Keyboard, Alert, AppState } from "react-native";
import * as Updates from "expo-updates";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { useAgents } from "@/lib/hooks/use-agents";
import { useThreadUpdatedSubscription, useThreadTurnUpdatedSubscription } from "@/lib/hooks/use-subscriptions";
import { useTurnCompletion } from "@/lib/hooks/use-turn-completion";
import { useMe } from "@/lib/hooks/use-users";
import { useQuery, useMutation } from "urql";
import { ThreadsQuery, CreateThreadMutation, SendMessageMutation, UpdateThreadMutation, AgentWorkspacesQuery } from "@/lib/graphql-queries";
import { TabHeader } from "@/components/layout/tab-header";
import { WebContent } from "@/components/layout/web-content";
import { AgentPicker } from "@/components/chat/AgentPicker";
import { ThreadFilterBar, type ThreadFilters } from "@/components/threads/ThreadFilterBar";
import { ThreadRow } from "@/components/threads/ThreadRow";
import { TaskRow } from "@/components/threads/TaskRow";
import { Muted, Text } from "@/components/ui/typography";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { COLORS } from "@/lib/theme";
import { ListTodo, Bot, Settings, LogOut, RefreshCw, Filter, ChevronDown, ChevronRight, X, Zap, Check, CheckSquare, ListChecks, Circle, AlertCircle, Clock, Cable, Plug } from "lucide-react-native";
import { ThreadChannel } from "@/lib/gql/graphql";
import { HeaderContextMenu } from "@/components/ui/header-context-menu";
import { useThreadReadState } from "@/lib/hooks/use-thread-read-state";
import { MessageInputFooter, type MessageInputFooterRef, type SelectedWorkspace } from "@/components/input/MessageInputFooter";
import { QuickActionsSheet, type QuickActionsSheetRef } from "@/components/chat/QuickActionsSheet";
import { QuickActionFormSheet, type QuickActionFormSheetRef, type QuickActionFormData } from "@/components/chat/QuickActionFormSheet";
import { WorkspacePickerSheet, type WorkspacePickerSheetRef, type SubAgent } from "@/components/input/WorkspacePickerSheet";
import { useQuickActions, useCreateQuickAction, useUpdateQuickAction, useDeleteQuickAction, type QuickAction } from "@/lib/hooks/use-quick-actions";

export default function ThreadsScreen() {
  const router = useRouter();
  const { user, refreshCounter, signOut } = useAuth();
  const tenantId = user?.tenantId;
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();
  const { isWide } = useMediaQuery();
  const { markRead, isUnread } = useThreadReadState();
  const { hasNewCompletion, isThreadActive, markThreadActive, clearThreadActive, activeTriggers } = useTurnCompletion(tenantId);

  // ── Agents + Me ──────────────────────────────────────────────────────────
  const [{ data: agentsData, fetching: agentsFetching }] = useAgents(tenantId);
  const agents = agentsData?.agents ?? [];

  const [{ data: meData }] = useMe();
  const currentUser = meData?.me;

  // Server already scopes agents to the authed user. Just drop local scratch agents.
  const visibleAgents = useMemo(
    () => (agents as any[]).filter((a: any) => a.type !== "local"),
    [agents],
  );

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const activeAgent = useMemo(() => {
    if (!visibleAgents?.length) return null;
    if (selectedAgentId) {
      const found = visibleAgents.find((a: any) => a.id === selectedAgentId);
      if (found) return found;
    }
    return visibleAgents.find((a: any) => a.role === "team") ?? visibleAgents[0];
  }, [visibleAgents, selectedAgentId]);

  const agentNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of agents as any[]) {
      map[a.id] = a.name || "Agent";
    }
    return map;
  }, [agents]);

  // ── Inbox / Tasks toggle ──────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"inbox" | "tasks">("inbox");

  // ── Thread filters + query (scoped to active agent) ────────────────────
  const [filters, setFilters] = useState<ThreadFilters>({ statuses: [], channels: [], agentId: "", showArchived: false });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const hasActiveFilters = filters.statuses.length > 0 || filters.channels.length > 0 || filters.showArchived;

  // Only apply filters when the filter panel is open
  const appliedFilters = filtersOpen ? filters : { statuses: [], channels: [], agentId: "", showArchived: false } as ThreadFilters;

  // Use agent from filter, or fall back to active agent from header picker
  const effectiveAgentId = appliedFilters.agentId || activeAgent?.id;

  const queryVars = useMemo(() => {
    const vars: any = { tenantId: tenantId! };
    // Pass single status to server if exactly one selected, otherwise filter client-side
    if (appliedFilters.statuses.length === 1) vars.status = appliedFilters.statuses[0];
    if (effectiveAgentId) vars.agentId = effectiveAgentId;
    return vars;
  }, [tenantId, appliedFilters.statuses, effectiveAgentId]);

  const [{ data: threadsData }, reexecute] = useQuery({
    query: ThreadsQuery,
    variables: queryVars,
    pause: !tenantId || !effectiveAgentId,
  });

  // ── Tasks query (always runs for badge count) ────────────────────────
  const [{ data: tasksData }, reexecuteTasks] = useQuery({
    query: ThreadsQuery,
    variables: {
      tenantId: tenantId!,
      channel: ThreadChannel.Task,
      assigneeId: user?.sub,
    },
    pause: !tenantId || !user?.sub,
  });

  const filteredTasks = useMemo(() => {
    let tasks = (tasksData?.threads ?? []) as any[];
    tasks = tasks.filter((t: any) => {
      const s = (t.status || "").toUpperCase();
      return s !== "DONE" && s !== "CANCELLED";
    });
    return tasks.sort((a: any, b: any) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [tasksData?.threads]);

  // Polling fallback — refetch every 15s, but only while app is in foreground
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { appStateRef.current = s; });
    const interval = setInterval(() => {
      if (appStateRef.current === "active") {
        reexecute({ requestPolicy: "network-only" });
      }
    }, 15000);
    return () => { sub.remove(); clearInterval(interval); };
  }, [reexecute]);

  // Re-fetch when app returns to foreground after token refresh
  useEffect(() => {
    if (refreshCounter > 0) {
      reexecute({ requestPolicy: "network-only" });
    }
  }, [refreshCounter]);

  // Real-time: re-fetch on any thread update via AppSync subscription
  const [{ data: threadEvent }] = useThreadUpdatedSubscription(tenantId);
  const lastThreadEvent = useRef<string | null>(null);
  useEffect(() => {
    const evt = threadEvent?.onThreadUpdated;
    if (!evt) return;
    // Build a unique key from the event to detect changes
    const key = `${evt.threadId}-${evt.status}-${evt.updatedAt}`;
    if (key !== lastThreadEvent.current) {
      lastThreadEvent.current = key;
      reexecute({ requestPolicy: "network-only" });
    }
  }, [threadEvent]);

  // Re-fetch when a turn completes (succeeded/failed)
  useEffect(() => {
    if (hasNewCompletion) {
      reexecute({ requestPolicy: "network-only" });
    }
  }, [hasNewCompletion]);

  // Clear active indicators when re-fetched thread data shows the turn completed
  const activeSnapshotRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (!threadsData?.threads || activeTriggers.size === 0) return;
    const threads = threadsData.threads as any[];
    for (const tId of activeTriggers) {
      const thread = threads.find((t: any) => t.id === tId);
      if (!thread) continue;
      const completedAt = thread.lastTurnCompletedAt || "";
      const prev = activeSnapshotRef.current.get(tId);
      if (prev === undefined) {
        // First time seeing this active thread — snapshot current timestamp
        activeSnapshotRef.current.set(tId, completedAt);
      } else if (completedAt && completedAt !== prev) {
        // Turn completed since we marked active — clear indicator
        clearThreadActive(tId);
        activeSnapshotRef.current.delete(tId);
      }
    }
    // Clean up snapshots for threads no longer active
    for (const tId of activeSnapshotRef.current.keys()) {
      if (!activeTriggers.has(tId)) activeSnapshotRef.current.delete(tId);
    }
  }, [threadsData?.threads, activeTriggers, clearThreadActive]);

  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());

  const filteredThreads = useMemo(() => {
    let threads = (threadsData?.threads ?? []) as any[];
    // Server already excludes task-channel and child threads when no channel filter is applied
    // Hide archived threads unless toggle is on
    if (!appliedFilters.showArchived) {
      threads = threads.filter((t: any) => !t.archivedAt && !archivedIds.has(t.id));
    }
    // Multi-status filter (client-side when >1 selected)
    if (appliedFilters.statuses.length > 1) {
      const set = new Set(appliedFilters.statuses.map((s) => s.toLowerCase()));
      threads = threads.filter((t: any) => set.has((t.status || "").toLowerCase()));
    }
    // Multi-channel filter
    if (appliedFilters.channels.length > 0) {
      const set = new Set(appliedFilters.channels);
      threads = threads.filter(
        (t: any) => set.has((t.channel || t.type || "").toUpperCase()),
      );
    }
    // Sort by lastTurnCompletedAt desc — only completed agent turns move threads up
    return threads.sort((a: any, b: any) => {
      const aTime = new Date(a.lastTurnCompletedAt || a.createdAt).getTime();
      const bTime = new Date(b.lastTurnCompletedAt || b.createdAt).getTime();
      return bTime - aTime;
    });
  }, [threadsData?.threads, appliedFilters.statuses, appliedFilters.channels, appliedFilters.showArchived, activeAgent?.id, archivedIds]);

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    reexecute({ requestPolicy: "network-only" });
    setTimeout(() => setRefreshing(false), 500);
  }, [reexecute]);


  // ── Thread press → router push ─────────────────────────────────────────
  const navigatingRef = useRef(false);
  const handleThreadPress = useCallback((thread: any) => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    markRead(thread.id);
    setTimeout(() => {
      router.push(`/thread/${thread.id}`);
      // Reset after navigation settles
      setTimeout(() => { navigatingRef.current = false; }, 500);
    }, 0);
  }, [router, markRead]);

  // ── New thread input ───────────────────────────────────────────────────
  const [newThreadText, setNewThreadText] = useState("");
  const quickActionsRef = useRef<QuickActionsSheetRef>(null);
  const quickActionFormRef = useRef<QuickActionFormSheetRef>(null);
  const workspacePickerRef = useRef<WorkspacePickerSheetRef>(null);
  const messageInputRef = useRef<MessageInputFooterRef>(null);
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<SelectedWorkspace[]>([]);

  // ── Quick Actions (per-user, from DB) ─────────────────────────────────
  const [{ data: qaData }, reexecuteQA] = useQuickActions(tenantId);
  const quickActions: QuickAction[] = (qaData?.userQuickActions ?? []) as QuickAction[];
  const [, executeCreateQA] = useCreateQuickAction();
  const [, executeUpdateQA] = useUpdateQuickAction();
  const [, executeDeleteQA] = useDeleteQuickAction();

  // ── Workspaces for workspace targeting ──────────────────────────────
  const [{ data: workspacesData }] = useQuery({
    query: AgentWorkspacesQuery,
    variables: { agentId: activeAgent?.id! },
    pause: !activeAgent?.id,
  });
  const subAgents: SubAgent[] = useMemo(() => {
    if (!workspacesData?.agentWorkspaces) return [];
    return (workspacesData.agentWorkspaces as any[]).map((ws: any) => ({
      id: ws.slug,
      agentId: ws.id,
      name: ws.name,
      role: ws.purpose || undefined,
    }));
  }, [workspacesData]);

  const subAgentNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of subAgents) {
      map[a.id] = a.name;
      if (a.agentId) map[a.agentId] = a.name;
    }
    return map;
  }, [subAgents]);

  // Map UUID -> slug for routing when selecting a quick action with a stored workspace UUID
  const agentIdToSlug = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of subAgents) {
      if (a.agentId) map[a.agentId] = a.id;
    }
    return map;
  }, [subAgents]);
  const [, executeCreateThread] = useMutation(CreateThreadMutation);
  const [, executeSendMessage] = useMutation(SendMessageMutation);
  const [, executeUpdateThread] = useMutation(UpdateThreadMutation);

  const handleArchive = useCallback(async (threadId: string): Promise<boolean> => {
    console.log("[Archive] Starting archive for thread:", threadId);
    const { data, error } = await executeUpdateThread({ id: threadId, input: { archivedAt: new Date().toISOString() } });
    console.log("[Archive] Result:", { data, error: error?.message });
    if (error) {
      console.error("[Archive] Failed:", error.message, error.graphQLErrors);
      return false;
    }
    setArchivedIds((prev) => new Set(prev).add(threadId));
    return true;
  }, [executeUpdateThread]);

  const handleCreateThread = useCallback(async (overrideText?: string, overrideWorkspaces?: SelectedWorkspace[]) => {
    const text = (overrideText ?? newThreadText).trim();
    const workspaces = overrideWorkspaces ?? selectedWorkspaces;
    console.log("[handleCreateThread]", { text: text.slice(0, 20), agentId: activeAgent?.id, tenantId, userId: currentUser?.id, workspaceCount: workspaces.length });
    if (!text || !activeAgent?.id || !tenantId) {
      console.warn("[handleCreateThread] Bailed — missing:", { text: !!text, agentId: !!activeAgent?.id, tenantId: !!tenantId });
      return;
    }

    setNewThreadText("");
    setSelectedWorkspaces([]);
    Keyboard.dismiss();

    // Build routing hint if workspaces are selected
    let messageContent = text;
    if (workspaces.length > 0) {
      const names = workspaces.map((w) => w.name).join(", ");
      messageContent = `[Route to: ${names}] ${text}`;
    }

    // Build metadata with workspace targeting
    const metadata = workspaces.length > 0
      ? JSON.stringify({ workspaceAgentIds: workspaces.map((w) => w.id) })
      : undefined;

    try {
      const { data: createData, error: createError } = await executeCreateThread({
        input: {
          tenantId,
          agentId: activeAgent.id,
          title: text.length > 60 ? text.slice(0, 60) + "..." : text,
          type: "TASK" as any,
          channel: "CHAT" as any,
          createdByType: "user",
          createdById: currentUser?.id || user?.sub,
          ...(metadata ? { metadata } : {}),
        },
      });

      if (createError) {
        console.error("[Threads] CreateThread failed:", createError.message);
        Alert.alert("Error", `Failed to create thread: ${createError.message}`);
        return;
      }

      const newThread = createData?.createThread;
      if (!newThread?.id) {
        console.error("[Threads] CreateThread returned no ID", createData);
        Alert.alert("Error", "Thread was not created — no ID returned");
        return;
      }

      console.log("[Threads] Thread created:", newThread.id, (newThread as any).identifier);
      markRead(newThread.id);

      const { data: msgData, error: msgError } = await executeSendMessage({
        input: {
          threadId: newThread.id,
          role: "USER" as any,
          content: messageContent,
          senderType: "human",
          senderId: currentUser?.id,
        },
      });

      if (msgError) {
        console.error("[Threads] SendMessage failed:", msgError.message, msgError.graphQLErrors);
      } else {
        console.log("[Threads] Message sent, navigating to chat", msgData?.sendMessage?.id);
        markThreadActive(newThread.id);
      }

      // Refresh thread list so the new thread appears on the home page
      reexecute({ requestPolicy: "network-only" });
    } catch (e) {
      console.error("[Threads] Failed to create thread:", e);
    }
  }, [newThreadText, selectedWorkspaces, activeAgent?.id, tenantId, currentUser?.id, executeCreateThread, executeSendMessage, reexecute, markRead]);

  // ── Render ─────────────────────────────────────────────────────────────
  const agentDisplayName = activeAgent?.name || (agentsFetching ? "" : "Agent");
  const pickerAgents = visibleAgents.map((a: any) => ({ ...a, _id: a.id }));

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: isDark ? "#171717" : "#f5f5f5" }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      {isWide ? (
        <TabHeader title={agentDisplayName} />
      ) : (
        <View style={{ paddingTop: insets.top }} className="bg-white dark:bg-neutral-950 border-b border-neutral-200 dark:border-neutral-800">
          <View className="flex-row items-center justify-between px-4" style={{ height: 44 }}>
            {/* Left: Agent name + picker */}
            <AgentPicker
              agents={pickerAgents}
              selectedId={activeAgent?.id ?? ""}
              onSelect={(a: any) => setSelectedAgentId(a._id ?? a.id)}
            >
              <View className="flex-row items-center gap-1.5">
                <Text size="xl" weight="bold">{agentDisplayName}</Text>
                <ChevronDown size={18} color={colors.foreground} />
              </View>
            </AgentPicker>

            {/* Right: Filter + Menu */}
            <View className="flex-row items-center gap-3">
            <Pressable
              onPress={() => setFiltersOpen((o) => !o)}
              className="p-2 relative"
            >
              <Filter size={22} color={filtersOpen && hasActiveFilters ? colors.primary : colors.foreground} />
              {filtersOpen && hasActiveFilters && (
                <View className="absolute top-1 right-1 w-2 h-2 rounded-full" style={{ backgroundColor: colors.primary }} />
              )}
            </Pressable>
            <HeaderContextMenu
              items={[
                { label: "Agent Config", icon: Bot, onPress: () => router.push("/settings/agent-config") },
                { label: "Automations", icon: Zap, onPress: () => router.push("/settings/automations") },
                { label: "Connectors", icon: Plug, onPress: () => router.push("/settings/connectors") },
                { label: "MCP Servers", icon: Cable, onPress: () => router.push("/settings/mcp-servers") },
                { label: "User Settings", icon: Settings, onPress: () => router.push("/settings/user-settings") },
                ...(Platform.OS !== "web" ? [{
                  label: "Update App",
                  icon: RefreshCw,
                  onPress: async () => {
                    try {
                      const update = await Updates.checkForUpdateAsync();
                      if (update.isAvailable) {
                        await Updates.fetchUpdateAsync();
                        Alert.alert("Update Ready", "Restart now?", [
                          { text: "Later", style: "cancel" },
                          { text: "Restart", onPress: () => Updates.reloadAsync() },
                        ]);
                      } else {
                        Alert.alert("Up to Date", "You're on the latest version.");
                      }
                    } catch {
                      Alert.alert("Error", "Failed to check for updates.");
                    }
                  },
                }] : []),
                { label: "Sign Out", icon: LogOut, destructive: true, separator: true, onPress: () => { signOut(); router.replace("/"); } },
              ]}
            />
            </View>
          </View>
        </View>
      )}

      {/* Inbox / Tasks tabs with badges */}
      <View className="flex-row border-b border-neutral-200 dark:border-neutral-800" style={{ backgroundColor: colors.background }}>
        <Pressable
          onPress={() => setActiveTab("inbox")}
          className="flex-1 flex-row items-center justify-center gap-1.5 py-2.5"
          style={activeTab === "inbox" ? { borderBottomWidth: 2, borderBottomColor: colors.primary } : undefined}
        >
          <Text className={`text-sm font-semibold ${activeTab === "inbox" ? "" : "text-neutral-400 dark:text-neutral-500"}`}
            style={activeTab === "inbox" ? { color: colors.primary } : undefined}>Inbox</Text>
          {(() => {
            const unreadCount = filteredThreads.filter((t: any) => isUnread(t.id, t.lastTurnCompletedAt || t.createdAt, t.lastReadAt)).length;
            return unreadCount > 0 ? (
              <View className="rounded-full min-w-[18px] h-[18px] items-center justify-center px-1" style={{ backgroundColor: activeTab === "inbox" ? colors.primary : (isDark ? "#404040" : "#d4d4d4") }}>
                <Text style={{ color: activeTab === "inbox" ? (isDark ? "#000" : "#fff") : colors.mutedForeground, fontSize: 10, fontWeight: "700" }}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
              </View>
            ) : null;
          })()}
        </Pressable>
        <Pressable
          onPress={() => setActiveTab("tasks")}
          className="flex-1 flex-row items-center justify-center gap-1.5 py-2.5"
          style={activeTab === "tasks" ? { borderBottomWidth: 2, borderBottomColor: colors.primary } : undefined}
        >
          <Text className={`text-sm font-semibold ${activeTab === "tasks" ? "" : "text-neutral-400 dark:text-neutral-500"}`}
            style={activeTab === "tasks" ? { color: colors.primary } : undefined}>Tasks</Text>
          {filteredTasks.length > 0 && (
            <View className="rounded-full min-w-[18px] h-[18px] items-center justify-center px-1" style={{ backgroundColor: activeTab === "tasks" ? colors.primary : (isDark ? "#404040" : "#d4d4d4") }}>
              <Text style={{ color: activeTab === "tasks" ? (isDark ? "#000" : "#fff") : colors.mutedForeground, fontSize: 10, fontWeight: "700" }}>{filteredTasks.length}</Text>
            </View>
          )}
        </Pressable>
      </View>

      <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <WebContent>
        {activeTab === "inbox" && filtersOpen && (
          <ThreadFilterBar filters={filters} onFiltersChange={setFilters} />
        )}

        {activeTab === "tasks" ? (
          <FlatList
            style={{ flex: 1 }}
            data={filteredTasks}
            keyExtractor={(item: any) => item.id}
            renderItem={({ item }) => (
              <TaskRow task={item} onPress={() => handleThreadPress(item)} hideAssignee />
            )}
            ItemSeparatorComponent={() => (
              <View className="h-px bg-neutral-200 dark:bg-neutral-800" style={{ marginLeft: 68 }} />
            )}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => { handleRefresh(); reexecuteTasks({ requestPolicy: "network-only" }); }} tintColor={colors.primary} />
            }
            ListEmptyComponent={
              <View className="items-center gap-2">
                <CheckSquare size={32} color={colors.mutedForeground} />
                <Muted>No active tasks</Muted>
              </View>
            }
            contentContainerStyle={filteredTasks.length === 0 ? { flexGrow: 1, justifyContent: "center" } : { paddingTop: 8, paddingBottom: 80 }}
          />
        ) : (
        <FlatList
          style={{ flex: 1 }}
          data={filteredThreads}
          keyExtractor={(item: any) => item.id}
          renderItem={({ item }) => (
            <ThreadRow
              thread={item}
              isUnread={isUnread(item.id, item.lastTurnCompletedAt || item.createdAt, item.lastReadAt)}
              isActive={isThreadActive(item.id)}
              onArchive={handleArchive}
              onPress={() => handleThreadPress(item)}
            />
          )}
          ItemSeparatorComponent={() => (
            <View className="h-px bg-neutral-200 dark:bg-neutral-800" style={{ marginLeft: 68 }} />
          )}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
          }
          scrollEnabled={filteredThreads.length > 0}
          ListEmptyComponent={
            <View className="items-center gap-2">
              <ListTodo size={32} color={colors.mutedForeground} />
              <Muted>No threads found</Muted>
            </View>
          }
          contentContainerStyle={filteredThreads.length === 0 ? { flexGrow: 1, justifyContent: "center" } : { paddingTop: 8 }}
        />
        )}
      </WebContent>
      </View>

      {/* Bottom input area — hidden on Tasks tab */}
      {activeTab === "inbox" && <View>
        <MessageInputFooter
          ref={messageInputRef}
          value={newThreadText}
          onChangeText={setNewThreadText}
          onSubmit={() => handleCreateThread()}
          placeholder="Start a new thread..."
          colors={colors}
          isDark={isDark}
          onQuickActions={() => { Keyboard.dismiss(); quickActionsRef.current?.present(); }}
          onPlusPress={() => { Keyboard.dismiss(); workspacePickerRef.current?.present(); }}
          selectedWorkspaces={selectedWorkspaces}
          onRemoveWorkspace={(id) => setSelectedWorkspaces((prev) => prev.filter((w) => w.id !== id))}
        />
      </View>}

      {/* Quick Actions Bottom Sheet */}
      <QuickActionsSheet
        ref={quickActionsRef}
        actions={quickActions}
        subAgentNames={subAgentNames}
        onSelect={(action) => {
          quickActionsRef.current?.dismiss();
          setNewThreadText(action.prompt);
          if (action.workspaceAgentId && subAgentNames[action.workspaceAgentId]) {
            const slug = agentIdToSlug[action.workspaceAgentId] ?? action.workspaceAgentId;
            setSelectedWorkspaces([{ id: slug, name: subAgentNames[action.workspaceAgentId] }]);
          }
          setTimeout(() => messageInputRef.current?.focus(), 300);
        }}
        onLongPress={(action) => {
          quickActionsRef.current?.dismiss();
          setNewThreadText(action.prompt);
          if (action.workspaceAgentId && subAgentNames[action.workspaceAgentId]) {
            const slug = agentIdToSlug[action.workspaceAgentId] ?? action.workspaceAgentId;
            setSelectedWorkspaces([{ id: slug, name: subAgentNames[action.workspaceAgentId] }]);
          }
          setTimeout(() => messageInputRef.current?.focus(), 300);
        }}
        onAdd={() => {
          quickActionsRef.current?.dismiss();
          setTimeout(() => quickActionFormRef.current?.present(), 300);
        }}
        onEdit={(action) => {
          quickActionsRef.current?.dismiss();
          setTimeout(() => {
            quickActionFormRef.current?.present({
              id: action.id,
              title: action.title,
              prompt: action.prompt,
              workspaceAgentId: action.workspaceAgentId,
            });
          }, 300);
        }}
      />

      {/* Workspace Picker Bottom Sheet */}
      <WorkspacePickerSheet
        ref={workspacePickerRef}
        subAgents={subAgents}
        selectedIds={selectedWorkspaces.map((w) => w.id)}
        onToggle={(agent) => {
          setSelectedWorkspaces((prev) => {
            const exists = prev.find((w) => w.id === agent.id);
            if (exists) return prev.filter((w) => w.id !== agent.id);
            return [...prev, { id: agent.id, name: agent.name }];
          });
        }}
      />

      {/* Quick Action Add/Edit Form */}
      <QuickActionFormSheet
        ref={quickActionFormRef}
        subAgents={subAgents}
        onSave={async (data: QuickActionFormData) => {
          const wsId = data.workspaceAgentId ?? null;
          if (data.id) {
            await executeUpdateQA({ id: data.id, input: { title: data.title, prompt: data.prompt, workspaceAgentId: wsId } });
          } else {
            await executeCreateQA({ input: { tenantId: tenantId!, title: data.title, prompt: data.prompt, workspaceAgentId: wsId } });
          }
          reexecuteQA({ requestPolicy: "network-only" });
        }}
        onDelete={(id) => {
          executeDeleteQA({ id }).then(() => reexecuteQA({ requestPolicy: "network-only" }));
        }}
      />

    </KeyboardAvoidingView>
  );
}
