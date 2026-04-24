import React, { useState, useMemo, useCallback } from "react";
import { View, Pressable, ScrollView, Alert, Modal, Dimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColorScheme } from "nativewind";
import { Check, Circle, ChevronDown, ChevronUp } from "lucide-react-native";
import { DetailLayout } from "@/components/layout/detail-layout";
import { useAuth } from "@/lib/auth-context";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { getThreadHeaderLabel } from "@/lib/thread-display";
import { useQuery, useMutation } from "urql";
import {
  ThreadQuery,
  AgentsQuery,
  UpdateThreadMutation,
} from "@/lib/graphql-queries";

function statusColor(status: string, isDark: boolean): string {
  switch (status) {
    case "IN_PROGRESS": return isDark ? "#60a5fa" : "#2563eb";
    case "TODO": return isDark ? "#a78bfa" : "#7c3aed";
    case "BLOCKED": return isDark ? "#f87171" : "#dc2626";
    case "DONE": return isDark ? "#4ade80" : "#16a34a";
    case "BACKLOG": return isDark ? "#a3a3a3" : "#737373";
    default: return isDark ? "#a3a3a3" : "#737373";
  }
}

const STATUS_OPTIONS = [
  { label: "In Progress", value: "IN_PROGRESS" },
  { label: "Todo", value: "TODO" },
  { label: "Blocked", value: "BLOCKED" },
  { label: "Done", value: "DONE" },
  { label: "Backlog", value: "BACKLOG" },
];

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function SectionHeader({ title, expanded, onToggle, colors }: { title: string; expanded: boolean; onToggle: () => void; colors: { mutedForeground: string } }) {
  return (
    <Pressable
      onPress={onToggle}
      className="flex-row items-center justify-between px-4 py-3 bg-neutral-100 dark:bg-neutral-900"
    >
      <Text className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
        {title}
      </Text>
      {expanded ? (
        <ChevronUp size={18} color={colors.mutedForeground} />
      ) : (
        <ChevronDown size={18} color={colors.mutedForeground} />
      )}
    </Pressable>
  );
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="flex-row items-center justify-between px-4 py-3 border-t border-neutral-200 dark:border-neutral-800">
      <Text className="text-sm text-neutral-500 dark:text-neutral-400">{label}</Text>
      <View className="flex-row items-center">{children}</View>
    </View>
  );
}

export default function ThreadInfoRoute() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;

  const [{ data: threadData }, reexecuteThread] = useQuery({
    query: ThreadQuery,
    variables: { id: threadId! },
    pause: !threadId,
  });
  const thread = threadData?.thread as any;

  const [{ data: agentsData }] = useQuery({
    query: AgentsQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });
  const agentName = useMemo(() => {
    if (!thread?.agentId) return "Agent";
    const agent = ((agentsData?.agents ?? []) as any[]).find((a: any) => a.id === thread.agentId);
    return agent?.name || "Agent";
  }, [agentsData?.agents, thread?.agentId]);

  // ── Status ──
  const [optimisticStatus, setOptimisticStatus] = useState<string | null>(null);
  const serverStatus = (thread?.status || "IN_PROGRESS").toUpperCase();
  const currentStatus = optimisticStatus || serverStatus;

  const [statusDropdownVisible, setStatusDropdownVisible] = useState(false);
  const [statusAnchor, setStatusAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const statusTriggerRef = React.useRef<View>(null);
  const [statusSaving, setStatusSaving] = useState(false);

  const [, executeUpdateThread] = useMutation(UpdateThreadMutation);

  const handleStatusChange = useCallback(async (newStatus: string) => {
    if (!threadId) return;
    setStatusDropdownVisible(false);
    setStatusSaving(true);
    const { error } = await executeUpdateThread({ id: threadId, input: { status: newStatus as any } });
    setStatusSaving(false);
    if (error) {
      Alert.alert("Error", "Failed to update status.");
      return;
    }
    setOptimisticStatus(newStatus);
    if (newStatus === "DONE") router.back();
    else reexecuteThread({ requestPolicy: "network-only" });
  }, [threadId, executeUpdateThread, router, reexecuteThread]);

  const openStatusDropdown = useCallback(() => {
    statusTriggerRef.current?.measureInWindow((x, y, width, height) => {
      setStatusAnchor({ x, y, width, height });
      setStatusDropdownVisible(true);
    });
  }, []);

  const [propertiesExpanded, setPropertiesExpanded] = useState(true);

  if (!threadId) return <View className="flex-1 bg-white dark:bg-black" />;

  return (
    <DetailLayout title="Thread Info">
      <ScrollView className="flex-1">
        {/* Properties */}
        <SectionHeader title="Properties" expanded={propertiesExpanded} onToggle={() => setPropertiesExpanded(!propertiesExpanded)} colors={colors} />

        {propertiesExpanded && (
          <>
            <PropertyRow label="Status">
              <Pressable
                ref={statusTriggerRef}
                onPress={statusSaving ? undefined : openStatusDropdown}
                disabled={statusSaving}
                className="flex-row items-center gap-1.5 active:opacity-70 rounded-md border border-neutral-300 dark:border-neutral-700 px-2.5 py-1"
              >
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusColor(currentStatus, isDark) }} />
                <Text className="text-sm font-medium">{STATUS_OPTIONS.find((o) => o.value === currentStatus)?.label || currentStatus}</Text>
                <ChevronDown size={14} color={colors.mutedForeground} />
              </Pressable>
            </PropertyRow>

            {thread?.priority && (
              <PropertyRow label="Priority">
                <Text className="text-sm font-medium">{(thread.priority as string).charAt(0) + (thread.priority as string).slice(1).toLowerCase()}</Text>
              </PropertyRow>
            )}

            {thread?.type && (
              <PropertyRow label="Type">
                <Text className="text-sm font-medium">{(thread.type as string).charAt(0) + (thread.type as string).slice(1).toLowerCase()}</Text>
              </PropertyRow>
            )}

            <PropertyRow label="Agent">
              <Text className="text-sm font-medium">{agentName}</Text>
            </PropertyRow>

            {thread?.createdAt && (
              <PropertyRow label="Created">
                <Text className="text-sm font-medium">{formatDateTime(thread.createdAt)}</Text>
              </PropertyRow>
            )}

            {thread?.updatedAt && (
              <PropertyRow label="Updated">
                <Text className="text-sm font-medium">{relativeTime(thread.updatedAt)}</Text>
              </PropertyRow>
            )}
          </>
        )}

      </ScrollView>

      {/* Status dropdown modal */}
      {statusDropdownVisible && statusAnchor && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setStatusDropdownVisible(false)}>
          <Pressable style={{ flex: 1 }} onPress={() => setStatusDropdownVisible(false)}>
            <View
              onStartShouldSetResponder={() => true}
              style={{
                position: "absolute",
                top: statusAnchor.y + statusAnchor.height + 4,
                right: Dimensions.get("window").width - (statusAnchor.x + statusAnchor.width),
                minWidth: 180,
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
                    <View className="flex-row items-center gap-2">
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusColor(opt.value, isDark) }} />
                      <Text className={`text-sm ${isSelected ? "font-semibold" : ""}`}
                        style={isSelected ? { color: colors.primary } : undefined}
                      >
                        {opt.label}
                      </Text>
                    </View>
                    {isSelected && <Check size={16} color={colors.primary} />}
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Modal>
      )}
    </DetailLayout>
  );
}
