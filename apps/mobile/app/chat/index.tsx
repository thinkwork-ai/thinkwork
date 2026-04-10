import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { View, Pressable, Modal, Dimensions, Alert, Animated } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, Check } from "lucide-react-native";
import { useAuth } from "@/lib/auth-context";
import { useAgents } from "@/lib/hooks/use-agents";
import { useThreadUpdatedSubscription } from "@/lib/hooks/use-subscriptions";
import { useMe } from "@/lib/hooks/use-users";
import { ChatScreen } from "@/components/chat/ChatScreen";
import { useThreadReadState } from "@/lib/hooks/use-thread-read-state";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { useQuery, useMutation } from "urql";
import { ThreadsQuery, UpdateThreadMutation } from "@/lib/graphql-queries";

function statusColor(status: string, isDark: boolean): string {
  switch (status) {
    case "IN_PROGRESS": return isDark ? "#60a5fa" : "#2563eb"; // blue
    case "TODO": return isDark ? "#a78bfa" : "#7c3aed"; // purple
    case "BLOCKED": return isDark ? "#f87171" : "#dc2626"; // red
    case "DONE": return isDark ? "#4ade80" : "#16a34a"; // green
    case "BACKLOG": return isDark ? "#a3a3a3" : "#737373"; // gray
    default: return isDark ? "#a3a3a3" : "#737373";
  }
}

