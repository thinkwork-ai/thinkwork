import { useEffect, useRef, useState } from "react";
import { View, ScrollView, Pressable, Switch, Alert, Clipboard, Platform, Animated, Easing } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRoutine, useRoutineRuns, useUpdateRoutine, useDeleteRoutine, useTriggerRoutineRun } from "@/lib/hooks/use-routines";
import {
  Play,
  ChevronRight,
  Copy,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  ChevronDown,
  Zap,
  Pencil,
  Trash2,
} from "lucide-react-native";
import { IconLoader2, IconCircleCheck, IconCircleX } from "@tabler/icons-react-native";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";
import { Text, Muted } from "@/components/ui/typography";
import { DetailLayout } from "@/components/layout/detail-layout";
import { WebContent } from "@/components/layout/web-content";
import { HeaderContextMenu } from "@/components/ui/header-context-menu";

type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "suspended";
type Run = {
  id: string;
  routineId: string;
  status: RunStatus;
  startedAt: any;
  completedAt?: any;
  error?: string;
  triggeredBy?: string;
  metadata?: any;
  stepResults?: any;
  createdAt: string;
  [key: string]: any;
};

const TRIGGER_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "cron", label: "Scheduled" },
  { value: "webhook", label: "Webhook" },
  { value: "event", label: "Event" },
] as const;

function TriggerSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const current = TRIGGER_OPTIONS.find((o) => o.value === value);

  const handlePress = () => {
    // Show action sheet / alert picker
    if (Platform.OS === "web") {
      // On web we render a native <select> -- handled inline
      return;
    }
    Alert.alert(
      "Change Trigger",
      undefined,
      [
        ...TRIGGER_OPTIONS.map((opt) => ({
          text: opt.label + (opt.value === value ? " ✓" : ""),
          onPress: () => onChange(opt.value),
        })),
        { text: "Cancel", style: "cancel" as const },
      ]
    );
  };

  if (Platform.OS === "web") {
    return (
      <View className="flex-row items-center gap-1">
        <select
          value={value}
          onChange={(e: any) => onChange(e.target.value)}
          style={{
            background: "transparent",
            border: "none",
            color: colors.foreground,
            fontSize: 16,
            fontWeight: "500",
            textAlign: "right",
            cursor: "pointer",
            appearance: "none",
            WebkitAppearance: "none",
            paddingRight: 4,
          }}
        >
          {TRIGGER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} color={colors.mutedForeground} />
      </View>
    );
  }

  return (
    <Pressable onPress={handlePress} className="flex-row items-center gap-1">
      <Text className="text-base font-medium text-neutral-900 dark:text-neutral-100">
        {current?.label ?? value}
      </Text>
      <ChevronDown size={14} color={colors.mutedForeground} />
    </Pressable>
  );
}

function StatusIcon({ status, size = 16 }: { status: RunStatus; size?: number }) {
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

function RunRow({
  run,
  isLast,
  onPress,
}: {
  run: Run;
  isLast: boolean;
  onPress: () => void;
}) {
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
      <View className="mt-[6px]">
        <StatusIcon status={run.status} />
      </View>
      <View className="flex-1 ml-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-base text-neutral-900 dark:text-neutral-100">
            {formatTime(startedAtMs)}
          </Text>
          <Text className="text-sm text-neutral-500 dark:text-neutral-400">{duration}</Text>
        </View>
        <Muted className="text-xs mt-0.5">{trigger}</Muted>
      </View>
      <View className="mt-[5px] ml-2">
        <ChevronRight size={18} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

function InfoRow({
  label,
  right,
  onPress,
  isLast,
}: {
  label: string;
  right: React.ReactNode;
  onPress?: () => void;
  isLast?: boolean;
}) {
  const inner = (
    <View
      className={`flex-row items-center justify-between px-4 py-3.5 ${
        isLast ? "" : "border-b border-neutral-100 dark:border-neutral-800"
      }`}
    >
      <Text className="text-lg text-neutral-900 dark:text-neutral-100">{label}</Text>
      <View className="flex-row items-center gap-2">{right}</View>
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} className="active:bg-neutral-50 dark:active:bg-neutral-800">
        {inner}
      </Pressable>
    );
  }
  return inner;
}

function SpinningLoader({ size = 18, color = "#f97316" }: { size?: number; color?: string }) {
  const spinValue = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    animation.start();
    return () => animation.stop();
  }, [spinValue]);

  const spin = spinValue.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ transform: [{ rotate: spin }] }}>
      <IconLoader2 size={size} color={color} />
    </Animated.View>
  );
}

/** Parse `[step:N/M:status] message` format from progress messages */
function parseStepMessage(content: string): { step: number; total: number; status: string; text: string } | null {
  const match = content.match(/^\[step:(\d+)\/(\d+):(\w+)\]\s*(.*)$/);
  if (!match) return null;
  return { step: parseInt(match[1]), total: parseInt(match[2]), status: match[3], text: match[4] };
}

