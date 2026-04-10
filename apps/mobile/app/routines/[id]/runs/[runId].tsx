import { View, ScrollView, Pressable, Alert, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRoutine, useRoutineRuns } from "@/lib/hooks/use-routines";
import { CheckCircle, XCircle, Clock, Trash2, FileText } from "lucide-react-native";
import { Text, Muted } from "@/components/ui/typography";
import { DetailLayout } from "@/components/layout/detail-layout";
import { WebContent } from "@/components/layout/web-content";
import { TimelineNode } from "@/components/runs/timeline-node";

type RoutineStep = {
  id: string;
  stepId: string;
  name: string;
  status: string;
  startedAt?: number;
  completedAt?: number;
  output?: string;
  error?: string;
  [key: string]: any;
};

const WEB_WRAP_STYLE = Platform.OS === "web" ? ({ wordBreak: "break-word" } as any) : undefined;

function formatDuration(start: number, end?: number): string {
  const ms = (end ?? Date.now()) - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function RunDetailScreen() {
  const { id, runId } = useLocalSearchParams<{ id: string; runId: string }>();
  const router = useRouter();

  // TODO: Migrate api.routines.deleteRun to GraphQL
  const handleDelete = () => {
    Alert.alert("Delete Run", "Delete this run and its steps?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          // TODO: Migrate deleteRun to GraphQL
          Alert.alert("Not Implemented", "Delete run not yet migrated to GraphQL.");
        },
      },
    ]);
  };

  const [{ data: routineData }] = useRoutine(id);
  const routine = routineData?.routine;

  // TODO: Migrate api.routines.getRunDetails to GraphQL — using routineRuns as fallback
  const [{ data: runsData }] = useRoutineRuns(id, { limit: 100 });
  const details = runsData?.routineRuns?.find((r: any) => r.id === runId);

  const name = routine?.name ?? "Routine";

  if (details === undefined && !runsData) {
    return (
      <DetailLayout title={`${name} \u2014 Run`}>
        <View className="flex-1 items-center justify-center">
          <Muted>Loading...</Muted>
        </View>
      </DetailLayout>
    );
  }

  if (!details) {
    return (
      <DetailLayout title={`${name} \u2014 Run`}>
        <View className="flex-1 items-center justify-center">
          <Muted>Run not found.</Muted>
        </View>
      </DetailLayout>
    );
  }

  const run = details;
  const steps = ((run as any).steps ?? []) as RoutineStep[];
  const startedAtMs = typeof run.startedAt === "string" ? new Date(run.startedAt).getTime() : run.startedAt;
  const completedAtMs = run.completedAt ? (typeof run.completedAt === "string" ? new Date(run.completedAt).getTime() : run.completedAt) : undefined;
  const totalDuration = completedAtMs
    ? formatDuration(startedAtMs, completedAtMs)
    : run.status === "running"
    ? "running..."
    : undefined;

  const handleFixError = (error: string) => {
    const routineName = routine?.name ?? "Routine";
    const slug = (routine as any)?.slug ?? routineName.toLowerCase().replace(/\s+/g, "-");

    // Build run context for the fix prompt
    const runContext: string[] = [];
    runContext.push(`Run status: ${run.status}`);
    if (run.error) runContext.push(`Run error: ${run.error}`);
    if (totalDuration) runContext.push(`Duration: ${totalDuration}`);
    if (steps.length > 0) {
      runContext.push(`\nStep results:`);
      for (const step of steps) {
        const stepStatus = step.status ?? "unknown";
        const stepLine = `- ${step.name}: ${stepStatus}${step.error ? ` \u2014 ${step.error}` : ""}`;
        runContext.push(stepLine);
      }
    }
    if ((run as any).stepResults) {
      const final = ((run as any).stepResults as any)?._final;
      if (final) {
        runContext.push(`\nReturn value: ${JSON.stringify(final, null, 2)}`);
      }
    }

    router.push({
      pathname: "/routines/edit",
      params: {
        routineId: id,
        routineName,
        editSlug: slug,
        prefill: `Fix this error:\n\n${error}\n\n--- Run Context ---\n${runContext.join("\n")}`,
      },
    });
  };

  return (
    <DetailLayout
      title={`${name} \u2014 Run`}
      headerRight={
        <Pressable onPress={handleDelete}>
          <Trash2 size={20} color="#ef4444" />
        </Pressable>
      }
    >
      <ScrollView
        className="flex-1 bg-neutral-50 dark:bg-neutral-950 pt-4"
      >
        <WebContent>
          {/* Summary bar */}
          <View className="flex-row items-center justify-between mx-4 mb-4 px-4 py-3 bg-white dark:bg-neutral-900 rounded-xl">
            <View className="flex-row items-center gap-2">
              {run.status === "completed" ? (
                <CheckCircle size={20} color="#22c55e" />
              ) : run.status === "failed" ? (
                <XCircle size={20} color="#ef4444" />
              ) : (
                <Clock size={20} color="#f59e0b" />
              )}
              <Text weight="semibold" className="text-base text-neutral-900 dark:text-neutral-100 capitalize">
                {run.status}
              </Text>
            </View>
            {totalDuration && (
              <Text className="text-sm text-neutral-500 dark:text-neutral-400">
                {totalDuration}
              </Text>
            )}
          </View>

          {/* Timeline */}
          <View className="mx-4 bg-white dark:bg-neutral-900 rounded-xl px-4 py-4 mb-4">
            {/* Start node */}
            <TimelineNode
              status={run.status === "failed" && steps.length === 0 ? "failed" : "completed"}
              name="Start Routine"
              time={formatTime(startedAtMs)}
              isFirst
              isSynthetic
            />

            {/* Actual steps */}
            {steps.map((step) => (
              <TimelineNode
                key={step.id}
                status={step.status}
                name={step.stepId}
                duration={
                  step.startedAt && step.completedAt
                    ? formatDuration(step.startedAt, step.completedAt)
                    : undefined
                }
                time={step.startedAt ? formatTime(step.startedAt) : undefined}
                output={step.output}
                error={step.error}
                collapsible
                onFixError={step.error ? handleFixError : undefined}
              />
            ))}

            {/* End node */}
            <TimelineNode
              status={run.status === "completed" ? "completed" : run.status === "failed" ? "failed" : "pending"}
              name="End Routine"
              time={completedAtMs ? formatTime(completedAtMs) : undefined}
              duration={totalDuration}
              error={run.error}
              isLast
              isSynthetic
              onFixError={run.error ? handleFixError : undefined}
            />
          </View>

          {/* Result card */}
          {(run as any).stepResults?._final !== undefined && (run as any).stepResults._final !== null && (
            <View className="mx-4 bg-white dark:bg-neutral-900 rounded-xl px-4 py-4 mb-4">
              <View className="flex-row items-center gap-2 mb-3">
                <FileText size={16} color={run.status === "completed" ? "#22c55e" : "#ef4444"} />
                <Text weight="semibold" className="text-base text-neutral-900 dark:text-neutral-100">
                  Result
                </Text>
              </View>
              <View className="bg-neutral-100 dark:bg-neutral-800 rounded-lg px-3 py-3 min-w-0">
                <Text className="text-sm text-neutral-700 dark:text-neutral-300 font-mono" style={WEB_WRAP_STYLE}>
                  {typeof (run as any).stepResults._final === "string"
                    ? (run as any).stepResults._final
                    : JSON.stringify((run as any).stepResults._final, null, 2)}
                </Text>
              </View>
            </View>
          )}

          <View className="h-8" />
        </WebContent>
      </ScrollView>
    </DetailLayout>
  );
}
