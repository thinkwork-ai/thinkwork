// Pure helpers for the Computer-scoped Automations table. Co-located with
// the route (leading "-" keeps TanStack Router from treating it as a route).
// Mirrors the helper set used by apps/admin's automations/schedules page.

export type ScheduledJobRow = {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  enabled: boolean;
  schedule_type: string | null;
  schedule_expression: string | null;
  timezone: string;
  agent_id: string | null;
  computer_id: string | null;
  routine_id: string | null;
  prompt: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
};

export type ThreadTurnRow = {
  id: string;
  job_id: string | null;
  trigger_id: string | null;
  agent_id: string | null;
  routine_id: string | null;
  invocation_source: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  result_json: Record<string, unknown> | null;
  usage_json: Record<string, unknown> | null;
  created_at: string;
};

export const JOB_TYPE_LABELS: Record<string, string> = {
  agent_heartbeat: "Heartbeat",
  agent_reminder: "Reminder",
  agent_scheduled: "Scheduled",
  routine_schedule: "Routine",
  routine_one_time: "One-time",
};

export function formatSchedule(expr: string | null): string {
  if (!expr) return "—";
  if (expr.startsWith("rate(")) return expr.slice(5, -1);
  if (expr.startsWith("at(")) {
    const dt = expr.slice(3, -1);
    try {
      return new Date(dt).toLocaleString();
    } catch {
      return dt;
    }
  }
  return expr;
}

/** Estimate next run from a schedule expression + last run time. Returns null if it can't be computed. */
export function estimateNextRun(
  scheduleExpr: string | null,
  lastRunAt: string | null,
): Date | null {
  if (!scheduleExpr) return null;

  if (scheduleExpr.startsWith("at(")) {
    const dt = scheduleExpr.slice(3, -1);
    try {
      const d = new Date(dt);
      return d > new Date() ? d : null;
    } catch {
      return null;
    }
  }

  if (scheduleExpr.startsWith("rate(")) {
    const inner = scheduleExpr.slice(5, -1).trim();
    const match = inner.match(/^(\d+)\s+(minute|hour|day|second)s?$/i);
    if (!match) return null;
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const ms =
      value *
      (unit === "second"
        ? 1000
        : unit === "minute"
          ? 60000
          : unit === "hour"
            ? 3600000
            : 86400000);
    const base = lastRunAt ? new Date(lastRunAt).getTime() : Date.now();
    const next = new Date(base + ms);
    if (next.getTime() < Date.now()) {
      const elapsed = Date.now() - base;
      const periods = Math.ceil(elapsed / ms);
      return new Date(base + periods * ms);
    }
    return next;
  }

  return null;
}

export function relativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, ms] of units) {
    if (absMs >= ms) {
      return formatter.format(Math.round(diffMs / ms), unit);
    }
  }
  return "just now";
}
