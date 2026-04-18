import { useState } from "react";
import { View, Text, ScrollView, Pressable, Modal, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { DetailLayout } from "@/components/layout/detail-layout";
import {
  useAgents,
  useMessages,
  useThread,
  useUpdateThread,
} from "@thinkwork/react-native-sdk";
import { useMe } from "@/lib/hooks/use-users";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  MessageCircle,
  FileText,
  Paperclip,
  ChevronRight,
  Trash2,
} from "lucide-react-native";
import { HeaderContextMenu } from "@/components/ui/header-context-menu";
import { COLORS } from "@/lib/theme";

type ThreadStatus = "OPEN" | "IN_PROGRESS" | "CLOSED";

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  CLOSED: "Closed",
};

const STATUS_ORDER: string[] = ["OPEN", "IN_PROGRESS", "CLOSED"];

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function InfoRow({
  label,
  value,
  valueComponent,
  isLast,
}: {
  label: string;
  value?: string;
  valueComponent?: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <View
      className={`flex-row items-center justify-between px-4 py-3 ${
        isLast ? "" : "border-b border-neutral-100 dark:border-neutral-800"
      }`}
    >
      <Text className="text-base text-neutral-500 dark:text-neutral-400">{label}</Text>
      {valueComponent || (
        <Text className="text-base text-neutral-900 dark:text-neutral-100">{value}</Text>
      )}
    </View>
  );
}

