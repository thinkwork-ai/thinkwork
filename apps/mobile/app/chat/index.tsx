import React, { useState, useMemo, useCallback, useEffect } from "react";
import { View, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";
import { useAuth } from "@/lib/auth-context";
import {
  useThreadUpdatedSubscription,
  useUpdateThread,
} from "@thinkwork/react-native-sdk";
import { useMe } from "@/lib/hooks/use-users";
import { ChatScreen } from "@/components/chat/ChatScreen";
import { useThreadReadState } from "@/lib/hooks/use-thread-read-state";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { useQuery } from "urql";
// ThreadsQuery stays local — the chat dashboard accesses richer Thread
// fields (`description`, labels, metadata, assignee detail) than the
// chat-oriented SDK Thread type exposes.
import { AssignedComputersQuery, ThreadsQuery } from "@/lib/graphql-queries";

// ThreadLifecycleStatus → operator-facing label. Mirrors admin's
// ThreadLifecycleBadge (apps/admin/src/components/threads/ThreadLifecycleBadge.tsx).
// Read-only; lifecycle is derived server-side via thread.lifecycleStatus (U4).
const LIFECYCLE_LABELS: Record<string, string> = {
  RUNNING: "Running",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
  IDLE: "Idle",
  AWAITING_USER: "Awaiting user",
};

function lifecycleColor(
  status: string | null | undefined,
  isDark: boolean,
): string {
  if (!status) return isDark ? "#a3a3a3" : "#737373";
  switch (status) {
    case "RUNNING":
      return isDark ? "#60a5fa" : "#2563eb"; // blue
    case "COMPLETED":
      return isDark ? "#4ade80" : "#16a34a"; // green
    case "CANCELLED":
      return isDark ? "#facc15" : "#ca8a04"; // yellow
    case "FAILED":
      return isDark ? "#f87171" : "#dc2626"; // red
    default:
      return isDark ? "#a3a3a3" : "#737373"; // IDLE / AWAITING_USER
  }
}

export default function ChatRoute() {
  const { threadId: paramThreadId, identifier: paramIdentifier } =
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

  const [{ data: computerData, fetching: computersFetching }] = useQuery({
    query: AssignedComputersQuery,
    pause: !tenantId,
  });
  const assignedComputers = useMemo(
    () =>
      ((computerData?.assignedComputers ?? []) as any[]).filter(
        (computer) => computer.status !== "archived",
      ),
    [computerData?.assignedComputers],
  );
  const selectedComputer = assignedComputers[0] ?? null;

  const caller = useMemo(() => {
    if (!currentUser) return undefined;
    return {
      name: currentUser.name || undefined,
      email: currentUser.email || undefined,
      role: undefined as string | undefined,
      isOwner: true,
    };
  }, [currentUser]);

  // Thread tracking
  const [{ data: threadsData }, reexecuteThreads] = useQuery({
    query: ThreadsQuery,
    variables: { tenantId: tenantId!, computerId: selectedComputer?.id },
    pause: !tenantId || computersFetching || !selectedComputer?.id,
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
  }, [
    threadEvent?.onThreadUpdated?.threadId,
    threadEvent?.onThreadUpdated?.updatedAt,
  ]);

  // Mark read on mount
  useEffect(() => {
    if (paramThreadId) markRead(paramThreadId);
  }, [paramThreadId]);

  const updateThread = useUpdateThread();
  const [chatKey, setChatKey] = useState(0);

  const activeThread = useMemo(() => {
    if (paramThreadId) {
      const found = (chatThreads as any[]).find(
        (t: any) => t.id === paramThreadId,
      );
      if (found) return found;
      // Thread not in query yet — use param directly
      return { id: paramThreadId, identifier: paramIdentifier };
    }
    if (!(chatThreads as any[]).length || !selectedComputer?.id) return null;
    const active = (chatThreads as any[])
      .filter(
        (t: any) =>
          t.computerId === selectedComputer.id &&
          t.channel === "CHAT" &&
          !t.archivedAt &&
          t.lifecycleStatus !== "COMPLETED" &&
          t.lifecycleStatus !== "CANCELLED",
      )
      .sort(
        (a: any, b: any) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    return active[0] ?? null;
  }, [chatThreads, selectedComputer?.id, paramThreadId, paramIdentifier]);

  const threadIdentifier =
    activeThread?.identifier || paramIdentifier || "New Thread";
  const lifecycleStatus = activeThread?.lifecycleStatus;
  const lifecycleLabel = lifecycleStatus
    ? (LIFECYCLE_LABELS[lifecycleStatus] ?? "Idle")
    : null;
  const lifecycleDotColor = lifecycleColor(lifecycleStatus, isDark);

  const handleNewChat = useCallback(() => {
    if (!selectedComputer?.id) return;
    if (activeThread?.id) {
      // Archive instead of the retired status=DONE transition (U9): lifecycle
      // is derived server-side; "done" as a user action maps to archiving.
      updateThread(activeThread.id, {
        archivedAt: new Date().toISOString(),
      }).catch((e: any) =>
        console.error("[Chat] Failed to archive thread:", e),
      );
    }
    setChatKey((k) => k + 1);
  }, [selectedComputer?.id, activeThread?.id, updateThread]);

  if (!selectedComputer) {
    return <View className="flex-1 bg-white dark:bg-neutral-950" />;
  }

  return (
    <View className="flex-1 bg-white dark:bg-neutral-950">
      {/* Header: back + thread ID + complete */}
      <View
        style={{ paddingTop: insets.top }}
        className="bg-white dark:bg-neutral-950 border-b border-neutral-200 dark:border-neutral-800"
      >
        <View
          className="flex-row items-center justify-between pl-2 pr-4"
          style={{ height: 44 }}
        >
          {/* Left: back + title */}
          <Pressable
            onPress={() => router.back()}
            className="flex-row items-center gap-0.5 active:opacity-70 flex-shrink"
            style={{ maxWidth: "60%" }}
          >
            <ChevronLeft size={22} color={colors.foreground} />
            <Text className="text-base" numberOfLines={1}>
              {(activeThread as any)?.title || threadIdentifier}
            </Text>
          </Pressable>

          {/* Right: read-only lifecycle badge (U9 — status picker retired) */}
          {activeThread?.id && lifecycleLabel ? (
            <View
              style={{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: lifecycleDotColor,
              }}
            >
              <Text
                className="text-xs font-medium"
                style={{ color: lifecycleDotColor }}
              >
                {lifecycleLabel}
              </Text>
            </View>
          ) : (
            <View style={{ width: 80 }} />
          )}
        </View>
      </View>

      {/* Chat */}
      <ChatScreen
        key={`chat-${chatKey}-${selectedComputer.id}`}
        baseUrl=""
        token="graphql"
        agentType="computer"
        agentName={selectedComputer.name || "Computer"}
        agents={[]}
        selectedAgentId=""
        threadId={activeThread?.id}
        tenantId={tenantId}
        caller={caller}
        onNewChat={handleNewChat}
        mentionCandidates={[]}
        hideHeader
      />
    </View>
  );
}
