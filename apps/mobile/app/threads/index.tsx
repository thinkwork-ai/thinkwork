import { useState, useCallback, useMemo, useEffect } from "react";
import { View, ScrollView, Pressable, RefreshControl, Modal, TextInput, Alert, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { useAgents } from "@/lib/hooks/use-agents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Text, Muted } from "@/components/ui/typography";
import { MobileRow } from "@/components/ui/mobile-row";
import { DataTable, Column } from "@/components/ui/data-table";
import { useIsLargeScreen } from "@/lib/hooks/use-media-query";
import { Plus, X, ChevronDown } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { DetailLayout } from "@/components/layout/detail-layout";
import { useQuery, useMutation } from "urql";
import { ThreadsQuery, CreateThreadMutation } from "@/lib/graphql-queries";

type ThreadType = "CHAT" | "TASK" | "EMAIL" | "SYSTEM";
type ThreadStatus = "OPEN" | "IN_PROGRESS" | "CLOSED";

interface Thread {
  id: string;
  tenantId: string;
  agentId?: string | null;
  number?: number | null;
  title: string;
  type: string;
  status: string;
  priority?: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
}

const TYPE_CONFIG: Record<string, { label: string; variant: "outline" | "secondary" | "success" | "warning" | "destructive" }> = {
  CHAT: { label: "Chat", variant: "outline" },
  TASK: { label: "Task", variant: "secondary" },
  EMAIL: { label: "Email", variant: "warning" },
  SYSTEM: { label: "System", variant: "destructive" },
};

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
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function TypeBadge({ type }: { type: string }) {
  const config = TYPE_CONFIG[type] || TYPE_CONFIG.CHAT;
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function FilterPill({ label, count, isActive, onPress }: { label: string; count: number; isActive: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-4 h-9 rounded-full items-center justify-center ${
        isActive
          ? "bg-sky-500"
          : "bg-neutral-100 dark:bg-neutral-800"
      }`}
    >
      <Text className={`text-base font-medium ${
        isActive
          ? "text-white"
          : "text-neutral-700 dark:text-neutral-300"
      }`}>
        {label} ({count})
      </Text>
    </Pressable>
  );
}

// Mobile row component
function ThreadRowItem({
  thread,
  agents,
  onPress,
  isLast
}: {
  thread: Thread;
  agents: { id: string; name: string; status?: string }[] | undefined;
  onPress: () => void;
  isLast?: boolean;
}) {
  const getAgentName = (agentId?: any) => {
    if (!agentId) return "";
    const a = agents?.find((a) => a.id === agentId);
    if (!a) return "";
    return a.status === "revoked" ? `${a.name} (removed)` : a.name;
  };

  const assignee = getAgentName(thread.agentId) || "Agent";

  return (
    <MobileRow
      onPress={onPress}
      isLast={isLast}
      line1Left={
        <View className="flex-row items-center gap-1.5 flex-shrink">
          <Text className="text-base font-medium text-neutral-900 dark:text-neutral-100 flex-shrink leading-none" numberOfLines={1}>
            {thread.number ? `#${thread.number} ` : ""}{thread.title}
          </Text>
        </View>
      }
      line1Right={<TypeBadge type={thread.type} />}
      line2Left={
        <>
          <Muted className="text-sm" numberOfLines={1}>{assignee}</Muted>
          <Muted className="text-sm">{"\u00B7"}</Muted>
          <Muted className="text-sm">{formatRelativeTime(new Date(thread.updatedAt).getTime())}</Muted>
        </>
      }
      line2Right={
        <Muted className="text-sm text-neutral-400 dark:text-neutral-500">
          {thread.status}
        </Muted>
      }
    />
  );
}

// Create Thread Modal
function CreateThreadModal({
  visible,
  onClose,
  agents
}: {
  visible: boolean;
  onClose: () => void;
  agents: { id: string; name: string; status?: string }[] | undefined;
}) {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [, executeCreateThread] = useMutation(CreateThreadMutation);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [creating, setCreating] = useState(false);

  // Show all non-revoked agents
  const availableAgents = agents?.filter(g =>
    g.status !== "revoked"
  ) ?? [];

  // Default to first available agent
  const defaultAgent = availableAgents[0];
  const effectiveAgentId = selectedAgentId || defaultAgent?.id;
  const selectedAgent = availableAgents.find(g => g.id === effectiveAgentId);

  const handleCreate = async () => {
    if (!title.trim()) {
      Alert.alert("Error", "Please enter a thread title");
      return;
    }
    if (!effectiveAgentId) {
      Alert.alert("Error", "No agent available to assign the thread");
      return;
    }

    setCreating(true);
    try {
      await executeCreateThread({
        input: {
          tenantId,
          title: title.trim(),
          description: description.trim() || undefined,
          type: "TASK",
          agentId: effectiveAgentId,
        },
      });
      setTitle("");
      setDescription("");
      setSelectedAgentId(null);
      onClose();
    } catch (err) {
      Alert.alert("Error", "Failed to create thread");
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    setTitle("");
    setDescription("");
    setSelectedAgentId(null);
    setShowAgentPicker(false);
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

        <ScrollView className="flex-1" contentContainerClassName="px-4 py-4" keyboardShouldPersistTaps="handled">
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

          {/* Description */}
          <View className="mb-4">
            <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
              Description (optional)
            </Text>
            <TextInput
              className="h-24 border border-neutral-300 dark:border-neutral-700 rounded-lg px-3 py-2 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100"
              placeholder="Add more details..."
              placeholderTextColor="#71717a"
              value={description}
              onChangeText={setDescription}
              multiline
              textAlignVertical="top"
            />
          </View>

          {/* Agent Selector */}
          <View className="mb-6">
            <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
              Assign to Agent
            </Text>
            <Pressable
              onPress={() => setShowAgentPicker(!showAgentPicker)}
              className="h-12 border border-neutral-300 dark:border-neutral-700 rounded-lg px-3 bg-white dark:bg-neutral-900 flex-row items-center justify-between"
            >
              <Text className="text-neutral-900 dark:text-neutral-100">
                {selectedAgent?.name || "Select agent..."}
              </Text>
              <ChevronDown size={20} color="#737373" />
            </Pressable>

            {showAgentPicker && (
              <View className="mt-2 border border-neutral-300 dark:border-neutral-700 rounded-lg overflow-hidden">
                {availableAgents.map((ag) => (
                  <Pressable
                    key={ag.id}
                    onPress={() => {
                      setSelectedAgentId(ag.id);
                      setShowAgentPicker(false);
                    }}
                    className={`px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 ${
                      effectiveAgentId === ag.id ? "bg-sky-50 dark:bg-sky-900/20" : "bg-white dark:bg-neutral-900"
                    }`}
                  >
                    <Text className={`${
                      effectiveAgentId === ag.id
                        ? "text-sky-600 dark:text-sky-400 font-medium"
                        : "text-neutral-900 dark:text-neutral-100"
                    }`}>
                      {ag.name}
                    </Text>
                  </Pressable>
                ))}
                {availableAgents.length === 0 && (
                  <View className="px-4 py-3">
                    <Muted>No agents available</Muted>
                  </View>
                )}
              </View>
            )}
          </View>
        </ScrollView>

        {/* Footer */}
        <View className="px-4 py-4 border-t border-neutral-200 dark:border-neutral-800">
          <Button onPress={handleCreate} loading={creating} disabled={!title.trim()}>
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
  useEffect(() => { setMounted(true); }, []);

  const [{ data: threadsData, fetching: threadsFetching }] = useQuery({
    query: ThreadsQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });
  const [{ data: agentsData, fetching: agentsFetching }] = useAgents(mounted ? tenantId : undefined);
  const threads = (threadsData?.threads ?? []) as Thread[];
  const agents = agentsData?.agents ?? undefined;
  const [refreshing, setRefreshing] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [showCreateModal, setShowCreateModal] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const handleRowPress = useCallback((thread: Thread) => {
    router.push(`/threads/${thread.id}`);
  }, [router]);

  const getAgentName = useCallback((agentId?: any) => {
    if (!agentId) return "\u2014";
    const a = agents?.find((a: any) => a.id === agentId);
    if (!a) return "Unknown";
    return a.status === "revoked" ? `${a.name} (removed)` : a.name;
  }, [agents]);

  // Table columns for wide screens
  const columns: Column<Thread>[] = useMemo(() => [
    {
      key: "title",
      header: "Thread",
      flex: 3,
      minWidth: 250,
      render: (item) => (
        <Text className="text-sm font-medium text-neutral-900 dark:text-neutral-100" numberOfLines={1}>
          {item.number ? `#${item.number} ` : ""}{item.title}
        </Text>
      ),
    },
    {
      key: "type",
      header: "Type",
      flex: 1,
      minWidth: 100,
      render: (item) => <TypeBadge type={item.type} />,
    },
    {
      key: "assignee",
      header: "Assignee",
      flex: 1.5,
      minWidth: 120,
      render: (item) => (
        <Muted className="text-sm">
          {getAgentName(item.agentId) || "Agent"}
        </Muted>
      ),
    },
    {
      key: "status",
      header: "Status",
      flex: 1,
      minWidth: 80,
      render: (item) => (
        <Muted className="text-sm">{item.status}</Muted>
      ),
    },
    {
      key: "lastActivity",
      header: "Activity",
      flex: 1,
      minWidth: 80,
      align: "right",
      render: (item) => (
        <Muted className="text-sm">{formatRelativeTime(new Date(item.updatedAt).getTime())}</Muted>
      ),
    },
  ], [getAgentName]);

  // Filter and sort logic (newest first)
  const filteredThreads = useMemo(() => {
    return threads
      .filter((t: Thread) => {
        if (typeFilter === "all") return true;
        return t.type === typeFilter;
      })
      .sort((a: Thread, b: Thread) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [threads, typeFilter]);

  const typeCounts = useMemo(() => {
    return threads.reduce((acc: Record<string, number>, t: Thread) => {
      acc[t.type] = (acc[t.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [threads]);

  const activeCount = threads.length;

  const isLoading = threadsFetching || agentsFetching;

  const renderMobileItem = ({ item, index }: { item: Thread; index: number }) => (
    <ThreadRowItem
      thread={item}
      agents={agents}
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
          {/* Filter Bar */}
          <View className="border-b border-neutral-200 dark:border-neutral-800">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10, gap: 8, flexDirection: "row" }}
            >
              <FilterPill label="All" count={activeCount} isActive={typeFilter === "all"} onPress={() => setTypeFilter("all")} />
              {Object.keys(TYPE_CONFIG).map((type) => (
                <FilterPill
                  key={type}
                  label={TYPE_CONFIG[type].label}
                  count={typeCounts[type] || 0}
                  isActive={typeFilter === type}
                  onPress={() => setTypeFilter(type)}
                />
              ))}
            </ScrollView>
          </View>

          {/* Thread List */}
          {isLargeScreen ? (
            <ScrollView
              className="flex-1"
              contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
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
                  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                />
              )}
            </View>
          )}

          {/* Create Thread Modal */}
          <CreateThreadModal
            visible={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            agents={agents}
          />
        </>
      )}
    </DetailLayout>
  );
}
