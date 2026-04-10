import { useMemo } from "react";
import { View, ScrollView, Pressable, ActivityIndicator, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { useTriggers } from "@/lib/hooks/use-triggers";
import { useHeartbeatRuns } from "@/lib/hooks/use-heartbeats";
import { Text, Muted } from "@/components/ui/typography";
import { DetailLayout } from "@/components/layout/detail-layout";
import { IconBolt } from "@tabler/icons-react-native";
import { Plus } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { COLORS } from "@/lib/theme";

// --- Constants ---

const HOURS_BACK = 1;
const HOURS_FORWARD = 2;
const TOTAL_MS = (HOURS_BACK + HOURS_FORWARD) * 3_600_000;

// --- Cron parser ---

// Extract the raw cron expression from schedule_expression, e.g. "cron(0 0/5 * * ? *)"
function extractCron(expr: string): string | null {
  const m = expr.match(/^cron\((.+)\)$/);
  return m ? m[1] : null;
}

/** Build a human-readable label from schedule_expression */
function scheduleLabel(expr: string): string {
  const cron = extractCron(expr);
  if (!cron) {
    // rate(...) or at(...)
    const rate = expr.match(/^rate\((.+)\)$/);
    if (rate) return `Every ${rate[1]}`;
    return expr;
  }
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return expr;
  const [minPart, hourPart] = parts;
  if (minPart.includes("/")) return `Every ${minPart.split("/")[1]}m`;
  if (hourPart === "*" || hourPart.includes("/")) {
    const step = hourPart.includes("/") ? hourPart.split("/")[1] : "1";
    return `Every ${step}h`;
  }
  return expr;
}

function getOccurrences(
  cronExpr: string,
  _timezone: string,
  windowStart: Date,
  windowEnd: Date,
): number[] {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length < 5) return [];
  const [minPart, hourPart, dayPart, , dowPart] = parts;
  const times: number[] = [];

  const hasMinuteStep = minPart.includes("/");
  const isEveryHour = !hasMinuteStep && (hourPart === "*" || hourPart.includes("/"));
  const stepMs = (hasMinuteStep || isEveryHour) ? 60_000 : 3_600_000;

  const cursor = new Date(windowStart);
  cursor.setSeconds(0, 0);

  const endMs = windowEnd.getTime();

  while (cursor.getTime() <= endMs && times.length < 100) {
    const m = cursor.getMinutes();
    const h = cursor.getHours();
    const dom = cursor.getDate();
    const dow = cursor.getDay();

    if (
      matchField(minPart, m) &&
      matchField(hourPart, h) &&
      matchField(dayPart, dom) &&
      matchDow(dowPart, dow)
    ) {
      times.push(cursor.getTime());
    }
    cursor.setTime(cursor.getTime() + stepMs);
  }
  return times;
}

function matchField(f: string, v: number): boolean {
  if (f === "*" || f === "?") return true;
  if (f.includes("/")) return v % parseInt(f.split("/")[1], 10) === 0;
  if (f.includes(",")) return f.split(",").some((x) => parseInt(x, 10) === v);
  if (f.includes("-")) { const [a, b] = f.split("-").map(Number); return v >= a && v <= b; }
  return parseInt(f, 10) === v;
}

function matchDow(f: string, dow: number): boolean {
  if (f === "*" || f === "?") return true;
  const eb = dow === 0 ? 1 : dow + 1; // JS -> EventBridge
  if (f === "MON-FRI" || f === "2-6") return eb >= 2 && eb <= 6;
  if (f.includes(",")) return f.split(",").some((x) => {
    const n = parseInt(x, 10);
    return Number.isNaN(n) ? false : n === eb;
  });
  if (f.includes("-")) { const [a, b] = f.split("-").map(Number); return eb >= a && eb <= b; }
  return parseInt(f, 10) === eb;
}

// --- Timeline ---

interface TimelineDot {
  ts: number;
  type: "past" | "future";
  status?: string;
}

