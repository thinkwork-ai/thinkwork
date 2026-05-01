import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  View,
  FlatList,
  RefreshControl,
  Pressable,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
  Alert,
  AppState,
} from "react-native";
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
  type ContextProviderStatus,
} from "@thinkwork/react-native-sdk";
import { useTurnCompletion } from "@/lib/hooks/use-turn-completion";
import { useMe } from "@/lib/hooks/use-users";
import { useQuery } from "urql";
// AgentWorkspacesQuery isn't in the SDK (host-domain concern), so keep it
// here. ThreadsQuery stays local because the dashboard accesses richer
// fields (`description`, `assignee { id name }`, `labels`, `metadata`,
// `dueAt`, etc.) than the chat-oriented SDK surface exposes on `Thread`.
import {
  ThreadsQuery,
  AgentWorkspacesQuery,
  AgentWorkspaceReviewsQuery,
} from "@/lib/graphql-queries";
import { TabHeader } from "@/components/layout/tab-header";
import { WebContent } from "@/components/layout/web-content";
import { AgentPicker } from "@/components/chat/AgentPicker";
import {
  ThreadFilterBar,
  type ThreadFilters,
} from "@/components/threads/ThreadFilterBar";
import { ThreadRow } from "@/components/threads/ThreadRow";
import { Muted, Text } from "@/components/ui/typography";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { COLORS } from "@/lib/theme";
import {
  ListTodo,
  Bot,
  Settings,
  LogOut,
  RefreshCw,
  Filter,
  ChevronDown,
  Zap,
  Lock,
  CreditCard,
  DatabaseZap,
} from "lucide-react-native";
import {
  IconLetterCase,
} from "@tabler/icons-react-native";
import { ThreadChannel } from "@/lib/gql/graphql";
import { HeaderContextMenu } from "@/components/ui/header-context-menu";
import { useThreadReadState } from "@/lib/hooks/use-thread-read-state";
import {
  MessageInputFooter,
  type MessageInputFooterRef,
  type SelectedWorkspace,
} from "@/components/input/MessageInputFooter";
import { CaptureFooter } from "@/components/wiki/CaptureFooter";
import { BrainSearchSurface } from "@/components/brain/BrainSearchSurface";
import { BrainProviderStatusSheet } from "@/components/brain/BrainProviderStatusSheet";
import type { BrainMode } from "@/components/brain/types";
import { Inter_500Medium, useFonts } from "@expo-google-fonts/inter";
import { ToastHost } from "@/components/ui/toast";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  QuickActionsSheet,
  type QuickActionsSheetRef,
} from "@/components/chat/QuickActionsSheet";
import {
  QuickActionFormSheet,
  type QuickActionFormSheetRef,
  type QuickActionFormData,
} from "@/components/chat/QuickActionFormSheet";
import {
  WorkspacePickerSheet,
  type WorkspacePickerSheetRef,
  type SubAgent,
} from "@/components/input/WorkspacePickerSheet";
import {
  useQuickActions,
  useCreateQuickAction,
  useUpdateQuickAction,
  useDeleteQuickAction,
  type QuickAction,
} from "@/lib/hooks/use-quick-actions";
import { getThreadHeaderLabel } from "@/lib/thread-display";
import {
  hitlThreadPreview,
  pendingHitlByThreadId,
  sortThreadsWithHitlFirst,
  subAgentReviewPreview,
  threadTabBadgeState,
} from "@/lib/thread-hitl-state";

