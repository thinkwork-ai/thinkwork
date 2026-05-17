import { useState, useCallback, useMemo, useEffect } from "react";
import {
  View,
  ScrollView,
  Pressable,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { useAgents, useCreateThread } from "@thinkwork/react-native-sdk";
import { Button } from "@/components/ui/button";
import { Text, Muted } from "@/components/ui/typography";
import { MobileRow } from "@/components/ui/mobile-row";
import { DataTable, Column } from "@/components/ui/data-table";
import { useIsLargeScreen } from "@/lib/hooks/use-media-query";
import { Plus, X } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { DetailLayout } from "@/components/layout/detail-layout";
import { useQuery } from "urql";
// TODO(sdk): SDK `useThreads` lacks filter args + `Thread.identifier`.
//            Keep local ThreadsQuery until SDK widens.
import { AssignedComputersQuery, ThreadsQuery } from "@/lib/graphql-queries";

interface Thread {
  id: string;
  tenantId: string;
  agentId?: string | null;
  computerId?: string | null;
  number?: number | null;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
}

// ThreadLifecycleStatus → operator-facing label. Mirrors admin's
// ThreadLifecycleBadge (apps/admin/src/components/threads/ThreadLifecycleBadge.tsx).
const LIFECYCLE_LABELS: Record<string, string> = {
  RUNNING: "Running",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
  IDLE: "Idle",
  AWAITING_USER: "Awaiting user",
};

function lifecycleLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return LIFECYCLE_LABELS[status] ?? "Idle";
}

function formatRelativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "\u2014";
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// Mobile row component
function ThreadRowItem({
  thread,
  agents,
  computerName,
  onPress,
  isLast,
}: {
  thread: Thread;
  agents: { id: string; name: string; status?: string }[] | undefined;
  computerName?: string | null;
  onPress: () => void;
  isLast?: boolean;
}) {
  const getAgentName = (agentId?: any) => {
    if (!agentId) return "";
    const a = agents?.find((a) => a.id === agentId);
    if (!a) return "";
    return a.status === "revoked" ? `${a.name} (removed)` : a.name;
  };

  const assignee = thread.computerId
    ? computerName || "Computer"
    : getAgentName(thread.agentId) || "Agent";

  return (
    <MobileRow
      onPress={onPress}
      isLast={isLast}
      line1Left={
        <View className="flex-row items-center gap-1.5 flex-shrink">
          <Text
            className="text-base font-medium text-neutral-900 dark:text-neutral-100 flex-shrink leading-none"
            numberOfLines={1}
          >
            {thread.number ? `#${thread.number} ` : ""}
            {thread.title}
          </Text>
        </View>
      }
      line2Left={
        <>
          <Muted className="text-sm" numberOfLines={1}>
            {assignee}
          </Muted>
          <Muted className="text-sm">{"\u00B7"}</Muted>
          <Muted className="text-sm">
            {formatRelativeTime(new Date(thread.updatedAt).getTime())}
          </Muted>
        </>
      }
      line2Right={
        <Muted className="text-sm text-neutral-400 dark:text-neutral-500">
          {lifecycleLabel((thread as any).lifecycleStatus)}
        </Muted>
      }
    />
  );
}