function Timeline({
  dots,
  windowStart,
  width,
  colors,
}: {
  dots: TimelineDot[];
  windowStart: number;
  width: number;
  colors: typeof COLORS.light;
}) {
  const toX = (ts: number) => ((ts - windowStart) / TOTAL_MS) * width;
  const dotSize = 8;
  const lineColor = "rgba(150,150,150,0.4)";

  return (
    <View style={{ width, height: 22, position: "relative" }}>
      {/* Base line */}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 10,
          height: 2,
          borderRadius: 1,
          backgroundColor: lineColor,
        }}
      />
      {/* Dots */}
      {dots.map((d, i) => {
        const x = toX(d.ts);
        if (x < -dotSize || x > width + dotSize) return null;
        const isPast = d.type === "past";

        let fill: string;
        let borderColor: string;
        let isFilled: boolean;

        if (isPast) {
          if (d.status === "succeeded" || d.status === "completed") {
            fill = "#22c55e";
            borderColor = "#22c55e";
            isFilled = true;
          } else if (d.status === "failed") {
            fill = "#ef4444";
            borderColor = "#ef4444";
            isFilled = true;
          } else if (d.status === "running") {
            fill = "#f59e0b";
            borderColor = "#f59e0b";
            isFilled = true;
          } else {
            fill = "transparent";
            borderColor = colors.mutedForeground;
            isFilled = false;
          }
        } else {
          fill = "transparent";
          borderColor = colors.mutedForeground;
          isFilled = false;
        }

        return (
          <View
            key={i}
            style={{
              position: "absolute",
              left: x - dotSize / 2,
              top: 11 - dotSize / 2,
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize / 2,
              backgroundColor: isFilled ? fill : "transparent",
              borderWidth: isFilled ? 0 : 1.5,
              borderColor,
            }}
          />
        );
      })}
    </View>
  );
}

function TimelineLabels({ windowStart, width }: { windowStart: number; width: number }) {
  const totalHours = HOURS_BACK + HOURS_FORWARD;
  const labels = [];
  for (let i = 0; i <= totalHours; i++) {
    const t = new Date(windowStart + i * 3_600_000);
    const label = t.toLocaleTimeString([], { hour: "numeric", hour12: true });
    const x = (i / totalHours) * width;
    labels.push(
      <Text
        key={i}
        className="text-[10px] text-neutral-400 dark:text-neutral-500"
        style={{ position: "absolute", left: x - 12 }}
      >
        {label}
      </Text>
    );
  }
  return <View style={{ width, height: 16, position: "relative" }}>{labels}</View>;
}

// --- Screen ---

