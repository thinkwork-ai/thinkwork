import { useState } from "react";
import { View, ScrollView, Pressable, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRoutine, useRoutineRuns, useTriggerRoutineRun } from "@/lib/hooks/use-routines";
import { CheckCircle, XCircle, Clock, AlertCircle, Play } from "lucide-react-native";
import { useIsLargeScreen } from "@/lib/hooks/use-media-query";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { Text, Muted } from "@/components/ui/typography";
import { DetailLayout } from "@/components/layout/detail-layout";
import { WebContent } from "@/components/layout/web-content";

type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
type Run = {
  id: string;
  routineId: string;
  status: RunStatus;
  startedAt: any;
  completedAt?: any;
  error?: string;
  triggeredBy?: string;
  metadata?: any;
  createdAt: string;
  [key: string]: any;
};

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

function StatusIcon({ status, size = 18 }: { status: RunStatus; size?: number }) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  switch (status) {
    case "completed":
      return <CheckCircle size={size} color="#22c55e" />;
    case "failed":
      return <XCircle size={size} color="#ef4444" />;
    case "running":
      return <Clock size={size} color="#f59e0b" />;
    case "cancelled":
      return <AlertCircle size={size} color={colors.mutedForeground} />;
    default:
      return <Clock size={size} color={colors.mutedForeground} />;
  }
}

function RunRow({ run, isLast, onPress }: { run: Run; isLast: boolean; onPress: () => void }) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const startedAtMs = typeof run.startedAt === "string" ? new Date(run.startedAt).getTime() : run.startedAt;
  const completedAtMs = run.completedAt ? (typeof run.completedAt === "string" ? new Date(run.completedAt).getTime() : run.completedAt) : undefined;

  const duration = completedAtMs
    ? formatDuration(startedAtMs, completedAtMs)
    : run.status === "running"
    ? "running..."
    : "\u2014";

  const trigger = run.triggeredBy === "manual" ? "Manual" : run.triggeredBy ?? "\u2014";

  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-start px-4 py-3 active:bg-neutral-50 dark:active:bg-neutral-800 ${
        isLast ? "" : "border-b border-neutral-100 dark:border-neutral-800"
      }`}
    >
      <View className="mt-1">
        <StatusIcon status={run.status} size={16} />
      </View>
      <View className="flex-1 ml-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-neutral-900 dark:text-neutral-100" numberOfLines={1}>
            {formatTime(startedAtMs)}
          </Text>
          <Text className="text-sm text-neutral-500 dark:text-neutral-400" numberOfLines={1}>
            {duration}
          </Text>
        </View>
        <Muted className="text-xs mt-0.5">{trigger}</Muted>
      </View>
    </Pressable>
  );
}

export default function RoutineRunsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [{ data: routineData }] = useRoutine(id);
  const routine = routineData?.routine;

  const [{ data: runsData }] = useRoutineRuns(id, { limit: 50 });
  const runs = runsData?.routineRuns;

  const [, triggerRoutineRun] = useTriggerRoutineRun();
  const [running, setRunning] = useState(false);
  const isLarge = useIsLargeScreen();

  const handleRun = async () => {
    if (running || !id) return;
    try {
      setRunning(true);
      await triggerRoutineRun({ routineId: id });
    } catch (err) {
      Alert.alert("Error", String(err));
    } finally {
      setRunning(false);
    }
  };

  const name = routine?.name ?? "Routine";

  return (
    <DetailLayout
      title={`${name} \u2014 Runs`}
      headerRight={
        <Pressable onPress={handleRun} disabled={running} className="flex-row items-center gap-1">
          <Play size={16} color={colors.primary} />
          <Text style={{ color: colors.primary }} className="font-semibold text-base">
            {running ? "Running..." : "Run"}
          </Text>
        </Pressable>
      }
    >
      <ScrollView className="flex-1 bg-neutral-50 dark:bg-neutral-950 pt-4">
        <WebContent>
          {runs === undefined ? (
            <View className="items-center py-12">
              <Muted>Loading runs...</Muted>
            </View>
          ) : runs.length === 0 ? (
            <View className="items-center py-12">
              <Clock size={32} color="#a3a3a3" style={{ marginBottom: 12 }} />
              <Muted className="text-center">No runs yet. Tap Run to start this routine.</Muted>
            </View>
          ) : (
            <View className={`bg-white dark:bg-neutral-900 overflow-hidden mb-4 ${isLarge ? "rounded-xl mx-4" : ""}`}>
              {runs.map((run: any, idx: number) => (
                <RunRow
                  key={run.id}
                  run={run}
                  isLast={idx === runs.length - 1}
                  onPress={() => router.push(`/routines/${id}/runs/${run.id}`)}
                />
              ))}
            </View>
          )}
          <View className="h-8" />
        </WebContent>
      </ScrollView>
    </DetailLayout>
  );
}
