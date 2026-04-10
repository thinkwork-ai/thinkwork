import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { InteractionManager } from "react-native";
import { View, FlatList, Pressable, Keyboard, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, ChevronRight, Info, Check, Circle, CheckSquare, ListChecks, AlertCircle, Clock } from "lucide-react-native";
import { MessageInputFooter } from "@/components/input/MessageInputFooter";
import { QuickActionsSheet, type QuickActionsSheetRef } from "@/components/chat/QuickActionsSheet";
import { useQuickActions, useDeleteQuickAction, type QuickAction } from "@/lib/hooks/use-quick-actions";
import { WebViewSheet, type WebViewSheetRef } from "@/components/chat/WebViewSheet";
import { useAuth } from "@/lib/auth-context";
import { useThreadUpdatedSubscription, useNewMessageSubscription } from "@/lib/hooks/use-subscriptions";
import { useTurnCompletion } from "@/lib/hooks/use-turn-completion";
import { useThreadReadState } from "@/lib/hooks/use-thread-read-state";
import { ActivityTimeline, type SaveRecipeInfo } from "@/components/threads/ActivityTimeline";
import { MarkdownMessage } from "@/components/chat/MarkdownMessage";
import { TaskRow } from "@/components/threads/TaskRow";
import { SaveRecipeSheet, type SaveRecipeSheetRef } from "@/components/genui/SaveRecipeSheet";
import { CreateRecipeMutation } from "@/lib/graphql-queries";
import { useAppMode } from "@/lib/hooks/use-app-mode";
import { Text, Muted } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { useQuery, useMutation } from "urql";
import {
  ThreadQuery,
  MeQuery,
  AgentsQuery,
  ThreadTurnsForThreadQuery,
  SendMessageMutation,
  MessagesQuery,
  UpdateThreadMutation,
} from "@/lib/graphql-queries";