export default function TriggersScreen() {
  const router = useRouter();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === "dark" ? COLORS.dark : COLORS.light;
  const { width: screenWidth } = useWindowDimensions();
  const timelineWidth = screenWidth - 32;
  const { user } = useAuth();
  const tenantId = user?.tenantId;

  const [{ data: triggersData, fetching: triggersFetching }] = useTriggers(tenantId);
  const [{ data: runsData }] = useHeartbeatRuns(tenantId, { limit: 200 });

  const jobs = (triggersData as any)?.scheduledJobs ?? (triggersData as any)?.triggers;
  const recentRuns = runsData?.threadTurns;

  const nowMs = useMemo(() => Date.now(), []);
  const windowStart = nowMs - HOURS_BACK * 3_600_000;
  const windowEnd = nowMs + HOURS_FORWARD * 3_600_000;

  // Build dots per job: actual run activity + calculated future occurrences
  const jobDots = useMemo(() => {
    if (!jobs) return {};

    // Group runs by agentId (runs are linked to agents, jobs have agent_id)
    const runsByAgent: Record<string, typeof recentRuns> = {};
    for (const run of recentRuns ?? []) {
      const key = run.agentId as string;
      if (!runsByAgent[key]) runsByAgent[key] = [];
      runsByAgent[key]!.push(run);
    }

    const result: Record<string, TimelineDot[]> = {};
    for (const job of jobs) {
      const dots: TimelineDot[] = [];
      const cronExpr = job.scheduleExpression ? extractCron(job.scheduleExpression) : null;

      if (cronExpr) {
        // Calculate ALL cron occurrences across the full window
        const allOccs = getOccurrences(
          cronExpr,
          job.timezone,
          new Date(windowStart),
          new Date(windowEnd),
        );

        // Actual runs for this job's agent within window
        const agentRuns = job.agentId ? (runsByAgent[job.agentId] ?? []) : [];
        for (const r of agentRuns) {
          const startedAtMs = typeof r.startedAt === "string" ? new Date(r.startedAt).getTime() : (r.startedAt as number);
          if (startedAtMs && startedAtMs >= windowStart && startedAtMs <= windowEnd) {
            dots.push({ ts: startedAtMs, type: "past", status: r.status });
          }
        }

        // Add cron occurrences as dots
        for (const ts of allOccs) {
          const hasActivity = dots.some((d) => d.type === "past" && Math.abs(d.ts - ts) < 60_000);
          if (hasActivity) continue;

          if (ts <= nowMs) {
            dots.push({ ts, type: "past" }); // missed
          } else {
            dots.push({ ts, type: "future" });
          }
        }
      }

      result[job.id] = dots.sort((a, b) => a.ts - b.ts);
    }
    return result;
  }, [jobs, recentRuns, nowMs, windowStart, windowEnd]);

  if (triggersFetching && !jobs) {
    return (
      <DetailLayout title="Automations">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      </DetailLayout>
    );
  }

  if (!jobs || jobs.length === 0) {
    return (
      <DetailLayout
        title="Automations"
        headerRight={
          <Pressable onPress={() => router.push("/heartbeats/new")} hitSlop={8}>
            <View className="flex-row items-center gap-1">
              <Plus size={18} color={colors.primary} />
              <Text style={{ color: colors.primary }} className="font-semibold text-base">New</Text>
            </View>
          </Pressable>
        }
      >
        <View className="flex-1 items-center justify-center px-6">
          <IconBolt size={48} strokeWidth={1.5} color={colors.mutedForeground} />
          <Text className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mt-4">
            No Automations
          </Text>
          <Muted className="text-center mt-2">
            Create an automation to run agent routines on a schedule.
          </Muted>
        </View>
      </DetailLayout>
    );
  }

  return (
    <DetailLayout
      title="Automations"
      headerRight={
        <Pressable onPress={() => router.push("/heartbeats/new")} hitSlop={8}>
          <View className="flex-row items-center gap-1">
            <Plus size={18} color={colors.primary} />
            <Text style={{ color: colors.primary }} className="font-semibold text-base">New</Text>
          </View>
        </Pressable>
      }
    >
      {/* Shared timeline labels */}
      <View className="px-4 pt-2">
        <TimelineLabels windowStart={windowStart} width={timelineWidth} />
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        {(jobs ?? []).map((job: any) => (
          <Pressable
            key={job.id}
            onPress={() => router.push(`/heartbeats/${job.id}`)}
            className="border-b border-neutral-200 dark:border-neutral-800 active:bg-neutral-50 dark:active:bg-neutral-900"
          >
            {/* Header row */}
            <View className="flex-row items-center justify-between px-4 pt-3 pb-1">
              <View className="flex-1 flex-row items-center gap-2">
                <Text className="text-sm font-medium text-neutral-900 dark:text-neutral-100 flex-shrink" numberOfLines={1}>
                  {job.name}
                </Text>
                {!job.enabled && (
                  <View className="bg-neutral-200 dark:bg-neutral-700 rounded px-1.5 py-0.5">
                    <Text className="text-[10px] text-neutral-500 dark:text-neutral-400">Paused</Text>
                  </View>
                )}
              </View>
              <Muted className="text-xs ml-2">{job.scheduleExpression ? scheduleLabel(job.scheduleExpression) : job.triggerType}</Muted>
            </View>
            {/* Timeline strip */}
            <View className="px-4 pb-3">
              <Timeline
                dots={jobDots[job.id] ?? []}
                windowStart={windowStart}
                width={timelineWidth}
                colors={colors}
              />
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </DetailLayout>
  );
}
