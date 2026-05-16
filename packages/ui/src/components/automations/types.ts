/**
 * Shared types and constants for the scheduled-job (Automations) detail UI.
 *
 * Both `apps/admin` and `apps/computer` render the same backend row from
 * `GET /api/thread-turns` and need the same visual vocabulary for status
 * pills. Keeping the type + colors here ensures the two apps cannot drift.
 */

export interface ScheduledJobRunRow {
  id: string;
  invocation_source: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  result_json: Record<string, unknown> | null;
  usage_json: Record<string, unknown> | null;
  created_at: string;
}

export const RUN_STATUS_COLORS: Record<string, string> = {
  queued: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  running: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  succeeded: "bg-green-500/15 text-green-600 dark:text-green-400",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400",
  cancelled: "bg-muted text-muted-foreground",
};
