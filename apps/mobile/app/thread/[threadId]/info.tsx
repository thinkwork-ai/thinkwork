import React, { useState, useMemo } from "react";
import { View, Pressable, ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useColorScheme } from "nativewind";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { DetailLayout } from "@/components/layout/detail-layout";
import { useAuth } from "@/lib/auth-context";
import { Text } from "@/components/ui/typography";
import { COLORS } from "@/lib/theme";
import { useQuery } from "urql";
import { ThreadQuery, AgentsQuery } from "@/lib/graphql-queries";

// ThreadLifecycleStatus → label + dot color. Read-only; status is derived
// server-side via `thread.lifecycleStatus` (U4, #546). Null signals a DB
// loader error and renders nothing.
const LIFECYCLE_LABELS: Record<string, string> = {
  RUNNING: "Running",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
  IDLE: "Idle",
  AWAITING_USER: "Awaiting user",
};

function lifecycleColor(status: string | null | undefined, isDark: boolean): string {
  if (!status) return isDark ? "#a3a3a3" : "#737373";
  switch (status) {
    case "RUNNING": return isDark ? "#60a5fa" : "#2563eb";
    case "COMPLETED": return isDark ? "#4ade80" : "#16a34a";
    case "CANCELLED": return isDark ? "#facc15" : "#ca8a04";
    case "FAILED": return isDark ? "#f87171" : "#dc2626";
    default: return isDark ? "#a3a3a3" : "#737373"; // IDLE / AWAITING_USER / unknown
  }
}

// ThreadChannel → operator-facing Trigger label. Mirrors admin U6's
// TRIGGER_LABELS in apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx.
const TRIGGER_LABELS: Record<string, string> = {
  chat: "Manual chat",
  manual: "Manual chat",
  schedule: "Schedule",
  webhook: "Webhook",
  api: "Automation",
  email: "Email",
};

function triggerLabel(channel: string | null | undefined): string {
  if (!channel) return "—";
  return TRIGGER_LABELS[channel.toLowerCase()] ?? channel;
}

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

function LifecycleBadge({ status, isDark }: { status: string | null | undefined; isDark: boolean }) {
  if (!status) return <Text className="text-sm text-neutral-400">—</Text>;
  const label = LIFECYCLE_LABELS[status] ?? "Idle";
  const color = lifecycleColor(status, isDark);
  return (
    <View className="flex-row items-center gap-1.5">
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <Text className="text-sm font-medium">{label}</Text>
    </View>
  );
}

export default function ThreadInfoRoute() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const colors = isDark ? COLORS.dark : COLORS.light;

  const [{ data: threadData }] = useQuery({
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
              <LifecycleBadge status={thread?.lifecycleStatus} isDark={isDark} />
            </PropertyRow>

            <PropertyRow label="Trigger">
              <Text className="text-sm font-medium">{triggerLabel(thread?.channel)}</Text>
            </PropertyRow>

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
    </DetailLayout>
  );
}
