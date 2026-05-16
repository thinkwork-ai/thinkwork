import type { ScheduledJobRunRow } from "./types.js";

/**
 * Best-effort duration in milliseconds. Prefers an explicit
 * `usage_json.duration_ms` (set by the agent runtime) and falls back to the
 * gap between `started_at` and `finished_at` for runs the runtime didn't
 * populate. Returns null for queued / still-running rows.
 */
export function runDurationMs(run: ScheduledJobRunRow): number | null {
  const fromUsage = run.usage_json?.duration_ms;
  if (typeof fromUsage === "number" && Number.isFinite(fromUsage)) return fromUsage;
  if (run.started_at && run.finished_at) {
    const ms = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

export function formatRunDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatAbsoluteTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Extract the run's response markdown. The agent runtime wraps the response
 * in fenced code blocks for transport; strip those so the markdown renderer
 * sees the content directly.
 */
export function runResponseText(run: ScheduledJobRunRow): string | undefined {
  const raw = run.result_json?.response as string | undefined;
  return raw?.replace(/```[\w]*\n?/g, "");
}