export default function ChatRoute() {
  const { agentId: paramAgentId, threadId: paramThreadId, identifier: paramIdentifier } =
    useLocalSearchParams<{
      agentId?: string;
      threadId?: string;
      identifier?: string;
    }>();
  const router = useRouter();
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;
  const insets = useSafeAreaInsets();

  const [{ data: meData }] = useMe();
  const currentUser = meData?.me;

  const [{ data: agentsData }] = useAgents(tenantId);
  const agents = agentsData?.agents ?? [];

  const visibleAgents = useMemo(() => {
    const all = (agents as any[]).filter((a: any) => a.type !== "local");
    const uid = user?.sub;
    if (!uid) return [];
    return all.filter((a: any) => a.humanPairId === uid);
  }, [agents, user?.sub]);

  const [selectedId, setSelectedId] = useState<string | null>(paramAgentId ?? null);

  const activeAgent = useMemo(() => {
    if (!visibleAgents?.length) return null;
    if (selectedId) {
      const found = visibleAgents.find((a: any) => a.id === selectedId);
      if (found) return found;
    }
    return visibleAgents.find((a: any) => a.role === "team") ?? visibleAgents[0];
  }, [visibleAgents, selectedId]);

  const caller = useMemo(() => {
    if (!currentUser) return undefined;
    const isOwner = (activeAgent as any)?.humanPairId
      ? currentUser.id === (activeAgent as any).humanPairId
      : true;
    return {
      name: currentUser.name || undefined,
      email: currentUser.email || undefined,
      role: undefined as string | undefined,
      isOwner,
    };
  }, [currentUser, (activeAgent as any)?.humanPairId]);

  // Thread tracking
  const [{ data: threadsData }, reexecuteThreads] = useQuery({
    query: ThreadsQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });
  const chatThreads = threadsData?.threads ?? [];

  const { markRead } = useThreadReadState();

  const [{ data: threadEvent }] = useThreadUpdatedSubscription(tenantId);
  useEffect(() => {
    if (threadEvent?.onThreadUpdated) {
      reexecuteThreads({ requestPolicy: "network-only" });
      // Mark read while user is actively viewing this thread
      if (paramThreadId) markRead(paramThreadId);
    }
  }, [threadEvent?.onThreadUpdated?.threadId, threadEvent?.onThreadUpdated?.updatedAt]);

  // Mark read on mount
  useEffect(() => {
    if (paramThreadId) markRead(paramThreadId);
  }, [paramThreadId]);

  const [, executeUpdateThread] = useMutation(UpdateThreadMutation);
  const [chatKey, setChatKey] = useState(0);

  const activeThread = useMemo(() => {
    if (paramThreadId) {
      const found = (chatThreads as any[]).find((t: any) => t.id === paramThreadId);
      if (found) return found;
      // Thread not in query yet — use param directly
      return { id: paramThreadId, identifier: paramIdentifier };
    }
    if (!(chatThreads as any[]).length || !activeAgent?.id) return null;
    const active = (chatThreads as any[])
      .filter((t: any) => t.agentId === activeAgent.id && t.type === "CHAT" && t.status !== "DONE")
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return active[0] ?? null;
  }, [chatThreads, activeAgent?.id, paramThreadId, paramIdentifier]);

  const threadIdentifier = activeThread?.identifier || paramIdentifier || "New Thread";
  const [optimisticStatus, setOptimisticStatus] = useState<string | null>(null);
  const serverStatus = (activeThread as any)?.status?.toUpperCase() || "IN_PROGRESS";
  const currentStatus = optimisticStatus || serverStatus;

  // Clear optimistic status once server catches up
  useEffect(() => {
    if (optimisticStatus && serverStatus === optimisticStatus) {
      setOptimisticStatus(null);
    }
  }, [serverStatus, optimisticStatus]);

  // Status dropdown
  const [statusDropdownVisible, setStatusDropdownVisible] = useState(false);
  const [statusAnchor, setStatusAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const statusRef = useRef<View>(null);

  const STATUS_OPTIONS = [
    { label: "In Progress", value: "IN_PROGRESS" },
    { label: "Todo", value: "TODO" },
    { label: "Blocked", value: "BLOCKED" },
    { label: "Done", value: "DONE" },
    { label: "Backlog", value: "BACKLOG" },
  ];

  const [statusSaving, setStatusSaving] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (statusSaving) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.3, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ]),
      );
      anim.start();
      return () => anim.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [statusSaving]);

  const handleStatusChange = useCallback(async (newStatus: string) => {
    if (!activeThread?.id) return;
    setStatusDropdownVisible(false);
    setStatusSaving(true);
    const { error } = await executeUpdateThread({ id: activeThread.id, input: { status: newStatus as any } });
    setStatusSaving(false);
    if (error) {
      Alert.alert("Error", "Failed to update status. Please try again.");
      return;
    }
    setOptimisticStatus(newStatus);
    if (newStatus === "DONE") {
      router.back();
    } else {
      reexecuteThreads({ requestPolicy: "network-only" });
    }
  }, [activeThread?.id, executeUpdateThread, router, reexecuteThreads]);

  const openStatusDropdown = useCallback(() => {
    statusRef.current?.measureInWindow((x, y, width, height) => {
      setStatusAnchor({ x, y, width, height });
      setStatusDropdownVisible(true);
    });
  }, []);

  const handleNewChat = useCallback(() => {
    if (!activeAgent?.id) return;
    if (activeThread?.id) {
      executeUpdateThread({ id: activeThread.id, input: { status: "DONE" as any } })
        .catch((e: any) => console.error("[Chat] Failed to close thread:", e));
    }
    setChatKey((k) => k + 1);
  }, [activeAgent?.id, activeThread?.id, executeUpdateThread]);

  if (!activeAgent) {
    return <View className="flex-1 bg-white dark:bg-neutral-950" />;
  }

  return (
    <View className="flex-1 bg-white dark:bg-neutral-950">
      {/* Header: back + thread ID + complete */}
      <View
        style={{ paddingTop: insets.top }}
        className="bg-white dark:bg-neutral-950 border-b border-neutral-200 dark:border-neutral-800"
      >
        <View className="flex-row items-center justify-between pl-2 pr-4" style={{ height: 44 }}>
          {/* Left: back + title */}
          <Pressable onPress={() => router.back()} className="flex-row items-center gap-0.5 active:opacity-70 flex-shrink" style={{ maxWidth: "60%" }}>
            <ChevronLeft size={22} color={colors.foreground} />
            <Text className="text-base" numberOfLines={1}>{(activeThread as any)?.title || threadIdentifier}</Text>
          </Pressable>

          {/* Right: Status dropdown */}
          {activeThread?.id ? (
            <Pressable
              ref={statusRef}
              onPress={statusSaving ? undefined : openStatusDropdown}
              disabled={statusSaving}
            >
              <Animated.View
                style={{
                  opacity: pulseAnim,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: statusColor(currentStatus, isDark),
                }}
              >
                <Text className="text-xs font-medium" style={{ color: statusColor(currentStatus, isDark) }}>
                  {STATUS_OPTIONS.find((o) => o.value === currentStatus)?.label || currentStatus}
                </Text>
              </Animated.View>
            </Pressable>
          ) : (
            <View style={{ width: 80 }} />
          )}
        </View>
      </View>

      {/* Chat */}
      <ChatScreen
        key={`chat-${chatKey}-${activeAgent.id}`}
        baseUrl=""
        token="graphql"
        agentType={activeAgent.type}
        agentName={activeAgent.name || "Agent"}
        agents={visibleAgents.map((a: any) => ({ ...a, _id: a.id }))}
        selectedAgentId={activeAgent.id}
        onSelectAgent={(a: any) => setSelectedId(a._id ?? a.id)}
        agentId={activeAgent.id}
        threadId={activeThread?.id}
        tenantId={tenantId}
        caller={caller}
        onNewChat={handleNewChat}
        mentionCandidates={[]}
        hideHeader
      />

      {/* Status dropdown */}
      {statusDropdownVisible && statusAnchor && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setStatusDropdownVisible(false)}>
          <Pressable style={{ flex: 1 }} onPress={() => setStatusDropdownVisible(false)}>
            <View
              onStartShouldSetResponder={() => true}
              style={{
                position: "absolute",
                top: statusAnchor.y + statusAnchor.height + 4,
                right: Dimensions.get("window").width - (statusAnchor.x + statusAnchor.width),
                minWidth: 160,
                backgroundColor: isDark ? "#1c1c1e" : "#ffffff",
                borderRadius: 12,
                borderWidth: 1,
                borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: isDark ? 0.5 : 0.15,
                shadowRadius: 12,
                elevation: 8,
                overflow: "hidden",
              }}
            >
              {STATUS_OPTIONS.map((opt, i) => {
                const isSelected = currentStatus === opt.value;
                const isLast = i === STATUS_OPTIONS.length - 1;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => handleStatusChange(opt.value)}
                    className="flex-row items-center justify-between px-4 py-3 active:opacity-70"
                    style={!isLast ? {
                      borderBottomWidth: 0.5,
                      borderBottomColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
                    } : undefined}
                  >
                    <Text className={`text-sm ${isSelected ? "font-semibold" : ""}`}
                      style={isSelected ? { color: colors.primary } : undefined}
                    >
                      {opt.label}
                    </Text>
                    {isSelected && <Check size={16} color={colors.primary} />}
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}
