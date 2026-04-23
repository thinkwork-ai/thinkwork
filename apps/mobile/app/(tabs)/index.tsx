import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { View, FlatList, RefreshControl, Pressable, Platform, KeyboardAvoidingView, Keyboard, Alert, AppState } from "react-native";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import {
  useAgents,
  useCreateThread,
  useSendMessage,
  useThreadTurnUpdatedSubscription,
  useThreadUpdatedSubscription,
  useUpdateThread,
} from "@thinkwork/react-native-sdk";
import { useTurnCompletion } from "@/lib/hooks/use-turn-completion";
import { useMe } from "@/lib/hooks/use-users";
import { useQuery } from "urql";
// AgentWorkspacesQuery isn't in the SDK (host-domain concern), so keep it
// here. ThreadsQuery stays local because the dashboard accesses richer
// fields (`description`, `assignee { id name }`, `labels`, `metadata`,
// `dueAt`, etc.) than the chat-oriented SDK surface exposes on `Thread`.
import { ThreadsQuery, AgentWorkspacesQuery } from "@/lib/graphql-queries";
import { TabHeader } from "@/components/layout/tab-header";
import { WebContent } from "@/components/layout/web-content";
import { AgentPicker } from "@/components/chat/AgentPicker";
import { ThreadFilterBar, type ThreadFilters } from "@/components/threads/ThreadFilterBar";
import { ThreadRow } from "@/components/threads/ThreadRow";
import { Muted, Text } from "@/components/ui/typography";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { COLORS } from "@/lib/theme";
import { ListTodo, Bot, Settings, LogOut, RefreshCw, Filter, ChevronDown, ChevronRight, X, Zap, Check, CheckSquare, ListChecks, Circle, AlertCircle, Clock, Lock, CreditCard } from "lucide-react-native";
import { IconTopologyStar3, IconList, IconLetterCase } from "@tabler/icons-react-native";
import { ThreadChannel } from "@/lib/gql/graphql";
import { HeaderContextMenu } from "@/components/ui/header-context-menu";
import { useThreadReadState } from "@/lib/hooks/use-thread-read-state";
import { MessageInputFooter, type MessageInputFooterRef, type SelectedWorkspace } from "@/components/input/MessageInputFooter";
import { CaptureFooter } from "@/components/wiki/CaptureFooter";
import { WikiList } from "@/components/wiki/WikiList";
import { WikiGraphView } from "@/components/wiki/graph";
import { Inter_500Medium, useFonts } from "@expo-google-fonts/inter";
import { ToastHost } from "@/components/ui/toast";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QuickActionsSheet, type QuickActionsSheetRef } from "@/components/chat/QuickActionsSheet";
import { QuickActionFormSheet, type QuickActionFormSheetRef, type QuickActionFormData } from "@/components/chat/QuickActionFormSheet";
import { WorkspacePickerSheet, type WorkspacePickerSheetRef, type SubAgent } from "@/components/input/WorkspacePickerSheet";
import { useQuickActions, useCreateQuickAction, useUpdateQuickAction, useDeleteQuickAction, type QuickAction } from "@/lib/hooks/use-quick-actions";
import { getThreadHeaderLabel } from "@/lib/thread-display";

