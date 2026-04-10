import { useState } from "react";
import { View, ScrollView, Pressable, Alert, Switch, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useHeartbeatRunDetail } from "@/lib/hooks/use-heartbeats";
import { DetailLayout } from "@/components/layout/detail-layout";
import { WebContent } from "@/components/layout/web-content";
import { HeaderContextMenu } from "@/components/ui/header-context-menu";
import { Text, Muted } from "@/components/ui/typography";
import { CheckCircle, XCircle, Clock, AlertCircle, Trash2, Edit3 } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { useIsLargeScreen } from "@/lib/hooks/use-media-query";
import { COLORS } from "@/lib/theme";

type RunStatus = "pending" | "running" | "suspended" | "completed" | "failed" | "cancelled";

function formatDuration(start: number, end?: number): string {
  const ms = (end ?? Date.now()) - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusIcon({ status, size = 16 }: { status: RunStatus; size?: number }) {
  switch (status) {
    case "completed":
      return <CheckCircle size={size} color="#22c55e" />;
    case "failed":
      return <XCircle size={size} color="#ef4444" />;
    case "running":
      return <Clock size={size} color="#f59e0b" />;
    case "cancelled":
      return <AlertCircle size={size} color="#a3a3a3" />;
    default:
      return <Clock size={size} color="#a3a3a3" />;
  }
}

export default function HeartbeatDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const isLarge = useIsLargeScreen();

  // Uses TriggerRun detail query
  const [{ data: heartbeatDetailData }] = useHeartbeatRunDetail(id!);
  // Map to expected shape
  const heartbeat = (heartbeatDetailData as any)?.threadTurn ?? undefined;
  const activity: any[] | undefined = undefined;
  const setEnabled = async (_args: any) => {};
  const deleteHeartbeat = async (_args: any) => {};
  const [deleting, setDeleting] = useState(false);

  const handleDelete = () => {
    Alert.alert("Delete Heartbeat", "This will remove the schedule and its EventBridge rule.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteHeartbeat({ heartbeatId: id });
            router.back();
          } catch (err) {
            Alert.alert("Error", err instanceof Error ? err.message : "Failed to delete");
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  if (heartbeat === undefined) {
    return (
      <DetailLayout title="Heartbeat">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      </DetailLayout>
    );
  }

  if (!heartbeat) {
    return (
      <DetailLayout title="Heartbeat">
        <View className="flex-1 items-center justify-center">
          <Muted>Heartbeat not found.</Muted>
        </View>
      </DetailLayout>
    );
  }

  const menu = (
    <HeaderContextMenu
      items={[
        {
          label: "Delete Heartbeat",
          icon: Trash2,
          destructive: true,
          onPress: handleDelete,
        },
      ]}
    />
  );

  const activityList = activity ?? [];

  return (
    <DetailLayout title={heartbeat.name} headerRight={menu}>
      <ScrollView className="flex-1 bg-white dark:bg-neutral-950" contentContainerStyle={{ paddingBottom: 24 }}>
        <WebContent>
          {/* Heartbeat info */}
          <View className="px-4 py-4 border-b border-neutral-200 dark:border-neutral-800">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                {heartbeat.scheduleLabel}
              </Text>
              <Switch
                value={heartbeat.enabled}
                onValueChange={(v) =>
                  setEnabled({ heartbeatId: id, enabled: v })
                }
                trackColor={{ false: "#d4d4d4", true: "#f8841d" }}
                thumbColor="#ffffff"
              />
            </View>
            <View className="gap-1">
              <View className="flex-row items-center justify-between">
                <Muted className="text-sm">Type</Muted>
                <Text className="text-sm text-neutral-900 dark:text-neutral-100">
                  {heartbeat.type === "agent" ? "Agent Activity" : "Routine"}
                </Text>
              </View>
              <View className="flex-row items-center justify-between">
                <Muted className="text-sm">{heartbeat.type === "agent" ? "Agent" : "Routine"}</Muted>
                <Text className="text-sm text-neutral-900 dark:text-neutral-100">{heartbeat.targetName}</Text>
              </View>
              {heartbeat.type === "agent" && heartbeat.prompt && (
                <View className="mt-1">
                  <Muted className="text-sm mb-1">Prompt</Muted>
                  <Text className="text-sm text-neutral-700 dark:text-neutral-300">{heartbeat.prompt}</Text>
                </View>
              )}
              <View className="flex-row items-center justify-between">
                <Muted className="text-sm">Timezone</Muted>
                <Text className="text-sm text-neutral-900 dark:text-neutral-100">{heartbeat.timezone}</Text>
              </View>
              <View className="flex-row items-center justify-between">
                <Muted className="text-sm">Cron</Muted>
                <Text className="text-sm font-mono text-neutral-500 dark:text-neutral-400">{heartbeat.schedule}</Text>
              </View>
              {heartbeat.lastTriggeredAt && (
                <View className="flex-row items-center justify-between">
                  <Muted className="text-sm">Last run</Muted>
                  <Text className="text-sm text-neutral-900 dark:text-neutral-100">
                    {formatTime(heartbeat.lastTriggeredAt)}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Activity list */}
          <View className="px-4 pt-3 pb-1">
            <Text className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
              Activity ({activityList.length})
            </Text>
          </View>

          {activity === undefined ? (
            <View className="items-center py-12">
              <Muted>Loading activity...</Muted>
            </View>
          ) : activityList.length === 0 ? (
            <View className="items-center py-12">
              <Clock size={32} color="#a3a3a3" style={{ marginBottom: 12 }} />
              <Muted className="text-center">No activity yet.</Muted>
            </View>
          ) : (
            <View className={`bg-white dark:bg-neutral-900 overflow-hidden ${isLarge ? "rounded-xl mx-4 mt-2" : ""}`}>
              {activityList.map((act: any, idx: number) => (
                <Pressable
                  key={act.id}
                  onPress={() => {
                    if (act.routineRunId && heartbeat.routineId) {
                      router.push(`/routines/${heartbeat.routineId}/runs/${act.routineRunId}`);
                    }
                  }}
                  className={`flex-row items-start px-4 py-3 active:bg-neutral-50 dark:active:bg-neutral-800 ${
                    idx === activityList.length - 1 ? "" : "border-b border-neutral-100 dark:border-neutral-800"
                  }`}
                >
                  <View className="mt-1">
                    <StatusIcon status={act.status as RunStatus} />
                  </View>
                  <View className="flex-1 ml-3">
                    <View className="flex-row items-center justify-between">
                      <Text className="text-sm text-neutral-900 dark:text-neutral-100" numberOfLines={1}>
                        {formatTime(act.startedAt)}
                      </Text>
                      <Text className="text-sm text-neutral-500 dark:text-neutral-400" numberOfLines={1}>
                        {act.durationMs ? formatDuration(0, act.durationMs) : act.status}
                      </Text>
                    </View>
                    {act.error && (
                      <Muted className="text-xs mt-0.5 text-red-500">{act.error}</Muted>
                    )}
                    {act.skipReason && (
                      <Muted className="text-xs mt-0.5">{act.skipReason}</Muted>
                    )}
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </WebContent>
      </ScrollView>
    </DetailLayout>
  );
}