function BuildProgressRow({ content, isLatest }: { content: string; isLatest: boolean }) {
  const parsed = parseStepMessage(content);

  if (!parsed) {
    return (
      <View className="flex-row items-start gap-3 py-2">
        <View style={{ marginTop: 2 }}>
          {isLatest ? <SpinningLoader size={16} /> : <IconCircleCheck size={16} color="#22c55e" />}
        </View>
        <Text className="text-sm text-neutral-500 dark:text-neutral-400 flex-1">
          {content}
        </Text>
      </View>
    );
  }

  const isFailed = parsed.status === "failed";
  const isDone = parsed.status === "done";
  // Only the latest active step gets a spinner; previous active steps are completed
  const showSpinner = isLatest && parsed.status === "active";

  return (
    <View className="flex-row items-start gap-3 py-2">
      <View style={{ marginTop: 2 }}>
        {showSpinner && <SpinningLoader size={16} />}
        {isFailed && <IconCircleX size={16} color="#ef4444" />}
        {isDone && <IconCircleCheck size={16} color="#22c55e" />}
        {!showSpinner && !isFailed && !isDone && <IconCircleCheck size={16} color="#22c55e" />}
      </View>
      <Text
        className={`text-sm flex-1 ${
          showSpinner
            ? "text-neutral-800 dark:text-neutral-200 font-medium"
            : isFailed
            ? "text-red-500 dark:text-red-400"
            : "text-neutral-500 dark:text-neutral-400"
        }`}
      >
        {parsed.text}
      </Text>
    </View>
  );
}