function resolveApiUrl(): string {
  const fromExtra =
    (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
    "";
  const fromEnv = process.env.EXPO_PUBLIC_API_URL ?? "";
  return (fromExtra || fromEnv || "https://api.thinkwork.ai").replace(
    /\/$/,
    "",
  );
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
  const {
    hasNewCompletion,
    isThreadActive,
    markThreadActive,
    clearThreadActive,
    activeTriggers,
  } = useTurnCompletion(tenantId);

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
    return (
      visibleAgents.find((a: any) => a.role === "team") ?? visibleAgents[0]
    );
  }, [visibleAgents, selectedAgentId]);

  const agentNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of agents as any[]) {
      map[a.id] = a.name || "Agent";
    }
    return map;
  }, [agents]);

  // Set of agents directly paired to the calling user. Reviews whose
  // `run.agentId` is NOT in this set surfaced through the parent-chain walk
  // (i.e. a sub-agent of one of the user's owned agents) and get a
  // sub-agent-specific label below.
  const pairedAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const a of agents as any[]) {
      if (a?.id) ids.add(a.id as string);
    }
    return ids;
  }, [agents]);

  // ── Thread filters + query (scoped to active agent) ────────────────────
  const [filters, setFilters] = useState<ThreadFilters>({
    channels: [],
    agentId: "",
    showArchived: false,
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const hasActiveFilters = filters.channels.length > 0 || filters.showArchived;

  // Only apply filters when the filter panel is open
  const appliedFilters = filtersOpen
    ? filters
    : ({ channels: [], agentId: "", showArchived: false } as ThreadFilters);

  // Use agent from filter, or fall back to active agent from header picker
  const effectiveAgentId = appliedFilters.agentId || activeAgent?.id;

  const queryVars = useMemo(() => {
    const vars: any = { tenantId: tenantId! };
    if (effectiveAgentId) vars.agentId = effectiveAgentId;
    return vars;
  }, [tenantId, effectiveAgentId]);

  const [{ data: threadsData }, reexecute] = useQuery({
    query: ThreadsQuery,
    variables: queryVars,
    pause: !tenantId || !effectiveAgentId,
  });
  // Scope reviews to the calling user. The resolver chain-walks
  // `parent_agent_id` so this also surfaces sub-agent reviews routed via the
  // user's owned-agent chain (covers AE2). Pause until both `tenantId` and
  // the resolved user id are known — otherwise we'd briefly issue an
  // unscoped query and leak other users' reviews on first paint.
  const callerUserId = currentUser?.id ?? null;
  const [{ data: reviewsData }, reexecuteReviews] = useQuery({
    query: AgentWorkspaceReviewsQuery,
    variables: {
      tenantId: tenantId!,
      responsibleUserId: callerUserId!,
      status: "awaiting_review",
      limit: 50,
    },
    pause: !tenantId || !callerUserId,
  });

  const pendingReviewsByThreadId = useMemo(
    () =>
      pendingHitlByThreadId(
        (reviewsData?.agentWorkspaceReviews ?? []) as any[],
      ),
    [reviewsData?.agentWorkspaceReviews],
  );

  // Polling fallback — refetch every 15s, but only while app is in foreground
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      appStateRef.current = s;
    });
    const interval = setInterval(() => {
      if (appStateRef.current === "active") {
        reexecute({ requestPolicy: "network-only" });
        reexecuteReviews({ requestPolicy: "network-only" });
      }
    }, 15000);
    return () => {
      sub.remove();
      clearInterval(interval);
    };
  }, [reexecute, reexecuteReviews]);

  // Re-fetch when app returns to foreground after token refresh
  useEffect(() => {
    if (refreshCounter > 0) {
      reexecute({ requestPolicy: "network-only" });
      reexecuteReviews({ requestPolicy: "network-only" });
    }
  }, [refreshCounter, reexecute, reexecuteReviews]);

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
      reexecuteReviews({ requestPolicy: "network-only" });
    }
  }, [threadEvent, reexecute, reexecuteReviews]);

  // Re-fetch when a turn completes (succeeded/failed)
  useEffect(() => {
    if (hasNewCompletion) {
      reexecute({ requestPolicy: "network-only" });
      reexecuteReviews({ requestPolicy: "network-only" });
    }
  }, [hasNewCompletion, reexecute, reexecuteReviews]);

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
      threads = threads.filter(
        (t: any) => !t.archivedAt && !archivedIds.has(t.id),
      );
    }
    // Multi-channel filter
    if (appliedFilters.channels.length > 0) {
      const set = new Set(appliedFilters.channels);
      threads = threads.filter((t: any) =>
        set.has((t.channel || t.type || "").toUpperCase()),
      );
    }
    return sortThreadsWithHitlFirst(
      threads,
      pendingReviewsByThreadId,
      (thread: any) => thread.lastTurnCompletedAt || thread.createdAt,
    );
  }, [
    threadsData?.threads,
    appliedFilters.channels,
    appliedFilters.showArchived,
    activeAgent?.id,
    archivedIds,
    pendingReviewsByThreadId,
  ]);

  const threadBadge = useMemo(
    () =>
      threadTabBadgeState(
        filteredThreads as { id: string }[],
        pendingReviewsByThreadId,
        (thread) =>
          isUnread(
            thread.id,
            (thread as any).lastTurnCompletedAt || (thread as any).createdAt,
            (thread as any).lastReadAt,
          ),
      ),
    [filteredThreads, pendingReviewsByThreadId, isUnread],
  );

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    reexecute({ requestPolicy: "network-only" });
    reexecuteReviews({ requestPolicy: "network-only" });
    setTimeout(() => setRefreshing(false), 500);
  }, [reexecute, reexecuteReviews]);

  // ── Thread press → router push ─────────────────────────────────────────
  const navigatingRef = useRef(false);
  const handleThreadPress = useCallback(
    (thread: any) => {
      if (navigatingRef.current) return;
      navigatingRef.current = true;
      markRead(thread.id);
      setTimeout(() => {
        const headerLabel = getThreadHeaderLabel(thread);
        router.push({
          pathname: `/thread/${thread.id}`,
          params: headerLabel ? { title: headerLabel } : {},
        });
        // Reset after navigation settles
        setTimeout(() => {
          navigatingRef.current = false;
        }, 500);
      }, 0);
    },
    [router, markRead],
  );

  // ── Tabs: Threads | Brain ────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"threads" | "brain">("threads");

  // ── New thread / memory input ────────────────────────────────────────
  // Each tab keeps its own draft text so switching tabs doesn't leak a
  // half-typed thread into a memory submit (or vice versa).
  const [newThreadText, setNewThreadText] = useState("");
  const quickActionsRef = useRef<QuickActionsSheetRef>(null);
  const quickActionFormRef = useRef<QuickActionFormSheetRef>(null);
  const workspacePickerRef = useRef<WorkspacePickerSheetRef>(null);
  const messageInputRef = useRef<MessageInputFooterRef>(null);
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<
    SelectedWorkspace[]
  >([]);

  // One-time cleanup: earlier builds persisted an offline capture queue
  // at this key. We removed that surface entirely, so purge any leftover
  // sync_pending entries so they stop hanging around on the device.
  useEffect(() => {
    void AsyncStorage.removeItem("thinkwork:capture-queue:v1").catch(() => {});
  }, []);

  // Brain-tab search: the footer only emits on explicit submit
  // (Enter or send tap), so no debounce layer is needed here.
  const [brainQuery, setBrainQuery] = useState("");
  const [brainSearchQuery, setBrainSearchQuery] = useState("");
  const [brainMode, setBrainMode] = useState<BrainMode>("pages");
  const [brainProviders, setBrainProviders] = useState<ContextProviderStatus[]>(
    [],
  );
  const [brainProvidersVisible, setBrainProvidersVisible] = useState(false);
  // Brain graph view: when on, render node titles + use a label-friendly
  // force layout (longer links, more repulsion) so titles don't overlap.
  // In-session only; cold app launches start with labels off.
  const [brainShowLabels, setBrainShowLabels] = useState(false);
  // Skia text rendering needs an Inter SkFont — load once for the lifetime of the tab.
  const [brainFontsLoaded] = useFonts({ Inter: Inter_500Medium });

  const handleBrainQueryChange = useCallback(
    (next: string) => {
      setBrainQuery(next);
      if (brainMode === "search") {
        setBrainSearchQuery(next);
      } else if (!next.trim()) {
        setBrainSearchQuery("");
      }
    },
    [brainMode],
  );

  const handleBrainModeChange = useCallback((nextMode: BrainMode) => {
    setBrainMode(nextMode);
    if (nextMode !== "search") {
      setBrainSearchQuery("");
    }
  }, []);

  // ── Quick Actions (per-user, per-scope, from DB) ──────────────────────
  const [{ data: qaThreadData }, reexecuteQAThread] = useQuickActions(
    tenantId,
    "thread",
  );
  const threadQuickActions: QuickAction[] = (qaThreadData?.userQuickActions ??
    []) as QuickAction[];
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

  const handleArchive = useCallback(
    async (threadId: string): Promise<boolean> => {
      console.log("[Archive] Starting archive for thread:", threadId);
      try {
        await executeUpdateThread(threadId, {
          archivedAt: new Date().toISOString(),
        });
      } catch (e: any) {
        console.error("[Archive] Failed:", e?.message);
        return false;
      }
      setArchivedIds((prev) => new Set(prev).add(threadId));
      return true;
    },
    [executeUpdateThread],
  );

  const handleCreateThread = useCallback(
    async (overrideText?: string, overrideWorkspaces?: SelectedWorkspace[]) => {
      const text = (overrideText ?? newThreadText).trim();
      const workspaces = overrideWorkspaces ?? selectedWorkspaces;
      console.log("[handleCreateThread]", {
        text: text.slice(0, 20),
        agentId: activeAgent?.id,
        tenantId,
        userId: currentUser?.id,
        workspaceCount: workspaces.length,
      });
      if (!text || !activeAgent?.id || !tenantId) {
        console.warn("[handleCreateThread] Bailed — missing:", {
          text: !!text,
          agentId: !!activeAgent?.id,
          tenantId: !!tenantId,
        });
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
      const metadata =
        workspaces.length > 0
          ? JSON.stringify({ workspaceAgentIds: workspaces.map((w) => w.id) })
          : undefined;

      try {
        // Atomic create + first user message (SDK 0.2.0-beta.0+).
        const newThread = await createThread({
          tenantId,
          agentId: activeAgent.id,
          title: text.length > 60 ? text.slice(0, 60) + "..." : text,
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
        Alert.alert(
          "Error",
          `Failed to create thread: ${e?.message ?? "unknown"}`,
        );
      }
    },
    [
      newThreadText,
      selectedWorkspaces,
      activeAgent?.id,
      tenantId,
      currentUser?.id,
      createThread,
      reexecute,
      markRead,
      markThreadActive,
      user?.sub,
    ],
  );

  // ── Render ─────────────────────────────────────────────────────────────
  const agentDisplayName = activeAgent?.name || (agentsFetching ? "" : "Agent");
  const pickerAgents = visibleAgents.map((a: any) => ({ ...a, _id: a.id }));
  const brainProviderErrors = brainProviders.filter((provider) =>
    ["error", "timeout"].includes(provider.state),
  ).length;

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
        <View
          style={{ paddingTop: insets.top }}
          className="bg-white dark:bg-neutral-950"
        >
          <View
            className="flex-row items-center justify-between px-4"
            style={{ height: 48 }}
          >
            {/* Left: Agent name + picker */}
            <AgentPicker
              agents={pickerAgents}
              selectedId={activeAgent?.id ?? ""}
              onSelect={(a: any) => setSelectedAgentId(a._id ?? a.id)}
            >
              <View className="flex-row items-center gap-1.5">
                <Text size="xl" weight="bold">
                  {agentDisplayName}
                </Text>
                <ChevronDown size={18} color={colors.foreground} />
              </View>
            </AgentPicker>

            {/* Right: Brain graph labels + Filter + Menu */}
            <View className="flex-row items-center gap-3">
              {activeTab === "brain" && brainMode === "graph" ? (
                <Pressable
                  onPress={() => setBrainShowLabels((s) => !s)}
                  className="p-2"
                  accessibilityRole="button"
                  accessibilityLabel={
                    brainShowLabels ? "Hide labels" : "Show labels"
                  }
                >
                  <IconLetterCase
                    size={22}
                    color={brainShowLabels ? colors.primary : colors.foreground}
                    strokeWidth={2}
                  />
                </Pressable>
              ) : null}
              {activeTab === "brain" &&
              brainMode === "search" &&
              brainProviders.length > 0 ? (
                <Pressable
                  onPress={() => setBrainProvidersVisible(true)}
                  className="p-2 relative"
                  accessibilityRole="button"
                  accessibilityLabel="Brain providers"
                >
                  <DatabaseZap
                    size={22}
                    color={
                      brainProviderErrors > 0
                        ? colors.destructive
                        : colors.foreground
                    }
                  />
                  {brainProviderErrors > 0 ? (
                    <View
                      className="absolute top-1 right-1 w-2 h-2 rounded-full"
                      style={{ backgroundColor: colors.destructive }}
                    />
                  ) : null}
                </Pressable>
              ) : null}
              {activeTab === "threads" ? (
                <Pressable
                  onPress={() => setFiltersOpen((o) => !o)}
                  className="p-2 relative"
                >
                  <Filter
                    size={22}
                    color={
                      filtersOpen && hasActiveFilters
                        ? colors.primary
                        : colors.foreground
                    }
                  />
                  {filtersOpen && hasActiveFilters && (
                    <View
                      className="absolute top-1 right-1 w-2 h-2 rounded-full"
                      style={{ backgroundColor: colors.primary }}
                    />
                  )}
                </Pressable>
              ) : null}
              <HeaderContextMenu
                items={[
                  {
                    label: "Agent Config",
                    icon: Bot,
                    onPress: () => router.push("/settings/agent-config"),
                  },
                  {
                    label: "Automations",
                    icon: Zap,
                    onPress: () => router.push("/settings/automations"),
                  },
                  {
                    label: "Credential Locker",
                    icon: Lock,
                    onPress: () => router.push("/settings/credentials"),
                  },
                  {
                    label: "User Settings",
                    icon: Settings,
                    onPress: () => router.push("/settings/user-settings"),
                  },
                  ...(isOwner
                    ? [
                        {
                          label: "Billing",
                          icon: CreditCard,
                          onPress: () => router.push("/settings/billing"),
                        },
                      ]
                    : []),
                  ...(Platform.OS !== "web"
                    ? [
                        {
                          label: "Update App",
                          icon: RefreshCw,
                          onPress: async () => {
                            try {
                              const update =
                                await Updates.checkForUpdateAsync();
                              if (update.isAvailable) {
                                await Updates.fetchUpdateAsync();
                                Alert.alert("Update Ready", "Restart now?", [
                                  { text: "Later", style: "cancel" },
                                  {
                                    text: "Restart",
                                    onPress: () => Updates.reloadAsync(),
                                  },
                                ]);
                              } else {
                                Alert.alert(
                                  "Up to Date",
                                  "You're on the latest version.",
                                );
                              }
                            } catch {
                              Alert.alert(
                                "Error",
                                "Failed to check for updates.",
                              );
                            }
                          },
                        },
                      ]
                    : []),
                  {
                    label: "Sign Out",
                    icon: LogOut,
                    destructive: true,
                    separator: true,
                    onPress: () => {
                      signOut();
                      router.replace("/");
                    },
                  },
                ]}
              />
            </View>
          </View>
        </View>
      )}

      {/* Threads / Brain segmented control */}
      <View
        className="border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 items-center justify-center"
        style={{ height: 52, paddingBottom: 8 }}
      >
        <View
          className="flex-row rounded-full bg-neutral-200 dark:bg-neutral-800"
          style={{ padding: 2 }}
        >
          <Pressable
            onPress={() => setActiveTab("threads")}
            className="flex-row items-center justify-center gap-1.5 rounded-full"
            style={{
              minWidth: 96,
              paddingHorizontal: 16,
              paddingVertical: 5,
              backgroundColor:
                activeTab === "threads"
                  ? isDark
                    ? "#525252"
                    : "#ffffff"
                  : "transparent",
            }}
          >
            <Text
              className="text-sm font-semibold"
              style={{
                color:
                  activeTab === "threads"
                    ? colors.foreground
                    : colors.mutedForeground,
              }}
            >
              Threads
            </Text>
            {threadBadge ? (
              <View
                className="rounded-full min-w-[18px] h-[18px] items-center justify-center px-1"
                style={{
                  backgroundColor:
                    threadBadge.kind === "hitl"
                      ? "#f59e0b"
                      : activeTab === "threads"
                        ? colors.primary
                        : isDark
                          ? "#404040"
                          : "#d4d4d4",
                }}
              >
                <Text
                  style={{
                    color:
                      threadBadge.kind === "hitl"
                        ? "#111827"
                        : activeTab === "threads"
                          ? isDark
                            ? "#000"
                            : "#fff"
                          : colors.mutedForeground,
                    fontSize: 10,
                    fontWeight: "700",
                  }}
                >
                  {threadBadge.count > 99 ? "99+" : threadBadge.count}
                </Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            onPress={() => setActiveTab("brain")}
            className="flex-row items-center justify-center gap-1.5 rounded-full"
            style={{
              minWidth: 96,
              paddingHorizontal: 16,
              paddingVertical: 5,
              backgroundColor:
                activeTab === "brain"
                  ? isDark
                    ? "#525252"
                    : "#ffffff"
                  : "transparent",
            }}
          >
            <Text
              className="text-sm font-semibold"
              style={{
                color:
                  activeTab === "brain"
                    ? colors.foreground
                    : colors.mutedForeground,
              }}
            >
              Memories
            </Text>
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
                  isUnread={isUnread(
                    item.id,
                    item.lastTurnCompletedAt || item.createdAt,
                    item.lastReadAt,
                  )}
                  needsHitl={pendingReviewsByThreadId.has(item.id)}
                  hitlPreview={
                    subAgentReviewPreview(
                      pendingReviewsByThreadId.get(item.id),
                      { pairedAgentIds, agentNames },
                    ) ??
                    hitlThreadPreview(pendingReviewsByThreadId.get(item.id))
                  }
                  isActive={isThreadActive(item.id)}
                  onArchive={handleArchive}
                  onPress={() => handleThreadPress(item)}
                />
              )}
              ItemSeparatorComponent={() => (
                <View
                  className="h-px bg-neutral-200 dark:bg-neutral-800"
                  style={{ marginLeft: 68 }}
                />
              )}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                  tintColor={colors.primary}
                />
              }
              scrollEnabled={filteredThreads.length > 0}
              ListEmptyComponent={
                <View className="items-center gap-2">
                  <ListTodo size={32} color={colors.mutedForeground} />
                  <Muted>No threads found</Muted>
                </View>
              }
              contentContainerStyle={
                filteredThreads.length === 0
                  ? { flexGrow: 1, justifyContent: "center" }
                  : { paddingTop: 8 }
              }
            />
          ) : (
            <BrainSearchSurface
              apiBaseUrl={resolveApiUrl()}
              mode={brainMode}
              query={brainMode === "search" ? brainSearchQuery : brainQuery}
              tenantId={tenantId}
              userId={currentUser?.id}
              agentId={activeAgent?.id}
              getToken={getToken}
              colors={colors}
              graphFontsLoaded={brainFontsLoaded}
              graphShowLabels={brainShowLabels}
              onProviderStatusesChange={setBrainProviders}
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
            onQuickActions={() => {
              Keyboard.dismiss();
              quickActionsRef.current?.present();
            }}
            onPlusPress={() => {
              Keyboard.dismiss();
              workspacePickerRef.current?.present();
            }}
            selectedWorkspaces={selectedWorkspaces}
            onRemoveWorkspace={(id) =>
              setSelectedWorkspaces((prev) => prev.filter((w) => w.id !== id))
            }
          />
        ) : activeTab === "brain" ? (
          <CaptureFooter
            agentId={activeAgent?.id}
            userId={currentUser?.id}
            agentName={activeAgent?.name}
            tenantId={tenantId}
            colors={colors}
            isDark={isDark}
            searchPlaceholder={
              brainMode === "pages"
                ? "Search Pages..."
                : brainMode === "graph"
                  ? "Search Graph..."
                  : "Search Brain..."
            }
            onSearchQueryChange={handleBrainQueryChange}
            brainMode={brainMode}
            onBrainModeChange={handleBrainModeChange}
          />
        ) : null}
      </View>

      <QuickActionsSheet
        ref={quickActionsRef}
        actions={activeQuickActions}
        subAgentNames={subAgentNames}
        onSelect={(action) => {
          quickActionsRef.current?.dismiss();
          setNewThreadText(action.prompt);
          if (
            action.workspaceAgentId &&
            subAgentNames[action.workspaceAgentId]
          ) {
            const slug =
              agentIdToSlug[action.workspaceAgentId] ?? action.workspaceAgentId;
            setSelectedWorkspaces([
              { id: slug, name: subAgentNames[action.workspaceAgentId] },
            ]);
          }
          setTimeout(() => messageInputRef.current?.focus(), 300);
        }}
        onLongPress={(action) => {
          quickActionsRef.current?.dismiss();
          setNewThreadText(action.prompt);
          if (
            action.workspaceAgentId &&
            subAgentNames[action.workspaceAgentId]
          ) {
            const slug =
              agentIdToSlug[action.workspaceAgentId] ?? action.workspaceAgentId;
            setSelectedWorkspaces([
              { id: slug, name: subAgentNames[action.workspaceAgentId] },
            ]);
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
              input: {
                title: data.title,
                prompt: data.prompt,
                workspaceAgentId: wsId,
              },
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

      <BrainProviderStatusSheet
        visible={brainProvidersVisible}
        providers={brainProviders}
        colors={colors}
        onClose={() => setBrainProvidersVisible(false)}
      />

      {activeTab === "brain" ? <ToastHost bottomOffset={96} /> : null}
    </KeyboardAvoidingView>
  );
}
