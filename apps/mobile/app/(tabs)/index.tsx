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
import { ThreadsQuery, CreateThreadMutation, SendMessageMutation, UpdateThreadMutation, AgentWorkspacesQuery, RetryTaskSyncMutation } from "@/lib/graphql-queries";
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
import { WorkflowPickerSheet, type WorkflowPickerSheetRef, type Workflow } from "@/components/input/WorkflowPickerSheet";
import { useQuickActions, useCreateQuickAction, useUpdateQuickAction, useDeleteQuickAction, type QuickAction } from "@/lib/hooks/use-quick-actions";
import { useConnections } from "@/lib/hooks/use-connections";
import { useLastmileWorkflows } from "@/lib/hooks/use-lastmile-workflows";
import { getThreadHeaderLabel } from "@/lib/thread-display";

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

  // ── Task connector gating ──────────────────────────────────────────────
  // The Tasks tab only exists when a task-kind connector (e.g. LastMile) is
  // active for the user. `useConnections()` is shared with the Connectors
  // screen so flipping connection state there is visible here without a
  // screen reload.
  const { hasTaskConnector, activeTaskConnectors } = useConnections();

  // ── Threads / Tasks toggle ──────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"threads" | "tasks">("threads");

  // If a task connector gets disconnected while the user is sitting on the
  // Tasks tab, bounce them back to Threads so they don't stare at a dead UI.
  useEffect(() => {
    if (!hasTaskConnector && activeTab === "tasks") {
      setActiveTab("threads");
    }
  }, [hasTaskConnector, activeTab]);

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

  // ── Tasks query (runs when a task connector is configured) ──────────
  // Paused when the user has no task connector — no point pulling task
  // rows if we're not going to render the tab.
  const [{ data: tasksData }, reexecuteTasks] = useQuery({
    query: ThreadsQuery,
    variables: {
      tenantId: tenantId!,
      channel: ThreadChannel.Task,
      assigneeId: user?.sub,
    },
    pause: !tenantId || !user?.sub || !hasTaskConnector,
  });

  const filteredTasks = useMemo(() => {
    let tasks = (tasksData?.threads ?? []) as any[];
    // Drop terminal statuses AND soft-archived rows. "Delete Task" in the
    // thread detail menu sets `archivedAt` (same pattern Threads uses);
    // without this filter archived tasks keep showing up in the list,
    // which reads as a broken delete.
    tasks = tasks.filter((t: any) => {
      const s = (t.status || "").toUpperCase();
      if (s === "DONE" || s === "CANCELLED") return false;
      if (t.archivedAt) return false;
      return true;
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
      const headerLabel = getThreadHeaderLabel(thread);
      router.push({ pathname: `/thread/${thread.id}`, params: headerLabel ? { title: headerLabel } : {} });
      // Reset after navigation settles
      setTimeout(() => { navigatingRef.current = false; }, 500);
    }, 0);
  }, [router, markRead]);

  // ── New thread / task input ────────────────────────────────────────────
  // Each tab keeps its own draft text so switching tabs doesn't leak a
  // half-typed thread into a task submit (or vice versa).
  const [newThreadText, setNewThreadText] = useState("");
  const [newTaskText, setNewTaskText] = useState("");
  const quickActionsRef = useRef<QuickActionsSheetRef>(null);
  const quickActionFormRef = useRef<QuickActionFormSheetRef>(null);
  const workspacePickerRef = useRef<WorkspacePickerSheetRef>(null);
  const workflowPickerRef = useRef<WorkflowPickerSheetRef>(null);
  const messageInputRef = useRef<MessageInputFooterRef>(null);
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<SelectedWorkspace[]>([]);

  // ── Task workflow picker ──────────────────────────────────────────────
  // The `+` button on the Tasks footer opens a workflow picker — each
  // workflow represents a kind of task with its own team, statuses, and
  // automation rules. The selected workflow is shown as a chip and
  // included in the createTask call. Workflows are fetched from the
  // LastMile REST API via ThinkWork's connections proxy.
  const { workflows, loading: workflowsLoading, error: workflowsError, refetch: refetchWorkflows } = useLastmileWorkflows();
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);

  // ── Quick Actions (per-user, per-scope, from DB) ──────────────────────
  // Thread and Task footers each have their own canned-prompt list; we
  // keep one hook per scope so urql caches them separately and the
  // user can reorder one without disturbing the other. The sheet below
  // picks which list to show based on activeTab.
  const [{ data: qaThreadData }, reexecuteQAThread] = useQuickActions(tenantId, "thread");
  const [{ data: qaTaskData }, reexecuteQATask] = useQuickActions(tenantId, "task");
  const threadQuickActions: QuickAction[] = (qaThreadData?.userQuickActions ?? []) as QuickAction[];
  const taskQuickActions: QuickAction[] = (qaTaskData?.userQuickActions ?? []) as QuickAction[];
  const activeQuickActions = activeTab === "tasks" ? taskQuickActions : threadQuickActions;
  const reexecuteActiveQA = activeTab === "tasks" ? reexecuteQATask : reexecuteQAThread;
  // The scope the add/edit form should save into is whichever footer the
  // user just opened the sheet from. We snapshot at sheet-open time so
  // tab-switching while the form is up doesn't re-target mid-edit.
  const [qaFormScope, setQaFormScope] = useState<"thread" | "task">("thread");
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
  const [, executeRetryTaskSync] = useMutation(RetryTaskSyncMutation);

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

  // Retry outbound sync for a task row that ended up in sync_status='error'
  // or 'local'. The backend resolver re-fires syncExternalTaskOnCreate and
  // returns the reconciled row; we refetch the Tasks query so the badge
  // updates. No local optimistic state — the round-trip is fast enough
  // that the user sees the spinner → new badge without a skeleton flash.
  const handleRetryTaskSync = useCallback(async (threadId: string) => {
    console.log("[RetryTaskSync] Starting retry for thread:", threadId);
    const { error } = await executeRetryTaskSync({ threadId });
    if (error) {
      console.error("[RetryTaskSync] Failed:", error.message, error.graphQLErrors);
      Alert.alert("Retry failed", error.message);
      return;
    }
    reexecuteTasks({ requestPolicy: "network-only" });
  }, [executeRetryTaskSync, reexecuteTasks]);

  // Default task agent comes off the connection metadata (set in
  // Connectors → LastMile Tasks → Default task agent). When unset we fall
  // back to the user's active agent from the header picker — the user can
  // still create tasks, they just won't be auto-attached to a specific
  // agent until they pick one. Read from the first active task-kind
  // connector; multi-provider support can refine this later.
  const defaultTaskAgentId = useMemo(() => {
    for (const conn of activeTaskConnectors) {
      const meta = (conn.metadata ?? {}) as Record<string, unknown>;
      const providerMeta = (meta[conn.provider_name] as Record<string, unknown> | undefined) ?? {};
      const agentId = providerMeta.default_agent_id;
      if (typeof agentId === "string" && agentId.length > 0) return agentId;
    }
    return null;
  }, [activeTaskConnectors]);

  const handleCreateTask = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? newTaskText).trim();
    const agentId = defaultTaskAgentId || activeAgent?.id;
    console.log("[handleCreateTask]", {
      text: text.slice(0, 20),
      agentId,
      tenantId,
      userId: currentUser?.id,
      defaultTaskAgentId,
    });
    if (!text || !agentId || !tenantId) {
      console.warn("[handleCreateTask] Bailed — missing:", { text: !!text, agentId: !!agentId, tenantId: !!tenantId });
      return;
    }

    setNewTaskText("");
    Keyboard.dismiss();

    const creatorId = currentUser?.id || user?.sub;
    // Include the selected workflow_id in metadata so the backend's
    // syncExternalTaskOnCreate helper can pass it to LastMile's
    // `POST /tasks { title, workflow_id }` — the minimum info the API
    // needs to auto-resolve team, status, and task_type.
    const taskMetadata = selectedWorkflow
      ? JSON.stringify({ workflowId: selectedWorkflow.id, workflowName: selectedWorkflow.name })
      : undefined;
    try {
      const { data: createData, error: createError } = await executeCreateThread({
        input: {
          tenantId,
          agentId,
          title: text.length > 60 ? text.slice(0, 60) + "..." : text,
          type: "TASK" as any,
          channel: "TASK" as any,
          createdByType: "user",
          createdById: creatorId,
          assigneeType: "user",
          assigneeId: creatorId,
          ...(taskMetadata ? { metadata: taskMetadata } : {}),
        },
      });

      if (createError) {
        console.error("[Tasks] CreateThread failed:", createError.message);
        Alert.alert("Error", `Failed to create task: ${createError.message}`);
        return;
      }

      const newThread = createData?.createThread;
      if (!newThread?.id) {
        console.error("[Tasks] CreateThread returned no ID", createData);
        Alert.alert("Error", "Task was not created — no ID returned");
        return;
      }

      console.log("[Tasks] Task created:", newThread.id, (newThread as any).identifier);
      markRead(newThread.id);

      const { data: msgData, error: msgError } = await executeSendMessage({
        input: {
          threadId: newThread.id,
          role: "USER" as any,
          content: text,
          senderType: "human",
          senderId: currentUser?.id,
        },
      });

      if (msgError) {
        console.error("[Tasks] SendMessage failed:", msgError.message, msgError.graphQLErrors);
      } else {
        console.log("[Tasks] Message sent", msgData?.sendMessage?.id);
        markThreadActive(newThread.id);
      }

      // Refresh the tasks list so the new row appears immediately.
      reexecuteTasks({ requestPolicy: "network-only" });
    } catch (e) {
      console.error("[Tasks] Failed to create task:", e);
    }
  }, [newTaskText, defaultTaskAgentId, activeAgent?.id, tenantId, currentUser?.id, user?.sub, selectedWorkflow, executeCreateThread, executeSendMessage, reexecuteTasks, markRead, markThreadActive]);

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
        <View style={{ paddingTop: insets.top }} className="bg-white dark:bg-neutral-950">
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

      {/* Threads / Tasks segmented control — only shown when the user has a
          task-kind connector configured. Without one, Tasks is dead weight so
          we render the inbox as Threads-only. */}
      {hasTaskConnector && (
      <View
        className="border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 items-center justify-center"
        style={{ height: 52, paddingBottom: 8 }}
      >
        <View className="flex-row rounded-full bg-neutral-200 dark:bg-neutral-800" style={{ padding: 2 }}>
          <Pressable
            onPress={() => setActiveTab("threads")}
            className="flex-row items-center justify-center gap-1.5 rounded-full"
            style={{
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
            onPress={() => setActiveTab("tasks")}
            className="flex-row items-center justify-center gap-1.5 rounded-full"
            style={{
              paddingHorizontal: 16,
              paddingVertical: 5,
              backgroundColor: activeTab === "tasks" ? (isDark ? "#525252" : "#ffffff") : "transparent",
            }}
          >
            <Text className="text-sm font-semibold" style={{ color: activeTab === "tasks" ? colors.foreground : colors.mutedForeground }}>Tasks</Text>
            {filteredTasks.length > 0 && (
              <View className="rounded-full min-w-[18px] h-[18px] items-center justify-center px-1" style={{ backgroundColor: activeTab === "tasks" ? colors.primary : (isDark ? "#404040" : "#d4d4d4") }}>
                <Text style={{ color: activeTab === "tasks" ? (isDark ? "#000" : "#fff") : colors.mutedForeground, fontSize: 10, fontWeight: "700" }}>{filteredTasks.length}</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>
      )}

      <View className="flex-1" style={{ backgroundColor: colors.background }}>
      <WebContent>
        {activeTab === "threads" && filtersOpen && (
          <ThreadFilterBar filters={filters} onFiltersChange={setFilters} />
        )}

        {activeTab === "tasks" ? (
          <FlatList
            style={{ flex: 1 }}
            data={filteredTasks}
            keyExtractor={(item: any) => item.id}
            renderItem={({ item }) => (
              <TaskRow
                task={item}
                onPress={() => handleThreadPress(item)}
                hideAssignee
                onRetrySync={handleRetryTaskSync}
              />
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

      {/* Bottom input area. Rendered on both tabs — the placeholder and
          submit handler swap based on activeTab, and each tab owns its own
          draft so half-typed text can't leak across. On the Tasks tab the
          `+` button is a placeholder for a richer add-task form and the
          `⚡` Quick Actions button is dimmed until Task-scoped Quick
          Actions ship. */}
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
          <MessageInputFooter
            ref={messageInputRef}
            value={newTaskText}
            onChangeText={setNewTaskText}
            onSubmit={() => handleCreateTask()}
            placeholder="Create a new task..."
            colors={colors}
            isDark={isDark}
            // `+` opens the workflow picker — the user picks what kind of
            // task to create (each workflow = a task type with its own
            // team, statuses, and automation rules in LastMile).
            onPlusPress={() => { Keyboard.dismiss(); workflowPickerRef.current?.present(); }}
            // Show the selected workflow as a chip (reuses the workspace
            // chip layout — same visual, different semantic).
            selectedWorkspaces={selectedWorkflow ? [{ id: selectedWorkflow.id, name: selectedWorkflow.name }] : []}
            onRemoveWorkspace={() => setSelectedWorkflow(null)}
            // `⚡` opens the same sheet the Threads footer uses, but the
            // upstream hook passes `scope="task"` so the list is filtered
            // to task-scoped actions only. The `activeQuickActions` and
            // `qaFormScope` state (set in `useMemo`s above) take care of
            // routing saves back to the right scope.
            onQuickActions={() => { Keyboard.dismiss(); quickActionsRef.current?.present(); }}
          />
        )}
      </View>

      {/* Quick Actions Bottom Sheet — a single instance serves both tabs.
          `activeQuickActions` is swapped upstream based on activeTab so
          the sheet always shows the list for the footer the user just
          opened it from. Selecting an action fills the *active* tab's
          input, since that's the footer the ⚡ button lives on. */}
      <QuickActionsSheet
        ref={quickActionsRef}
        actions={activeQuickActions}
        subAgentNames={subAgentNames}
        onSelect={(action) => {
          quickActionsRef.current?.dismiss();
          if (activeTab === "tasks") {
            setNewTaskText(action.prompt);
          } else {
            setNewThreadText(action.prompt);
            if (action.workspaceAgentId && subAgentNames[action.workspaceAgentId]) {
              const slug = agentIdToSlug[action.workspaceAgentId] ?? action.workspaceAgentId;
              setSelectedWorkspaces([{ id: slug, name: subAgentNames[action.workspaceAgentId] }]);
            }
          }
          setTimeout(() => messageInputRef.current?.focus(), 300);
        }}
        onLongPress={(action) => {
          quickActionsRef.current?.dismiss();
          if (activeTab === "tasks") {
            setNewTaskText(action.prompt);
          } else {
            setNewThreadText(action.prompt);
            if (action.workspaceAgentId && subAgentNames[action.workspaceAgentId]) {
              const slug = agentIdToSlug[action.workspaceAgentId] ?? action.workspaceAgentId;
              setSelectedWorkspaces([{ id: slug, name: subAgentNames[action.workspaceAgentId] }]);
            }
          }
          setTimeout(() => messageInputRef.current?.focus(), 300);
        }}
        onAdd={() => {
          quickActionsRef.current?.dismiss();
          // Snapshot the scope the user opened the sheet from so form
          // saves land in the correct list even if they switch tabs.
          setQaFormScope(activeTab === "tasks" ? "task" : "thread");
          setTimeout(() => quickActionFormRef.current?.present(), 300);
        }}
        onEdit={(action) => {
          quickActionsRef.current?.dismiss();
          setQaFormScope(action.scope ?? (activeTab === "tasks" ? "task" : "thread"));
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

      {/* Workflow picker for the Tasks footer `+` button */}
      <WorkflowPickerSheet
        ref={workflowPickerRef}
        workflows={workflows}
        loading={workflowsLoading}
        error={workflowsError}
        selectedId={selectedWorkflow?.id ?? null}
        onSelect={(wf) => setSelectedWorkflow(wf)}
        onRefresh={refetchWorkflows}
      />

      {/* Quick Action Add/Edit Form. Saves into `qaFormScope` (captured
          when the form was opened) so edits don't accidentally flip an
          action between scopes just because the user switched tabs mid-
          edit. After save/delete we refresh *both* scope queries — one
          of them is a cheap no-op and it keeps the in-memory state
          consistent if the backend ever moves an action between scopes. */}
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
          reexecuteQATask({ requestPolicy: "network-only" });
        }}
        onDelete={(id) => {
          executeDeleteQA({ id }).then(() => {
            reexecuteQAThread({ requestPolicy: "network-only" });
            reexecuteQATask({ requestPolicy: "network-only" });
          });
        }}
      />

    </KeyboardAvoidingView>
  );
}