function NavRow({
  icon,
  label,
  badge,
  onPress,
  isLast,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  onPress: () => void;
  isLast?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center px-4 py-3 active:bg-neutral-50 dark:active:bg-neutral-800 ${
        isLast ? "" : "border-b border-neutral-100 dark:border-neutral-800"
      }`}
    >
      <View className="w-6 items-center mr-3">{icon}</View>
      <Text className="flex-1 text-base text-neutral-900 dark:text-neutral-100">{label}</Text>
      {badge !== undefined && badge > 0 && (
        <View className="bg-neutral-200 dark:bg-neutral-700 rounded-full px-2 py-0.5 mr-2">
          <Text className="text-xs text-neutral-600 dark:text-neutral-300 font-medium">{badge}</Text>
        </View>
      )}
      <ChevronRight size={16} color="#a3a3a3" />
    </Pressable>
  );
}

export default function ThreadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const { thread, loading: threadFetching } = useThread(id);
  const [meResult] = useMe();
  const tenantId = meResult.data?.me?.tenantId;
  const { agents } = useAgents({ tenantId });
  const { messages } = useMessages(id);

  const executeUpdateThread = useUpdateThread();

  // TODO: deleteThread — replace with GraphQL mutation
  const deleteThread = async (_args: { threadId: string }) => {
    throw new Error("TODO: implement deleteThread via GraphQL");
  };

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { colorScheme } = useColorScheme();
  const themeColors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  if (threadFetching && !thread) {
    return (
      <DetailLayout showSidebar={false} title="Loading...">
        <View className="flex-1 px-4">
          <Skeleton className="h-12 w-full mt-4" />
          <Skeleton className="h-12 w-full mt-2" />
          <Skeleton className="h-12 w-full mt-2" />
          <Skeleton className="h-32 w-full mt-4" />
        </View>
      </DetailLayout>
    );
  }

  if (!thread) {
    return (
      <DetailLayout showSidebar={false} title="Not Found">
        <View className="flex-1 items-center justify-center px-4">
          <Text className="text-neutral-500 dark:text-neutral-400 text-center mb-4">
            Thread not found
          </Text>
          <Button onPress={() => router.back()}>Go Back</Button>
        </View>
      </DetailLayout>
    );
  }

  const status = thread.status as string;

  const getAgentName = (agentId?: any) => {
    if (!agentId) return "None";
    return agents?.find((a: any) => a.id === agentId)?.name ?? "Unknown";
  };

  const handleStatusChange = async (newStatus: string) => {
    await executeUpdateThread(id as string, { status: newStatus });
  };

  const hasMeta = (thread as any).metadata != null && typeof (thread as any).metadata === "object" && Object.keys((thread as any).metadata).length > 0;

  return (
    <DetailLayout showSidebar={false} title={thread.title ?? "Thread"}
      headerRight={
        <HeaderContextMenu
          items={[
            {
              label: "Delete Thread",
              icon: Trash2,
              destructive: true,
              onPress: () => setShowDeleteModal(true),
            },
          ]}
        />
      }
    >
      <ScrollView className="flex-1" contentContainerClassName="pb-8">
        <View className="w-full px-4" style={{ maxWidth: 768 }}>

        {/* Summary Card */}
        <View className="mt-4 bg-white dark:bg-neutral-900 rounded-xl overflow-hidden border border-neutral-100 dark:border-neutral-800">
          <InfoRow
            label="Status"
            valueComponent={
              <Pressable onPress={() => setShowStatusPicker(!showStatusPicker)}>
                <Text className="text-base text-sky-500 font-medium">
                  {STATUS_LABELS[status] || status}
                </Text>
              </Pressable>
            }
          />
          {showStatusPicker && (
            <View className="border-b border-neutral-100 dark:border-neutral-800 py-1 px-4">
              {STATUS_ORDER.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => {
                    handleStatusChange(s);
                    setShowStatusPicker(false);
                  }}
                  className={`px-3 py-2.5 rounded-lg mb-0.5 ${
                    status === s ? "bg-sky-500/10" : ""
                  }`}
                >
                  <Text
                    className={`text-base ${
                      status === s
                        ? "text-sky-500 font-semibold"
                        : "text-neutral-700 dark:text-neutral-300"
                    }`}
                  >
                    {STATUS_LABELS[s] || s}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          <InfoRow
            label="Agent"
            value={getAgentName(thread.agentId)}
          />
          {thread.type && (
            <InfoRow
              label="Type"
              value={thread.type}
            />
          )}
          {thread.priority && (
            <InfoRow
              label="Priority"
              value={thread.priority}
            />
          )}
          {thread.number && (
            <InfoRow
              label="Number"
              value={`#${thread.number}`}
            />
          )}
          <InfoRow label="Created" value={formatDate(new Date(thread.createdAt).getTime())} />
          {(thread as any).labels && (thread as any).labels.length > 0 && (
            <InfoRow
              label="Labels"
              valueComponent={
                <View className="flex-row flex-wrap gap-1 justify-end">
                  {(thread as any).labels.map((label: string) => (
                    <Badge key={label} variant="outline">
                      <Text className="text-xs">{label}</Text>
                    </Badge>
                  ))}
                </View>
              }
            />
          )}
          <Pressable
            onPress={() => router.push(`/threads/${id}/conversation`)}
            className="flex-row items-center justify-between px-4 py-3 active:bg-neutral-50 dark:active:bg-neutral-800"
          >
            <Text className="text-base text-neutral-500 dark:text-neutral-400">Conversation</Text>
            <View className="flex-row items-center gap-2">
              {(messages?.length ?? 0) > 0 && (
                <View style={{ backgroundColor: "#0ea5e9" }} className="rounded-full px-2 py-0.5">
                  <Text className="text-xs text-white font-medium">
                    {messages?.length}
                  </Text>
                </View>
              )}
              <ChevronRight size={16} color="#a3a3a3" />
            </View>
          </Pressable>
        </View>

        {/* Navigation Rows */}
        {hasMeta && (
          <View className="mt-4 bg-white dark:bg-neutral-900 rounded-xl overflow-hidden border border-neutral-100 dark:border-neutral-800">
            <NavRow
              icon={<FileText size={18} color="#8b5cf6" />}
              label="Details"
              onPress={() => router.push(`/threads/${id}/details`)}
              isLast
            />
          </View>
        )}

        </View>
      </ScrollView>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => !deleting && setShowDeleteModal(false)}
      >
        <View className="flex-1 justify-center items-center bg-black/60 px-6">
          <View
            className="w-full max-w-sm rounded-xl p-6 border"
            style={{
              backgroundColor: themeColors.card,
              borderColor: themeColors.border,
            }}
          >
            <View className="items-center mb-4">
              <AlertTriangle size={40} color="#ef4444" />
            </View>
            <Text className="text-lg font-bold text-center text-neutral-900 dark:text-neutral-100 mb-2">
              Delete Thread?
            </Text>
            <Text className="text-sm text-center text-neutral-600 dark:text-neutral-400 mb-4">
              This will permanently delete this thread and all its messages. This action cannot be
              undone.
            </Text>
            <Pressable
              onPress={async () => {
                setDeleting(true);
                try {
                  await deleteThread({ threadId: id as string });
                  setShowDeleteModal(false);
                  router.back();
                } catch (e: any) {
                  Alert.alert("Error", e.message || "Failed to delete thread");
                } finally {
                  setDeleting(false);
                }
              }}
              disabled={deleting}
              style={{
                backgroundColor: deleting ? "#d4d4d4" : "#dc2626",
                paddingVertical: 14,
                borderRadius: 10,
                alignItems: "center",
                marginTop: 8,
                opacity: deleting ? 0.5 : 1,
              }}
            >
              {deleting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>
                  Delete Thread
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => setShowDeleteModal(false)}
              disabled={deleting}
              style={{ paddingVertical: 12, alignItems: "center", marginTop: 8 }}
            >
              <Text className="font-medium text-neutral-500 dark:text-neutral-400">Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </DetailLayout>
  );
}