function resolveApiUrl(): string {
  const fromExtra =
    (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
    "";
  const fromEnv = process.env.EXPO_PUBLIC_API_URL ?? "";
  return (fromExtra || fromEnv || "https://api.thinkwork.ai").replace(/\/$/, "");
}

export default function ThreadsScreen() {
  const router = useRouter();
  const { user, refreshCounter, signOut, getToken } = useAuth();
  const tenantId = user?.tenantId;

  // Role gate for owner-only menu items (Billing). One-shot fetch on mount —
  // role doesn't change while a session is alive.
  const [callerRole, setCallerRole] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken?.();
        if (!token) return;
        const res = await fetch(`${resolveApiUrl()}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { role?: string | null };
        if (!cancelled) setCallerRole(data.role ?? null);
      } catch {
        /* silent; Billing menu item just stays hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);
  const isOwner = callerRole === "owner";
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();
  const { isWide } = useMediaQuery();
  const { markRead, isUnread } = useThreadReadState();
  const { hasNewCompletion, isThreadActive, markThreadActive, clearThreadActive, activeTriggers } = useTurnCompletion(tenantId);

  // ── Agents + Me ──────────────────────────────────────────────────────────
  const { agents, loading: agentsFetching } = useAgents({ tenantId });

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
      const headerLabel = getThreadHeaderLabel(thread);
      router.push({ pathname: `/thread/${thread.id}`, params: headerLabel ? { title: headerLabel } : {} });
      // Reset after navigation settles
      setTimeout(() => { navigatingRef.current = false; }, 500);
    }, 0);
  }, [router, markRead]);

  // ── Tabs: Threads | Wiki ─────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"threads" | "wiki">("threads");

  // ── New thread / memory input ────────────────────────────────────────
  // Each tab keeps its own draft text so switching tabs doesn't leak a
  // half-typed thread into a memory submit (or vice versa).
  const [newThreadText, setNewThreadText] = useState("");
  const quickActionsRef = useRef<QuickActionsSheetRef>(null);
  const quickActionFormRef = useRef<QuickActionFormSheetRef>(null);
  const workspacePickerRef = useRef<WorkspacePickerSheetRef>(null);
  const messageInputRef = useRef<MessageInputFooterRef>(null);
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<SelectedWorkspace[]>([]);

  // One-time cleanup: earlier builds persisted an offline capture queue
  // at this key. We removed that surface entirely, so purge any leftover
  // sync_pending entries so they stop hanging around on the device.
  useEffect(() => {
    void AsyncStorage.removeItem("thinkwork:capture-queue:v1").catch(() => {});
  }, []);

  // Wiki-tab search: the footer only emits on explicit submit
  // (Enter or send tap), so no debounce layer is needed here.
  const [wikiQuery, setWikiQuery] = useState("");
  // Wiki tab: list (table rows) ↔ graph (force-directed view)
  const [wikiViewMode, setWikiViewMode] = useState<"list" | "graph">("list");
  // Wiki graph view: when on, render node titles + use a label-friendly
  // force layout (longer links, more repulsion) so titles don't overlap.
  // In-session only; cold app launches start with labels off.
  const [wikiShowLabels, setWikiShowLabels] = useState(false);
  // Skia text rendering needs an Inter SkFont — load once for the lifetime of the tab.
  const [wikiFontsLoaded] = useFonts({ Inter: Inter_500Medium });

  // ── Quick Actions (per-user, per-scope, from DB) ──────────────────────
  const [{ data: qaThreadData }, reexecuteQAThread] = useQuickActions(tenantId, "thread");
  const threadQuickActions: QuickAction[] = (qaThreadData?.userQuickActions ?? []) as QuickAction[];
  const activeQuickActions = threadQuickActions;
  const reexecuteActiveQA = reexecuteQAThread;
  const qaFormScope: "thread" = "thread";
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
  const createThread = useCreateThread();
  const sendMessage = useSendMessage();
  const executeUpdateThread = useUpdateThread();

  const handleArchive = useCallback(async (threadId: string): Promise<boolean> => {
    console.log("[Archive] Starting archive for thread:", threadId);
    try {
      await executeUpdateThread(threadId, { archivedAt: new Date().toISOString() });
    } catch (e: any) {
      console.error("[Archive] Failed:", e?.message);
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
      // Atomic create + first user message (SDK 0.2.0-beta.0+).
      const newThread = await createThread({
        tenantId,
        agentId: activeAgent.id,
        title: text.length > 60 ? text.slice(0, 60) + "..." : text,
        type: "TASK",
        channel: "CHAT",
        createdByType: "user",
        createdById: currentUser?.id || user?.sub,
        firstMessage: messageContent,
        ...(metadata ? ({ metadata } as any) : {}),
      });

      console.log("[Threads] Thread created:", newThread.id);
      markRead(newThread.id);
      markThreadActive(newThread.id);

      // Refresh thread list so the new thread appears on the home page
      reexecute({ requestPolicy: "network-only" });
    } catch (e: any) {
      console.error("[Threads] Failed to create thread:", e);
      Alert.alert("Error", `Failed to create thread: ${e?.message ?? "unknown"}`);
    }
  }, [newThreadText, selectedWorkspaces, activeAgent?.id, tenantId, currentUser?.id, createThread, reexecute, markRead, markThreadActive, user?.sub]);

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
        <View style={{ paddingTop: insets.top }} className="bg-white dark:bg-neutral-950">
          <View className="flex-row items-center justify-between px-4" style={{ height: 48 }}>
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

            {/* Right: Wiki-tab view toggle + Filter + Menu */}
            <View className="flex-row items-center gap-3">
            {activeTab === "wiki" && wikiViewMode === "graph" ? (
              <Pressable
                onPress={() => setWikiShowLabels((s) => !s)}
                className="p-2"
                accessibilityRole="button"
                accessibilityLabel={wikiShowLabels ? "Hide labels" : "Show labels"}
              >
                <IconLetterCase
                  size={22}
                  color={wikiShowLabels ? colors.primary : colors.foreground}
                  strokeWidth={2}
                />
              </Pressable>
            ) : null}
            {activeTab === "wiki" ? (
              <Pressable
                onPress={() => setWikiViewMode((m) => (m === "list" ? "graph" : "list"))}
                className="p-2"
                accessibilityRole="button"
                accessibilityLabel={
                  wikiViewMode === "list"
                    ? "Switch to graph view"
                    : "Switch to list view"
                }
              >
                {wikiViewMode === "graph" ? (
                  <IconList size={22} color={colors.foreground} strokeWidth={2} />
                ) : (
                  <IconTopologyStar3
                    size={22}
                    color={colors.foreground}
                    strokeWidth={2}
                  />
                )}
              </Pressable>
            ) : null}
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
                { label: "Credential Locker", icon: Lock, onPress: () => router.push("/settings/credentials") },
                { label: "User Settings", icon: Settings, onPress: () => router.push("/settings/user-settings") },
                ...(isOwner ? [{ label: "Billing", icon: CreditCard, onPress: () => router.push("/settings/billing") }] : []),
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

      {/* Threads / Wiki segmented control */}
      <View
        className="border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 items-center justify-center"
        style={{ height: 52, paddingBottom: 8 }}
      >
        <View className="flex-row rounded-full bg-neutral-200 dark:bg-neutral-800" style={{ padding: 2 }}>
          <Pressable
            onPress={() => setActiveTab("threads")}
            className="flex-row items-center justify-center gap-1.5 rounded-full"
            style={{
              minWidth: 96,
              paddingHorizontal: 16,
              paddingVertical: 5,
              backgroundColor: activeTab === "threads" ? (isDark ? "#525252" : "#ffffff") : "transparent",
            }}
          >
            <Text className="text-sm font-semibold" style={{ color: activeTab === "threads" ? colors.foreground : colors.mutedForeground }}>Threads</Text>
            {(() => {
              const unreadCount = filteredThreads.filter((t: any) => isUnread(t.id, t.lastTurnCompletedAt || t.createdAt, t.lastReadAt)).length;
              return unreadCount > 0 ? (
                <View className="rounded-full min-w-[18px] h-[18px] items-center justify-center px-1" style={{ backgroundColor: activeTab === "threads" ? colors.primary : (isDark ? "#404040" : "#d4d4d4") }}>
                  <Text style={{ color: activeTab === "threads" ? (isDark ? "#000" : "#fff") : colors.mutedForeground, fontSize: 10, fontWeight: "700" }}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
                </View>
              ) : null;
            })()}
          </Pressable>
          <Pressable
            onPress={() => setActiveTab("wiki")}
            className="flex-row items-center justify-center gap-1.5 rounded-full"
            style={{
              minWidth: 96,
              paddingHorizontal: 16,
              paddingVertical: 5,
              backgroundColor: activeTab === "wiki" ? (isDark ? "#525252" : "#ffffff") : "transparent",
            }}
          >
            <Text className="text-sm font-semibold" style={{ color: activeTab === "wiki" ? colors.foreground : colors.mutedForeground }}>Wiki</Text>
          </Pressable>
        </View>
      </View>

      <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <WebContent>
        {activeTab === "threads" && filtersOpen && (
          <ThreadFilterBar filters={filters} onFiltersChange={setFilters} />
        )}

        {activeTab === "threads" ? (
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
        ) : wikiViewMode === "graph" && tenantId && activeAgent?.id && wikiFontsLoaded ? (
          <WikiGraphView
            tenantId={tenantId}
            agentId={activeAgent.id}
            searchQuery={wikiQuery}
            showLabels={wikiShowLabels}
          />
        ) : (
          <WikiList
            agentId={activeAgent?.id}
            colors={colors}
            searchQuery={wikiQuery}
          />
        )}
      </WebContent>
      </View>

      <View>
        {activeTab === "threads" ? (
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
        ) : (
          <CaptureFooter
            agentId={activeAgent?.id}
            agentName={activeAgent?.name}
            tenantId={tenantId}
            colors={colors}
            isDark={isDark}
            onSearchQueryChange={setWikiQuery}
          />
        )}
      </View>

      <QuickActionsSheet
        ref={quickActionsRef}
        actions={activeQuickActions}
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

      <QuickActionFormSheet
        ref={quickActionFormRef}
        subAgents={subAgents}
        onSave={async (data: QuickActionFormData) => {
          const wsId = data.workspaceAgentId ?? null;
          if (data.id) {
            await executeUpdateQA({
              id: data.id,
              input: { title: data.title, prompt: data.prompt, workspaceAgentId: wsId },
            });
          } else {
            await executeCreateQA({
              input: {
                tenantId: tenantId!,
                title: data.title,
                prompt: data.prompt,
                workspaceAgentId: wsId,
                scope: qaFormScope,
              },
            });
          }
          reexecuteQAThread({ requestPolicy: "network-only" });
        }}
        onDelete={(id) => {
          executeDeleteQA({ id }).then(() => {
            reexecuteQAThread({ requestPolicy: "network-only" });
          });
        }}
      />

      {activeTab === "wiki" ? <ToastHost bottomOffset={96} /> : null}

    </KeyboardAvoidingView>
  );
}
