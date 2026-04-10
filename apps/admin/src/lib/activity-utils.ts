// Shared activity types, normalizers, and constants used by both
// the Activity page and the Agent detail page.

export type ActivityType = "chat" | "routine" | "task" | "scheduled" | "thread" | "email" | "webhook";

export type ActivityItem = {
  id: string;
  type: ActivityType;
  title: string;
  status: string;
  agentId?: string | null;
  agentName?: string | null;
  timestamp: number;
  duration?: number;
  cost?: number | null;
  sourceId: string;
  sourceType: "ticket_turn" | "thread";
  threadId?: string | null;
  runData?: any;
};

export const TYPE_LABELS: Record<ActivityType, string> = {
  chat: "Chat",
  routine: "Routine",
  task: "Task",
  scheduled: "Scheduled",
  thread: "Thread",
  email: "Email",
  webhook: "Webhook",
};

export const TYPE_COLORS: Record<ActivityType, string> = {
  chat: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  routine: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  task: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  scheduled: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  thread: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  email: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  webhook: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
};

export const STATUS_COLORS: Record<string, string> = {
  succeeded: "bg-green-500/15 text-green-600 dark:text-green-400",
  completed: "bg-green-500/15 text-green-600 dark:text-green-400",
  done: "bg-green-500/15 text-green-600 dark:text-green-400",
  active: "bg-green-500/15 text-green-600 dark:text-green-400",
  open: "bg-green-500/15 text-green-600 dark:text-green-400",
  in_progress: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  running: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  pending: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  queued: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400",
  error: "bg-red-500/15 text-red-600 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground",
  closed: "bg-muted text-muted-foreground",
};

export function formatCost(cost: number | null | undefined): string {
  if (cost == null || cost === 0) return "—";
  return `$${cost.toFixed(4)}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || ms === 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export const ALL_TYPES: ActivityType[] = ["chat", "scheduled", "thread", "routine", "task", "email", "webhook"];
export const ALL_STATUSES = ["succeeded", "failed", "running", "pending", "in_progress", "done", "open", "closed", "cancelled"];

const SOURCE_TYPE_MAP: Record<string, ActivityType> = {
  webhook: "webhook",
  email_received: "email",
  email_triage: "email",
  chat_message: "chat",
  automation: "chat",
  schedule: "scheduled",
  timer: "scheduled",
  heartbeat_timer: "scheduled",
  on_demand: "scheduled",
  trigger: "scheduled",
};

export function mapRuns(
  runs: any[],
  agentMap: Map<string, string>,
): ActivityItem[] {
  return runs.map((r: any) => {
    const startMs = r.startedAt ? new Date(r.startedAt).getTime() : new Date(r.createdAt).getTime();
    const endMs = r.finishedAt ? new Date(r.finishedAt).getTime() : undefined;
    return {
      id: `run:${r.id}`,
      type: SOURCE_TYPE_MAP[r.invocationSource] ?? "scheduled",
      title: r.triggerName ?? r.invocationSource?.replace(/_/g, " ") ?? "Run",
      status: (r.status ?? "").toLowerCase(),
      agentId: r.agentId,
      agentName: r.agentId ? agentMap.get(r.agentId) : null,
      timestamp: startMs,
      duration: endMs ? endMs - startMs : undefined,
      cost: r.totalCost ?? null,
      sourceId: r.id,
      sourceType: "ticket_turn",
      threadId: r.threadId ?? null,
      runData: r,
    };
  });
}

const CHANNEL_TYPE_MAP: Record<string, ActivityType> = {
  CHAT: "chat",
  EMAIL: "email",
  SCHEDULE: "scheduled",
  MANUAL: "thread",
  WEBHOOK: "thread",
  API: "thread",
};

export function mapThreads(
  threads: any[],
  agentMap: Map<string, string>,
): ActivityItem[] {
  return threads.map((t: any) => ({
    id: `thread:${t.id}`,
    type: CHANNEL_TYPE_MAP[t.channel] ?? "thread",
    title: `${t.identifier ?? `#${t.number}`}: ${t.title}`,
    status: (t.status ?? "open").toLowerCase(),
    agentId: t.agentId,
    agentName: t.agent?.name ?? (t.agentId ? agentMap.get(t.agentId) : null),
    timestamp: new Date(t.updatedAt ?? t.createdAt).getTime(),
    cost: t.costSummary ?? null,
    sourceId: t.id,
    sourceType: "thread",
  }));
}
