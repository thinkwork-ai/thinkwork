/**
 * Mobile run-detail page (Plan 2026-05-01-007 §U13 mobile parity).
 *
 * /routines/[id]/executions/[executionId]
 *
 * Mirrors apps/admin/src/routes/.../$routineId.executions.$executionId.tsx
 * — same one-shot RoutineExecutionDetailQuery pull, same 5s poll while
 * non-terminal (gated on AppState.active), same step-event-collapsed
 * graph render. Mobile uses ExecutionGraphMobile (vertical list with
 * status icons) instead of the desktop-shaped graph.
 *
 * Pull-to-refresh hooks the urql refetch with `requestPolicy:
 * 'network-only'` so the operator can force a fresh pull alongside
 * the polling cadence.
 */

import { useState, useEffect, useMemo } from "react";
import {
  View,
  ScrollView,
  Pressable,
  RefreshControl,
  AppState,
  type AppStateStatus,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useColorScheme } from "nativewind";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRoutineExecution } from "@/lib/hooks/use-routines";
import { COLORS } from "@/lib/theme";
import { Text, Muted } from "@/components/ui/typography";
import { Badge } from "@/components/ui/badge";
import { DetailLayout } from "@/components/layout/detail-layout";
import { WebContent } from "@/components/layout/web-content";
import {
  ExecutionGraphMobile,
  type StepEventLite,
} from "@/components/routines/ExecutionGraphMobile";

const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