function BuildProgressSection({ threadId }: { threadId: string }) {
  // TODO: Migrate api.codeFactoryChat.listMessages to GraphQL
  const messages = undefined as any[] | undefined; // Stub

  const progressMessages = (messages ?? []).filter((m: any) => m.role === "assistant");

  if (progressMessages.length === 0) {
    return (
      <View className="bg-white dark:bg-neutral-900 rounded-xl overflow-hidden mx-4 mb-4 px-4 py-3">
        <View className="flex-row items-start gap-3">
          <View style={{ marginTop: 3 }}>
            <SpinningLoader size={16} />
          </View>
          <Text className="text-sm text-neutral-600 dark:text-neutral-400 flex-1">
            Build starting...
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="bg-white dark:bg-neutral-900 rounded-xl overflow-hidden mx-4 mb-4 px-4 py-1">
      {progressMessages.map((msg: any, idx: number) => (
        <BuildProgressRow key={msg.id} content={msg.content} isLatest={idx === progressMessages.length - 1} />
      ))}
    </View>
  );
}

export default function RoutineDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [{ data: routineData }] = useRoutine(id);
  const routine = routineData?.routine;

  // TODO: Migrate api.routines.getWebhookUrl to GraphQL
  const webhookUrl = undefined as string | undefined; // Stub

  // Trigger count from routine triggers
  const triggerCount = routine?.triggers?.length ?? 0;

  const [{ data: runsData }] = useRoutineRuns(id, { limit: 100 });
  const runs = runsData?.routineRuns;

  const [, updateRoutine] = useUpdateRoutine();
  const [, triggerRoutineRun] = useTriggerRoutineRun();
  const [, deleteRoutineMut] = useDeleteRoutine();
  const [running, setRunning] = useState(false);
  const [enabledOptimistic, setEnabledOptimistic] = useState<boolean | null>(null);

  useEffect(() => {
    if (routine) {
      setEnabledOptimistic(routine.status === "active");
    }
  }, [routine?.id, routine?.status]);

  const handleCopyWebhookUrl = () => {
    if (webhookUrl) {
      Clipboard.setString(webhookUrl);
      Alert.alert("Copied", "Webhook URL copied to clipboard.");
    }
  };

  if (routine === undefined && routineData === undefined) {
    return (
      <DetailLayout title="Routine">
        <View className="flex-1 items-center justify-center">
          <Muted>Loading...</Muted>
        </View>
      </DetailLayout>
    );
  }

  if (routine === null || (routineData && !routine)) {
    return (
      <DetailLayout title="Routine">
        <View className="flex-1 items-center justify-center">
          <Muted>Routine not found.</Muted>
        </View>
      </DetailLayout>
    );
  }

  if (!routine) {
    return (
      <DetailLayout title="Routine">
        <View className="flex-1 items-center justify-center">
          <Muted>Loading...</Muted>
        </View>
      </DetailLayout>
    );
  }

  const handleToggle = async (enabled: boolean) => {
    const previous = enabledOptimistic;
    setEnabledOptimistic(enabled);
    try {
      await updateRoutine({ id: routine.id, input: { status: enabled ? "active" : "inactive" } });
    } catch (err) {
      setEnabledOptimistic(previous);
      Alert.alert("Error", String(err));
    }
  };

  const handleTriggerChange = async (triggerType: string) => {
    try {
      await updateRoutine({ id: routine.id, input: { type: triggerType } });
    } catch (err) {
      Alert.alert("Error", String(err));
    }
  };

  const handleRun = async () => {
    if (running) return;
    try {
      setRunning(true);
      await triggerRoutineRun({ routineId: routine.id });
    } catch (err) {
      Alert.alert("Error", String(err));
    } finally {
      setRunning(false);
    }
  };

  const handleBuilder = () => {
    const slug = (routine as any).slug ?? routine.name.toLowerCase().replace(/\s+/g, "-");
    router.push({
      pathname: "/routines/edit",
      params: {
        routineId: routine.id,
        routineName: routine.name,
        routineDescription: routine.description ?? "",
        editSlug: slug,
      },
    });
  };

  const runCount = runs?.length ?? 0;
  const currentEnabled = enabledOptimistic ?? (routine.status === "active");

  return (
    <DetailLayout
      title={routine.name}
      headerRight={
        <HeaderContextMenu
          items={[
            {
              label: "Edit Routine",
              icon: Pencil,
              onPress: handleBuilder,
            },
            {
              label: "Delete Routine",
              icon: Trash2,
              destructive: true,
              onPress: () => {
                Alert.alert(
                  "Delete Routine",
                  "Delete this routine and all its run history?",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: async () => {
                        try {
                          await deleteRoutineMut({ id: routine.id });
                          router.back();
                        } catch (e: any) {
                          Alert.alert("Error", e.message || "Failed to delete routine");
                        }
                      },
                    },
                  ],
                );
              },
            },
          ]}
        />
      }
    >
      <ScrollView className="flex-1 bg-neutral-50 dark:bg-neutral-950 pt-4">
        <WebContent>
          {(routine as any).buildStatus === "building" && (routine as any).builderThreadId ? (
            <>
              {/* Building -- only show build progress */}
              <View className="mx-4 mb-2">
                <Text className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
                  Build Progress
                </Text>
              </View>
              <BuildProgressSection threadId={(routine as any).builderThreadId} />
            </>
          ) : (
            <>
              {/* Info Table */}
              <View className="bg-white dark:bg-neutral-900 rounded-xl overflow-hidden mx-4 mb-4">
                {routine.description ? (
                  <View className="px-4 py-3.5 border-b border-neutral-100 dark:border-neutral-800">
                    <Text className="text-base text-neutral-500 dark:text-neutral-400">
                      {routine.description}
                    </Text>
                  </View>
                ) : null}
                <InfoRow
                  label="Enabled"
                  right={
                    <Switch
                      value={currentEnabled}
                      onValueChange={handleToggle}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      thumbColor={Platform.OS === "android" ? "#ffffff" : undefined}
                    />
                  }
                />

                {/* Triggers row */}
                <InfoRow
                  label="Triggers"
                  isLast={(routine as any).triggerType !== "webhook"}
                  onPress={() => router.push(`/routines/${id}/triggers`)}
                  right={
                    <View className="flex-row items-center gap-2">
                      {triggerCount > 0 ? (
                        <View
                          style={{ borderColor: colors.primary, borderWidth: 1.5 }}
                          className="rounded-full px-1.5 py-0.5 min-w-[20px] items-center"
                        >
                          <Text style={{ color: colors.primary }} className="text-xs font-bold">
                            {triggerCount}
                          </Text>
                        </View>
                      ) : (
                        <Text className="text-sm text-neutral-500 dark:text-neutral-400">None</Text>
                      )}
                      <ChevronRight size={16} color={colors.mutedForeground} />
                    </View>
                  }
                />

                {/* Legacy webhook URL (backward compat for routines with webhookToken on routine) */}
                {(routine as any).triggerType === "webhook" && webhookUrl && (
                  <InfoRow
                    label="Webhook"
                    onPress={handleCopyWebhookUrl}
                    isLast
                    right={
                      <View className="flex-row items-center gap-2">
                        <Text className="text-sm text-neutral-500 max-w-[180px]" numberOfLines={1}>
                          {webhookUrl}
                        </Text>
                        <Copy size={14} color={colors.mutedForeground} />
                      </View>
                    }
                  />
                )}
              </View>

              {/* Runs Section */}
              <View className="mx-4 mb-2 flex-row items-center justify-between">
                <Text className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
                  Runs {runCount > 0 ? `(${runCount})` : ""}
                </Text>
                <Pressable onPress={handleRun} disabled={running} className="flex-row items-center gap-1">
                  <Play size={14} color={colors.primary} />
                  <Text style={{ color: colors.primary }} className="text-sm font-semibold">
                    {running ? "Running..." : "Run Now"}
                  </Text>
                </Pressable>
              </View>

              {runs === undefined ? (
                <View className="items-center py-8">
                  <Muted>Loading runs...</Muted>
                </View>
              ) : runs.length === 0 ? (
                <View className="bg-white dark:bg-neutral-900 rounded-xl overflow-hidden mx-4">
                  <View className="items-center py-8">
                    <Muted>No runs yet</Muted>
                  </View>
                </View>
              ) : (
                <View className="bg-white dark:bg-neutral-900 rounded-xl overflow-hidden mx-4">
                  {runs.map((run: Run, idx: number) => (
                    <RunRow
                      key={run.id}
                      run={run}
                      isLast={idx === runs.length - 1}
                      onPress={() => router.push(`/routines/${id}/runs/${run.id}`)}
                    />
                  ))}
                </View>
              )}
            </>
          )}

          <View className="h-8" />
        </WebContent>
      </ScrollView>

    </DetailLayout>
  );
}