export default function ThreadDetailRoute() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const { isThreadActive, markThreadActive, clearThreadActive } = useTurnCompletion(tenantId);
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();

  // Defer queries by one frame to avoid setState-during-render with URQL shared cache
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => setMounted(true));
    return () => handle.cancel();
  }, []);

  const [{ data: meData }] = useQuery({ query: MeQuery, pause: !mounted });
  const currentUser = (meData as any)?.me;

  const { isAdmin } = useAppMode();
  const [{ data: agentsData }] = useQuery({
    query: AgentsQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId || !mounted,
  });
  const agentMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of (agentsData?.agents ?? []) as any[]) {
      map[a.id] = a.name || "Agent";
    }
    return map;
  }, [agentsData?.agents]);

  // ── Thread data ──
  const [{ data: threadData }, reexecuteThread] = useQuery({
    query: ThreadQuery,
    variables: { id: threadId! },
    pause: !threadId,
  });
  const thread = threadData?.thread as any;
  const agentName = thread?.agentId ? agentMap[thread.agentId] || "Agent" : "Agent";

  // ── Messages (separate query to include toolResults for GenUI) ──
  const [{ data: messagesData }, reexecuteMessages] = useQuery({
    query: MessagesQuery,
    variables: { threadId: threadId!, limit: 100 },
    pause: !threadId,
  });
  const messages = useMemo(() => {
    const edges = (messagesData?.messages?.edges ?? []) as any[];
    return edges.map((e: any) => {
      const m = e.node;
      // Parse toolResults for GenUI rendering
      let toolResults = null;
      if (m.toolResults) {
        try {
          const parsed = typeof m.toolResults === 'string' ? JSON.parse(m.toolResults) : m.toolResults;
          if (Array.isArray(parsed) && parsed.length > 0) toolResults = parsed;
        } catch {}
      }
      return { ...m, toolResults };
    }).filter((m: any) => {
      const role = (m.role || "").toLowerCase();
      return role === "user" || role === "assistant";
    });
  }, [messagesData]);

  // ── Turns ──
  const [{ data: turnsData }, reexecuteTurns] = useQuery({
    query: ThreadTurnsForThreadQuery,
    variables: { tenantId: tenantId!, threadId: threadId!, limit: 50 },
    pause: !threadId || !tenantId,
  });
  const turns = (turnsData?.threadTurns ?? []) as any[];
  const hasRunningTurn = turns.some((t: any) => t.status === "running");

  // Poll turns + messages while a turn is running
  useEffect(() => {
    if (!hasRunningTurn) return;
    const interval = setInterval(() => {
      reexecuteTurns({ requestPolicy: "network-only" });
      reexecuteThread({ requestPolicy: "network-only" });
    }, 3000);
    return () => clearInterval(interval);
  }, [hasRunningTurn, reexecuteTurns, reexecuteThread]);

  // ── Subscriptions (deferred to avoid setState-during-render warnings) ──
  const [{ data: threadEvent }] = useThreadUpdatedSubscription(tenantId);
  useEffect(() => {
    if (threadEvent?.onThreadUpdated?.threadId === threadId) {
      setTimeout(() => {
        reexecuteThread({ requestPolicy: "network-only" });
        reexecuteTurns({ requestPolicy: "network-only" });
      }, 0);
    }
  }, [threadEvent?.onThreadUpdated?.updatedAt]);

  const [{ data: msgEvent }] = useNewMessageSubscription(threadId);
  useEffect(() => {
    if (msgEvent?.onNewMessage) {
      setTimeout(() => reexecuteThread({ requestPolicy: "network-only" }), 0);
      if (threadId && msgEvent.onNewMessage.role === "assistant") {
        clearThreadActive(threadId);
      }
    }
  }, [msgEvent?.onNewMessage?.messageId]);

  // ── Read state ──
  const { markRead } = useThreadReadState();
  useEffect(() => {
    if (threadId) setTimeout(() => markRead(threadId), 0);
  }, [threadId]);
  useEffect(() => {
    if (threadEvent?.onThreadUpdated?.threadId === threadId) {
      setTimeout(() => markRead(threadId!), 0);
    }
  }, [threadEvent?.onThreadUpdated?.updatedAt]);

  // Debug logging
  if (__DEV__ && turns.length > 0) {
    const t0 = turns[0];
    const rj = t0?.resultJson;
    const parsed = typeof rj === "string" ? (() => { try { return JSON.parse(rj); } catch { return null; } })() : rj;
    console.log("[ThreadDetail] messages:", messages.length, "turns:", turns.length);
    console.log("[ThreadDetail] turn[0]:", { status: t0?.status, resultJsonType: typeof rj, keys: parsed ? Object.keys(parsed) : null, responsePreview: (parsed?.response || parsed?.responseText || parsed?.content || "NONE")?.substring?.(0, 80) });
  }

  // ── Task state ──
  const [, executeUpdateThread] = useMutation(UpdateThreadMutation);
  const isTask = thread?.channel?.toUpperCase() === "TASK";
  const isDone = thread?.status?.toUpperCase() === "DONE";
  const childThreads = (thread?.children ?? []) as any[];
  const allDescendantTasks = useMemo(() => {
    const result: any[] = [];
    for (const child of childThreads) {
      result.push(child);
      for (const grandchild of (child.children ?? [])) {
        result.push(grandchild);
      }
    }
    return result;
  }, [childThreads]);
  const hasChildren = allDescendantTasks.length > 0;
  const [detailTab, setDetailTab] = useState<"thread" | "tasks">("thread");

  const handleMarkDone = useCallback(async () => {
    if (!threadId) return;
    // Check for open sub-tasks and confirm if needed
    const openTasks = allDescendantTasks.filter((t: any) => {
      const s = (t.status || "").toUpperCase();
      return s !== "DONE" && s !== "CANCELLED";
    });
    if (openTasks.length > 0) {
      Alert.alert(
        "Complete all sub-tasks?",
        `This will also mark ${openTasks.length} open sub-task${openTasks.length > 1 ? "s" : ""} as done.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Complete All",
            style: "destructive",
            onPress: async () => {
              await executeUpdateThread({ id: threadId, input: { status: "DONE" as any } });
              reexecuteThread({ requestPolicy: "network-only" });
              router.back();
            },
          },
        ],
      );
      return;
    }
    await executeUpdateThread({ id: threadId, input: { status: "DONE" as any } });
    reexecuteThread({ requestPolicy: "network-only" });
    router.back();
  }, [threadId, allDescendantTasks, executeUpdateThread, reexecuteThread, router]);

  const quickActionsRef = useRef<QuickActionsSheetRef>(null);
  const webViewSheetRef = useRef<WebViewSheetRef>(null);
  const saveRecipeRef = useRef<SaveRecipeSheetRef>(null);
  const pendingRecipeRef = useRef<SaveRecipeInfo | null>(null);
  const [, executeCreateRecipe] = useMutation(CreateRecipeMutation);

  const handleSaveRecipe = useCallback((info: SaveRecipeInfo) => {
    console.log("[ThreadDetail] handleSaveRecipe called:", info.label, "sheetRef:", !!saveRecipeRef.current);
    pendingRecipeRef.current = info;
    saveRecipeRef.current?.present({ title: info.label });
  }, []);

  const handleSaveRecipeConfirm = useCallback(async (data: { title: string; summary: string }) => {
    const info = pendingRecipeRef.current;
    if (!info) return;
    await executeCreateRecipe({
      input: {
        tenantId: info.tenantId,
        threadId: info.threadId,
        title: data.title,
        summary: data.summary || null,
        server: info.toolInfo.server,
        tool: info.toolInfo.tool,
        params: JSON.stringify(info.toolInfo.params),
        genuiType: info.genuiType,
        sourceMessageId: info.messageId,
      },
    });
    pendingRecipeRef.current = null;
  }, [executeCreateRecipe]);

  // Quick Actions (per-user, from DB) — defer until mounted to avoid setState-during-render
  const [{ data: qaData }, reexecuteQA] = useQuickActions(mounted ? tenantId : undefined);
  const quickActions: QuickAction[] = (qaData?.userQuickActions ?? []) as QuickAction[];
  const [, executeDeleteQA] = useDeleteQuickAction();

  const handleLinkPress = useCallback((url: string) => {
    if (webViewSheetRef.current) {
      webViewSheetRef.current.open(url);
    } else {
      import("react-native").then(({ Linking }) => Linking.openURL(url).catch(() => null));
    }
  }, []);

  // ── Send message ──
  const [messageText, setMessageText] = useState("");
  const [, executeSendMessage] = useMutation(SendMessageMutation);

  const handleSend = useCallback(async () => {
    const text = messageText.trim();
    if (!text || !threadId) return;
    setMessageText("");
    Keyboard.dismiss();
    await executeSendMessage({
      input: {
        threadId: threadId,
        role: "USER" as any,
        content: text,
        senderType: "human",
        senderId: currentUser?.id,
      },
    });
    markThreadActive(threadId);
    // Re-fetch immediately so the new message appears and auto-scroll kicks in
    reexecuteThread({ requestPolicy: "network-only" });
  }, [messageText, threadId, currentUser?.id, executeSendMessage, reexecuteThread, markThreadActive]);

  // Don't render stale content — wait until the correct thread is loaded
  const isLoaded = thread && thread.id === threadId;

  if (!threadId) return <View className="flex-1 bg-white dark:bg-black" />;

  return (
    <KeyboardAvoidingView
      className="flex-1"
      style={{ backgroundColor: isDark ? "#171717" : "#f5f5f5" }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View
        style={{ paddingTop: insets.top, backgroundColor: colors.background }}
        className="border-b border-neutral-200 dark:border-neutral-800"
      >
        <View className="flex-row items-center justify-between pl-2 pr-4" style={{ height: 44 }}>
          {/* Left: back + title */}
          <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace("/")} className="flex-row items-center gap-1.5 active:opacity-70 flex-shrink" style={{ maxWidth: isTask ? "65%" : "80%" }}>
            <ChevronLeft size={24} color={colors.foreground} />
            <Text className="text-lg font-semibold" numberOfLines={1}>{isLoaded ? thread.title : "Loading..."}</Text>
          </Pressable>

          {/* Right actions */}
          {isLoaded && (
            <View className="flex-row items-center gap-2">
              {isTask && !isDone && (
                <Pressable onPress={handleMarkDone} className="flex-row items-center gap-1 px-3 py-1.5 rounded-full active:opacity-70" style={{ backgroundColor: isDark ? "#166534" : "#16a34a" }}>
                  <Check size={14} color="#fff" strokeWidth={2.5} />
                  <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>Done</Text>
                </Pressable>
              )}
              {!isTask && (
                <Pressable onPress={() => router.push(`/thread/${threadId}/info`)} className="p-2 active:opacity-70">
                  <Info size={22} color={colors.mutedForeground} strokeWidth={1.25} />
                </Pressable>
              )}
            </View>
          )}
        </View>

      </View>

      {/* Content area — single scrollable page via ActivityTimeline's FlatList */}
      <View className="flex-1" style={{ backgroundColor: colors.background }}>
        {isLoaded ? (
          isTask ? (
            /* Task view: scrollable card + sub-tasks, no timeline */
            <FlatList
              data={allDescendantTasks}
              keyExtractor={(item: any) => item.id}
              renderItem={({ item, index }) => (
                <View>
                  {index > 0 && <View className="h-px bg-neutral-200 dark:bg-neutral-800" style={{ marginLeft: 68 }} />}
                  <TaskRow task={item} onPress={() => router.push(`/thread/${item.id}`)} />
                </View>
              )}
              ListHeaderComponent={
                <>
                  {/* Task detail card */}
                  <View className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
                    <View className="flex-row items-center gap-2 mb-1">
                      <Text className="text-xs font-mono text-neutral-500 dark:text-neutral-400">{thread.identifier}</Text>
                      <View className="flex-row items-center gap-1">
                        <Circle size={8} color={
                          isDone ? (isDark ? "#4ade80" : "#16a34a")
                            : thread.status?.toUpperCase() === "IN_PROGRESS" ? (isDark ? "#60a5fa" : "#2563eb")
                            : (isDark ? "#a78bfa" : "#7c3aed")
                        } />
                        <Text className="text-xs text-neutral-500 dark:text-neutral-400">{(thread.status || "").replace("_", " ")}</Text>
                      </View>
                      {thread.priority && (
                        <Text className="text-xs text-neutral-500 dark:text-neutral-400">· {thread.priority}</Text>
                      )}
                    </View>
                    {thread.description && (
                      <View className="mt-1">
                        <MarkdownMessage content={thread.description} variant="assistant" />
                      </View>
                    )}
                    {thread.dueAt && (
                      <View className="flex-row items-center gap-1 mt-1.5">
                        <Clock size={12} color={new Date(thread.dueAt) < new Date() && !isDone ? (isDark ? "#f87171" : "#dc2626") : colors.mutedForeground} />
                        <Text className="text-xs" style={{ color: new Date(thread.dueAt) < new Date() && !isDone ? (isDark ? "#f87171" : "#dc2626") : colors.mutedForeground }}>
                          Due {new Date(thread.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                        </Text>
                      </View>
                    )}
                  </View>
                  {/* Sub-Tasks header */}
                  {hasChildren && (
                    <View className="px-4 pt-3 pb-1.5">
                      <Text className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                        Sub-Tasks ({allDescendantTasks.length})
                      </Text>
                    </View>
                  )}
                </>
              }
              ListFooterComponent={<View style={{ height: 20 }} />}
            />
          ) : (
            /* Non-task view: activity timeline */
            <ActivityTimeline
              key={threadId}
              messages={messages}
              turns={turns}
              agentName={agentName}
              isAdmin={isAdmin}
              isAgentRunning={!!threadId && isThreadActive(threadId)}
              onLinkPress={handleLinkPress}
              onSaveRecipe={handleSaveRecipe}
              listHeaderComponent={null}
              currentUserId={currentUser?.id}
            />
          )
        ) : null}
      </View>

      {/* Message input */}
      <View>
        <MessageInputFooter
          value={messageText}
          onChangeText={setMessageText}
          onSubmit={handleSend}
          placeholder="Message..."
          colors={colors}
          isDark={isDark}
          onQuickActions={() => quickActionsRef.current?.present()}
        />
      </View>

      {/* Quick Actions Bottom Sheet */}
      <QuickActionsSheet
        ref={quickActionsRef}
        actions={quickActions}
        onSelect={(action) => {
          quickActionsRef.current?.dismiss();
          setMessageText(action.prompt);
          // Auto-send after a brief delay to let state update
          setTimeout(() => {
            const text = action.prompt.trim();
            if (text && threadId) {
              setMessageText("");
              Keyboard.dismiss();
              executeSendMessage({
                input: { threadId: threadId, role: "USER" as any, content: text, senderType: "human", senderId: currentUser?.id },
              }).then(() => {
                markThreadActive(threadId);
                reexecuteThread({ requestPolicy: "network-only" });
              });
            }
          }, 50);
        }}
        onLongPress={(action) => {
          quickActionsRef.current?.dismiss();
          setMessageText(action.prompt);
        }}
        onDelete={(id) => {
          executeDeleteQA({ id }).then(() => reexecuteQA({ requestPolicy: "network-only" }));
        }}
        onAdd={() => {
          quickActionsRef.current?.dismiss();
        }}
      />

      {/* WebView for in-app link viewing */}
      <WebViewSheet ref={webViewSheetRef} />

      {/* Save as Recipe bottom sheet */}
      <SaveRecipeSheet ref={saveRecipeRef} onSave={handleSaveRecipeConfirm} />
    </KeyboardAvoidingView>
  );
}