// Create Thread Modal
function CreateThreadModal({
  visible,
  onClose,
  computer,
  computers,
  selectedComputerId,
  onComputerChange,
}: {
  visible: boolean;
  onClose: () => void;
  computer?: { id: string; name?: string | null } | null;
  computers: { id: string; name?: string | null; slug?: string | null }[];
  selectedComputerId: string | null;
  onComputerChange: (id: string) => void;
}) {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const createThread = useCreateThread();
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) {
      Alert.alert("Error", "Please enter a thread title");
      return;
    }
    if (!computer?.id) {
      Alert.alert("Error", "No Computer available to handle the thread");
      return;
    }

    setCreating(true);
    try {
      if (!tenantId) throw new Error("No tenant");
      await createThread({
        tenantId,
        title: title.trim(),
        computerId: computer.id,
      } as any);
      setTitle("");
      onClose();
    } catch (err) {
      Alert.alert("Error", "Failed to create thread");
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    setTitle("");
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        className="flex-1 bg-white dark:bg-neutral-950"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <Text className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            New Thread
          </Text>
          <Pressable onPress={handleClose} className="p-2">
            <X size={24} color="#737373" />
          </Pressable>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerClassName="px-4 py-4"
          keyboardShouldPersistTaps="handled"
        >
          {/* Title */}
          <View className="mb-4">
            <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
              Title
            </Text>
            <TextInput
              className="h-12 border border-neutral-300 dark:border-neutral-700 rounded-lg px-3 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100"
              placeholder="What needs to be done?"
              placeholderTextColor="#71717a"
              value={title}
              onChangeText={setTitle}
              autoCapitalize="words"
            />
          </View>

          {/* Computer target */}
          <View className="mb-6">
            <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
              Computer
            </Text>
            {computers.length > 1 ? (
              <View className="gap-2">
                {computers.map((item) => {
                  const selected = item.id === selectedComputerId;
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => onComputerChange(item.id)}
                      className="h-12 rounded-lg border px-3 flex-row items-center"
                      style={{
                        borderColor: selected ? "#0284c7" : "#d4d4d8",
                        backgroundColor: selected ? "#e0f2fe" : "transparent",
                      }}
                    >
                      <Text className="text-neutral-900 dark:text-neutral-100">
                        {item.name || item.slug || "Computer"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View className="h-12 border border-neutral-300 dark:border-neutral-700 rounded-lg px-3 bg-white dark:bg-neutral-900 flex-row items-center">
                <Text className="text-neutral-900 dark:text-neutral-100">
                  {computer?.name || "No Computer available"}
                </Text>
              </View>
            )}
          </View>
        </ScrollView>

        {/* Footer */}
        <View className="px-4 py-4 border-t border-neutral-200 dark:border-neutral-800">
          <Button
            onPress={handleCreate}
            loading={creating}
            disabled={!title.trim() || !computer?.id}
          >
            Create Thread
          </Button>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function ThreadsScreen() {
  const router = useRouter();
  const isLargeScreen = useIsLargeScreen();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const { user } = useAuth();
  const tenantId = user?.tenantId;

  // Defer agents query to avoid synchronous cache update triggering a setState
  // in HomeScreen (which shares the same useAgents query) during our render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [{ data: computerData, fetching: computerFetching }] = useQuery({
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
  const [selectedComputerId, setSelectedComputerId] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (
      selectedComputerId &&
      assignedComputers.some((computer) => computer.id === selectedComputerId)
    ) {
      return;
    }
    setSelectedComputerId(assignedComputers[0]?.id ?? null);
  }, [assignedComputers, selectedComputerId]);
  const selectedComputer = useMemo(
    () =>
      assignedComputers.find(
        (computer) => computer.id === selectedComputerId,
      ) ?? null,
    [assignedComputers, selectedComputerId],
  );

  const [{ data: threadsData, fetching: threadsFetching }] = useQuery({
    query: ThreadsQuery,
    variables: { tenantId: tenantId!, computerId: selectedComputer?.id },
    pause: !tenantId || computerFetching || !selectedComputer?.id,
  });
  const { agents: sdkAgents, loading: agentsFetching } = useAgents({
    tenantId: mounted ? tenantId : undefined,
  });
  const threads = (threadsData?.threads ?? []) as Thread[];
  // SDK's Agent type allows `status: string | null`; downstream row props
  // expect `status?: string | undefined`. Normalize the null away.
  const agents = useMemo(
    () =>
      sdkAgents.length > 0
        ? sdkAgents.map((a) => ({
            id: a.id,
            name: a.name,
            status: a.status ?? undefined,
          }))
        : undefined,
    [sdkAgents],
  );
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const handleRowPress = useCallback(
    (thread: Thread) => {
      router.push(`/threads/${thread.id}`);
    },
    [router],
  );

  const getAssigneeName = useCallback(
    (thread: Thread) => {
      if (thread.computerId) return selectedComputer?.name || "Computer";
      const agentId = thread.agentId;
      if (!agentId) return "\u2014";
      const a = agents?.find((a: any) => a.id === agentId);
      if (!a) return "Unknown";
      return a.status === "revoked" ? `${a.name} (removed)` : a.name;
    },
    [agents, selectedComputer?.name],
  );

  // Table columns for wide screens
  const columns: Column<Thread>[] = useMemo(
    () => [
      {
        key: "title",
        header: "Thread",
        flex: 3,
        minWidth: 250,
        render: (item) => (
          <Text
            className="text-sm font-medium text-neutral-900 dark:text-neutral-100"
            numberOfLines={1}
          >
            {item.number ? `#${item.number} ` : ""}
            {item.title}
          </Text>
        ),
      },
      {
        key: "assignee",
        header: "Assignee",
        flex: 1.5,
        minWidth: 120,
        render: (item) => (
          <Muted className="text-sm">{getAssigneeName(item)}</Muted>
        ),
      },
      {
        key: "status",
        header: "Status",
        flex: 1,
        minWidth: 80,
        render: (item) => (
          <Muted className="text-sm">
            {lifecycleLabel((item as any).lifecycleStatus)}
          </Muted>
        ),
      },
      {
        key: "lastActivity",
        header: "Activity",
        flex: 1,
        minWidth: 80,
        align: "right",
        render: (item) => (
          <Muted className="text-sm">
            {formatRelativeTime(new Date(item.updatedAt).getTime())}
          </Muted>
        ),
      },
    ],
    [getAssigneeName],
  );

  // Sort logic (newest first)
  const filteredThreads = useMemo(() => {
    return [...threads].sort(
      (a: Thread, b: Thread) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [threads]);

  const isLoading = threadsFetching || agentsFetching || computerFetching;

  const renderMobileItem = ({
    item,
    index,
  }: {
    item: Thread;
    index: number;
  }) => (
    <ThreadRowItem
      thread={item}
      agents={agents}
      computerName={selectedComputer?.name}
      onPress={() => handleRowPress(item)}
      isLast={index === filteredThreads.length - 1}
    />
  );

  return (
    <DetailLayout title="Threads">
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : (
        <>
          {/* Thread List */}
          {isLargeScreen ? (
            <ScrollView
              className="flex-1"
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingTop: 12,
                paddingBottom: 16,
              }}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
              }
            >
              <DataTable
                data={filteredThreads}
                columns={columns}
                keyExtractor={(item) => item.id}
                onRowPress={handleRowPress}
                emptyMessage="No threads found."
              />
            </ScrollView>
          ) : (
            <View className="flex-1">
              {filteredThreads.length === 0 ? (
                <View className="py-12 items-center">
                  <Muted className="text-center">No threads found.</Muted>
                </View>
              ) : (
                <FlashList
                  data={filteredThreads}
                  renderItem={renderMobileItem}
                  keyExtractor={(item) => item.id}
                  refreshControl={
                    <RefreshControl
                      refreshing={refreshing}
                      onRefresh={onRefresh}
                    />
                  }
                />
              )}
            </View>
          )}

          {/* Create Thread Modal */}
          <CreateThreadModal
            visible={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            computer={selectedComputer}
            computers={assignedComputers}
            selectedComputerId={selectedComputerId}
            onComputerChange={setSelectedComputerId}
          />
        </>
      )}
    </DetailLayout>
  );
}
