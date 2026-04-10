import { useState, useCallback, useMemo } from "react";
import { View, ScrollView, Pressable, RefreshControl } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { useTenant } from "@/lib/hooks/use-tenants";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Text, Muted } from "@/components/ui/typography";
import { MobileRow } from "@/components/ui/mobile-row";
import { DataTable, Column } from "@/components/ui/data-table";
import { useIsLargeScreen } from "@/lib/hooks/use-media-query";
import { TabHeader } from "@/components/layout/tab-header";

type ActivityRow = {
  id: string;
  createdAt: string;
  type: string;
  agentId: string;
  message: string;
  targetId?: string;
  gatewayId?: string;
  agentName: string;
  gatewayName: string;
};

const TYPE_CONFIG: Record<string, { label: string; variant: "outline" | "secondary" | "success" | "warning" | "destructive" }> = {
  status_update: { label: "Status", variant: "secondary" },
  assignees_update: { label: "Assignees", variant: "outline" },
  thread_update: { label: "Thread", variant: "outline" },
  message: { label: "Comment", variant: "secondary" },
  commented: { label: "Comment", variant: "secondary" },
  document_created: { label: "Doc", variant: "outline" },
};

const FILTERS = [
  { id: "all", label: "All", types: [] },
  { id: "threads", label: "Threads", types: ["status_update", "assignees_update", "thread_update"] },
  { id: "comments", label: "Comments", types: ["message", "commented"] },
] as const;

function formatRelativeTime(dateStr: string): string {
  const ms = new Date(dateStr).getTime();
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function toTitleCase(str: string): string {
  return str.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function TypeBadge({ type }: { type: string }) {
  const config = TYPE_CONFIG[type] || { label: toTitleCase(type), variant: "outline" as const };
  return <Badge variant="outline" className="whitespace-nowrap">{config.label}</Badge>;
}

function FilterPill({ label, isActive, onPress }: { label: string; isActive: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-4 h-9 rounded-full items-center justify-center ${
        isActive
          ? "bg-orange-500"
          : "bg-neutral-100 dark:bg-neutral-800"
      }`}
    >
      <Text className={`text-base font-medium ${
        isActive
          ? "text-white"
          : "text-neutral-700 dark:text-neutral-300"
      }`}>
        {label}
      </Text>
    </Pressable>
  );
}

// Mobile row component
function ActivityRowItem({
  activity,
  onPress,
  isLast
}: {
  activity: ActivityRow;
  onPress?: () => void;
  isLast?: boolean;
}) {
  return (
    <MobileRow
      onPress={onPress}
      disabled={!onPress}
      isLast={isLast}
      line1Left={
        <>
          <Text className="text-base font-medium text-neutral-900 dark:text-neutral-100 leading-none">
            {activity.agentName}
          </Text>
          <TypeBadge type={activity.type} />
        </>
      }
      line1Right={<Muted className="text-sm">{formatRelativeTime(activity.createdAt)}</Muted>}
      line2Left={
        <Text className="text-sm text-neutral-500 dark:text-neutral-400" numberOfLines={1}>
          {activity.message}
        </Text>
      }
    />
  );
}

export default function ActivityScreen() {
  const router = useRouter();
  const isLargeScreen = useIsLargeScreen();
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  // Get tenant from auth
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [{ data: tenantData }] = useTenant(tenantId);
  const tenant = tenantData?.tenant;
  const hasTenant = !!tenant;

  // TODO: api.queries.listActivitiesPaginated — no GraphQL hook yet; stub with empty array
  const activities: ActivityRow[] = [];
  const paginated = hasTenant ? { page: activities } : undefined;

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  const handleActivityPress = useCallback((activity: ActivityRow) => {
    if (activity.targetId) {
      router.push(`/threads/${activity.targetId}`);
    }
  }, [router]);

  // Table columns for wide screens
  const columns: Column<ActivityRow>[] = useMemo(() => [
    {
      key: "agent",
      header: "Agent",
      flex: 1,
      minWidth: 100,
      render: (item) => <Text className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{item.agentName}</Text>,
    },
    {
      key: "type",
      header: "Type",
      flex: 0,
      width: 140,
      minWidth: 140,
      render: (item) => <TypeBadge type={item.type} />,
    },
    {
      key: "message",
      header: "Message",
      flex: 3,
      minWidth: 200,
      render: (item) => (
        <Text className="text-sm text-neutral-500 dark:text-neutral-400" numberOfLines={1}>{item.message}</Text>
      ),
    },
    {
      key: "agent",
      header: "Agent",
      flex: 1,
      minWidth: 100,
      render: (item) => <Muted className="text-sm">{item.gatewayName}</Muted>,
    },
    {
      key: "time",
      header: "Time",
      flex: 0.8,
      minWidth: 80,
      align: "right",
      render: (item) => <Muted className="text-sm">{formatRelativeTime(item.createdAt)}</Muted>,
    },
  ], []);

  // Loading state
  if (paginated === undefined) {
    return (
      <View className="flex-1 bg-white dark:bg-neutral-950 p-4">
        <View className="rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden">
          <View className="p-4 gap-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </View>
        </View>
      </View>
    );
  }

  const renderMobileItem = ({ item, index }: { item: ActivityRow; index: number }) => (
    <ActivityRowItem
      activity={item}
      onPress={item.targetId ? () => handleActivityPress(item) : undefined}
      isLast={index === activities.length - 1}
    />
  );

  return (
    <View className="flex-1 bg-white dark:bg-neutral-950">
      <TabHeader title="Activity" />
      {/* Filter Bar */}
      <View className="border-b border-neutral-200 dark:border-neutral-800">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10, gap: 8, flexDirection: "row" }}
        >
          {FILTERS.map((f) => (
            <FilterPill
              key={f.id}
              label={f.label}
              isActive={filter === f.id}
              onPress={() => setFilter(f.id)}
            />
          ))}
        </ScrollView>
      </View>

      {/* Activity List */}
      {isLargeScreen ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <DataTable
            data={activities}
            columns={columns}
            keyExtractor={(item) => item.id}
            onRowPress={(item) => item.targetId ? handleActivityPress(item) : undefined}
            emptyMessage="No activity yet."
          />
        </ScrollView>
      ) : (
        <View className="flex-1">
          {activities.length === 0 ? (
            <View className="py-12 items-center">
              <Muted className="text-center">No activity yet.</Muted>
            </View>
          ) : (
            <FlashList
              data={activities}
              renderItem={renderMobileItem}
              keyExtractor={(item) => item.id}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            />
          )}
        </View>
      )}
    </View>
  );
}