function formatDurationMs(start?: string | null, end?: string | null): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (Number.isNaN(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = Math.round(seconds - minutes * 60);
  return `${minutes}m ${remSeconds}s`;
}

function formatLlmCost(cents?: number | null): string {
  if (cents == null) return "—";
  if (cents < 100) return `${cents}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "running":
      return "bg-blue-50 dark:bg-blue-950";
    case "succeeded":
      return "bg-green-50 dark:bg-green-950";
    case "failed":
      return "bg-red-50 dark:bg-red-950";
    case "cancelled":
    case "timed_out":
      return "bg-amber-50 dark:bg-amber-950";
    case "awaiting_approval":
      return "bg-purple-50 dark:bg-purple-950";
    default:
      return "bg-neutral-100 dark:bg-neutral-800";
  }
}

export default function RoutineExecutionDetailScreen() {
  const params = useLocalSearchParams<{ id: string; executionId: string }>();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [appActive, setAppActive] = useState(
    AppState.currentState === "active",
  );

  // AppState gate so background tabs/apps don't burn polling cycles.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      setAppActive(next === "active");
    });
    return () => sub.remove();
  }, []);

  const [queryResult, refetch] = useRoutineExecution(params.executionId);
  const execution = queryResult.data?.routineExecution;
  const routine = execution?.routine ?? null;
  const isTerminal = execution
    ? TERMINAL_STATUSES.has(execution.status)
    : false;

  // 5s poll while non-terminal AND foreground.
  useEffect(() => {
    if (isTerminal || !appActive || !params.executionId) return;
    const t = setInterval(
      () => refetch({ requestPolicy: "network-only" }),
      5000,
    );
    return () => clearInterval(t);
  }, [isTerminal, appActive, params.executionId, refetch]);

  const onRefresh = async () => {
    setRefreshing(true);
    refetch({ requestPolicy: "network-only" });
    // Tiny delay so the spinner flashes even when the cache is fresh.
    setTimeout(() => setRefreshing(false), 300);
  };

  const stepEventsLite: StepEventLite[] = useMemo(
    () =>
      (execution?.stepEvents ?? []).map((ev) => ({
        id: ev.id,
        nodeId: ev.nodeId,
        recipeType: ev.recipeType,
        status: ev.status,
        startedAt: ev.startedAt ?? null,
        finishedAt: ev.finishedAt ?? null,
        retryCount: ev.retryCount,
      })),
    [execution?.stepEvents],
  );

  const selectedEvent = useMemo(() => {
    if (!selectedNodeId || !execution) return null;
    const events = execution.stepEvents
      .filter((ev) => ev.nodeId === selectedNodeId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return events[events.length - 1] ?? null;
  }, [selectedNodeId, execution]);

  if (queryResult.fetching && !execution) {
    return (
      <DetailLayout title="Execution">
        <View className="flex-1 items-center justify-center">
          <Muted>Loading execution...</Muted>
        </View>
      </DetailLayout>
    );
  }

  if (!execution) {
    return (
      <DetailLayout title="Execution">
        <View className="flex-1 items-center justify-center px-8">
          <Muted className="text-center">
            {queryResult.error?.message ??
              "No execution row matches that id."}
          </Muted>
        </View>
      </DetailLayout>
    );
  }

  return (
    <DetailLayout title={routine?.name ?? "Execution"}>
      <ScrollView
        className="flex-1 bg-neutral-50 dark:bg-neutral-950"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        <WebContent>
          {/* Header summary */}
          <View className="mx-4 mt-4 mb-3 flex-row items-center justify-between">
            <View className="flex-1">
              <Muted className="text-xs uppercase tracking-wide">
                Run {params.executionId.slice(0, 8)} · {execution.triggerSource}
              </Muted>
            </View>
            <Badge className={statusBadgeClass(execution.status)}>
              <Text className="text-xs capitalize">
                {execution.status.replace(/_/g, " ")}
              </Text>
            </Badge>
          </View>

          {/* Steps */}
          <View className="mx-4 mb-4">
            <View className="mb-2">
              <Text className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
                Steps
              </Text>
            </View>
            <ExecutionGraphMobile
              stepManifest={null}
              stepEvents={stepEventsLite}
              selectedNodeId={selectedNodeId}
              onSelectNode={(nodeId) => setSelectedNodeId(nodeId)}
            />
          </View>

          {/* Selected step detail */}
          {selectedEvent ? (
            <View className="mx-4 mb-4 bg-white dark:bg-neutral-900 rounded-xl px-4 py-4">
              <View className="flex-row items-center justify-between">
                <Text className="font-mono text-sm">
                  {selectedEvent.nodeId}
                </Text>
                <Badge className={statusBadgeClass(selectedEvent.status)}>
                  <Text className="text-xs capitalize">
                    {selectedEvent.status.replace(/_/g, " ")}
                  </Text>
                </Badge>
              </View>
              <Muted className="text-xs mt-1">
                {selectedEvent.recipeType} ·{" "}
                {formatDurationMs(
                  selectedEvent.startedAt,
                  selectedEvent.finishedAt,
                )}{" "}
                · {formatLlmCost(selectedEvent.llmCostUsdCents)}
              </Muted>
              {selectedEvent.recipeType === "python" &&
              selectedEvent.stdoutPreview ? (
                <View className="mt-2 rounded bg-neutral-100 dark:bg-neutral-800 p-2">
                  <Text className="font-mono text-xs">
                    {selectedEvent.stdoutPreview}
                    {selectedEvent.truncated ? "\n…(truncated)" : ""}
                  </Text>
                </View>
              ) : null}
              {selectedEvent.errorJson ? (
                <View className="mt-2 rounded bg-red-50 dark:bg-red-950 p-2">
                  <Text className="font-mono text-xs">
                    {JSON.stringify(selectedEvent.errorJson, null, 2)}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Execution metadata */}
          <View className="mx-4 mb-4 bg-white dark:bg-neutral-900 rounded-xl">
            <Row label="Trigger" value={execution.triggerSource} />
            <Row
              label="Started"
              value={
                execution.startedAt
                  ? new Date(execution.startedAt).toLocaleString()
                  : "—"
              }
            />
            <Row
              label="Finished"
              value={
                execution.finishedAt
                  ? new Date(execution.finishedAt).toLocaleString()
                  : "—"
              }
            />
            <Row
              label="Duration"
              value={formatDurationMs(execution.startedAt, execution.finishedAt)}
            />
            <Row
              label="LLM cost"
              value={formatLlmCost(execution.totalLlmCostUsdCents)}
              isLast={!execution.errorCode}
            />
            {execution.errorCode ? (
              <Row label="Error" value={execution.errorCode} isLast />
            ) : null}
          </View>

          {/* Markdown summary */}
          {(routine?.documentationMd ?? "").length > 0 ? (
            <View className="mx-4 mb-8 bg-white dark:bg-neutral-900 rounded-xl px-4 py-4">
              <Text className="text-sm font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-2">
                Summary
              </Text>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {routine?.documentationMd ?? ""}
              </ReactMarkdown>
            </View>
          ) : null}
        </WebContent>
      </ScrollView>
    </DetailLayout>
  );
}

function Row({
  label,
  value,
  isLast,
}: {
  label: string;
  value: string;
  isLast?: boolean;
}) {
  return (
    <View
      className={`flex-row items-center justify-between px-4 py-3 ${
        isLast ? "" : "border-b border-neutral-100 dark:border-neutral-800"
      }`}
    >
      <Muted className="text-sm">{label}</Muted>
      <Text className="text-sm">{value}</Text>
    </View>
  );
}
