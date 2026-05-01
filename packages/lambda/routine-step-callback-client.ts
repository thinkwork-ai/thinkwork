/**
 * routine-step-callback-client — small fetch wrapper Task wrappers use
 * to POST step events to the routine-step-callback REST endpoint
 * (Plan 2026-05-01-005 §U9).
 *
 * Fire-and-log-on-failure: a step-event ingestion failure must NEVER
 * fail the SFN execution. Mirrors the pattern from
 * `packages/api/src/handlers/sandbox-invocation-log.ts`'s container-side
 * caller — telemetry write must not unwind the work it's logging.
 *
 * Snapshot the env (apiUrl, authSecret) at handler entry per
 * `feedback_completion_callback_snapshot_pattern`; pass it in here
 * rather than re-reading process.env from inside async paths.
 */

export interface StepCallbackEnv {
  apiUrl: string;
  authSecret: string;
}

export interface StepCallbackEvent {
  tenantId: string;
  /** Full SFN execution ARN. Resolved server-side to
   * routine_executions.id via SELECT on sfn_execution_arn. Callers (Task
   * wrappers + EventBridge) naturally have the ARN, not the row UUID. */
  executionArn: string;
  nodeId: string;
  recipeType: string;
  status:
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "timed_out"
    | "awaiting_approval";
  startedAt?: string;
  finishedAt?: string;
  inputJson?: unknown;
  outputJson?: unknown;
  errorJson?: unknown;
  llmCostUsdCents?: number;
  retryCount?: number;
  stdoutS3Uri?: string;
  stderrS3Uri?: string;
  stdoutPreview?: string;
  truncated?: boolean;
}

/**
 * POST a step event to the routine-step-callback REST endpoint.
 *
 * Returns true when the API accepted the event (201 or 200 deduped),
 * false on any non-2xx or transport failure. Never throws — caller is
 * the SFN Task wrapper, and a step-event failure must not unwind the
 * Task or the surrounding execution.
 */
export async function postStepCallback(
  env: StepCallbackEnv,
  event: StepCallbackEvent,
): Promise<boolean> {
  if (!env.apiUrl || !env.authSecret) {
    console.warn(
      `[routine-step-callback-client] skipped: missing ${!env.apiUrl ? "apiUrl" : "authSecret"} for executionArn=${event.executionArn} nodeId=${event.nodeId} status=${event.status}`,
    );
    return false;
  }
  const url = `${env.apiUrl.replace(/\/+$/, "")}/api/routines/step`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.authSecret}`,
      },
      body: JSON.stringify(event),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.warn(
        `[routine-step-callback-client] non-2xx status=${resp.status} executionArn=${event.executionArn} nodeId=${event.nodeId}: ${text.slice(0, 500)}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn(
      `[routine-step-callback-client] fetch failed executionArn=${event.executionArn} nodeId=${event.nodeId}: ${(err as Error).message}`,
    );
    return false;
  }
}
