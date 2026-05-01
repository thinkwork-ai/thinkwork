/**
 * routine-resume — Step Functions task-token resume Lambda
 * (Plan 2026-05-01-005 §U6).
 *
 * Thin wrapper over `SendTaskSuccess` / `SendTaskFailure`. The
 * `routine-approval-bridge` (U8) calls this after it has flipped the
 * `routine_approval_tokens.consumed` flag for the inbox decision —
 * meaning the database-side consume-once invariant has already fired.
 *
 * This wrapper's job is the SFN-layer idempotency: AWS rejects sends
 * against an already-consumed or expired token with `TaskDoesNotExist`
 * or `TaskTimedOut`. We translate both to `alreadyConsumed: true` so the
 * caller can complete its turn cleanly when a race lands the second
 * resume here.
 *
 * Auth: the bridge calls this Lambda directly via the AWS SDK (IAM-gated
 * cross-Lambda invoke). No Bearer auth, no API Gateway. Snapshots env at
 * handler entry per `feedback_completion_callback_snapshot_pattern`.
 */

import {
  SendTaskFailureCommand,
  SendTaskSuccessCommand,
  SFNClient,
} from "@aws-sdk/client-sfn";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ResumeInput {
  taskToken: string;
  decision: "success" | "failure";
  /** Required when decision='success'. Serialized to JSON before SFN
   * receives it. Defaults to {} when omitted. */
  output?: Record<string, unknown>;
  /** Required when decision='failure'. AWS-side `error` field — short
   * machine-readable code. */
  errorCode?: string;
  /** Optional when decision='failure'. AWS-side `cause` field — operator-
   * facing message. */
  errorMessage?: string;
}

export interface ResumeResult {
  ok: true;
  /** True when SFN reported the token was already consumed or timed out.
   * False when this call is the first resume for the token. */
  alreadyConsumed: boolean;
}

export interface ResumeOptions {
  sfnClient?: SFNClient;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Module-scope client; warm Lambda invocations reuse the TCP pool.
const _DEFAULT_SFN_CLIENT = new SFNClient({});

// AWS SFN error names we map to `alreadyConsumed:true`. Adding new names
// here is a behavior change — keep the list narrow.
const _CONSUMED_ERROR_NAMES = new Set([
  "TaskDoesNotExist",
  "TaskTimedOut",
]);

// ---------------------------------------------------------------------------
// Pure entry point — exported for unit tests.
// ---------------------------------------------------------------------------

export async function resumeRoutineExecution(
  input: ResumeInput,
  options: ResumeOptions = {},
): Promise<ResumeResult> {
  if (!input.taskToken) {
    throw new Error("taskToken is required");
  }
  if (input.decision !== "success" && input.decision !== "failure") {
    throw new Error(
      `decision must be 'success' or 'failure', got '${String(input.decision)}'`,
    );
  }

  const sfn = options.sfnClient ?? _DEFAULT_SFN_CLIENT;

  try {
    if (input.decision === "success") {
      await sfn.send(
        new SendTaskSuccessCommand({
          taskToken: input.taskToken,
          output: JSON.stringify(input.output ?? {}),
        }),
      );
    } else {
      await sfn.send(
        new SendTaskFailureCommand({
          taskToken: input.taskToken,
          error: input.errorCode ?? "RoutineApprovalRejected",
          cause: input.errorMessage ?? "",
        }),
      );
    }
    return { ok: true, alreadyConsumed: false };
  } catch (err) {
    const name = (err as { name?: string })?.name ?? "";
    if (_CONSUMED_ERROR_NAMES.has(name)) {
      return { ok: true, alreadyConsumed: true };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Lambda handler — invoked directly by routine-approval-bridge via the
// AWS SDK (no API Gateway). Input is the ResumeInput shape; return is
// ResumeResult.
// ---------------------------------------------------------------------------

export async function handler(event: ResumeInput): Promise<ResumeResult> {
  return resumeRoutineExecution(event);
}
