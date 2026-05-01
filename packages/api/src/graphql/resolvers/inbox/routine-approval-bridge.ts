/**
 * Routine approval bridge (Plan 2026-05-01-005 §U8).
 *
 * When an operator decides on an inbox item of type 'routine_approval',
 * this bridge:
 *
 *   1. Conditionally UPDATEs `routine_approval_tokens` from
 *      consumed=false → consumed=true scoped to (inbox_item_id,
 *      consumed=false). The partial UNIQUE index on (execution_id,
 *      node_id) WHERE consumed=false makes a second decide on the same
 *      token match 0 rows. **This is the load-bearing safety property:**
 *      a double-decide MUST NOT call SendTaskSuccess twice.
 *
 *   2. If the UPDATE matched 1 row, invoke the routine-resume Lambda
 *      via the AWS SDK with `RequestResponse` semantics so SFN errors
 *      surface back to the caller (the inbox decideInboxItem mutation).
 *      decision='approved' → SendTaskSuccess with the operator's
 *      decision payload as output. decision='rejected' → SendTaskFailure
 *      with errorCode='RoutineApprovalRejected' and the reviewer's
 *      review notes as cause.
 *
 *   3. If the UPDATE matched 0 rows, return `alreadyDecided:true`. The
 *      caller treats this as a no-op success (idempotent decide).
 *
 * The routine-resume Lambda's own idempotency translation
 * (`TaskDoesNotExist` / `TaskTimedOut` → `alreadyConsumed:true`) covers
 * the rare DB+SFN race where the DB row is consumed but SFN already
 * timed out the token. We propagate `dispatched:true` in that case
 * because the bridge did its job.
 */

import { eq } from "drizzle-orm";
import {
  InvokeCommand,
  LambdaClient,
} from "@aws-sdk/client-lambda";
import { routineApprovalTokens } from "@thinkwork/database-pg/schema";
import { and, db } from "../../utils.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Subset of the inbox_items row shape this bridge needs. */
export interface RoutineApprovalInboxItem {
  id: string;
  type: string;
  tenant_id: string;
  entity_id: string | null;
  entity_type: string | null;
}

export type RoutineApprovalDecision = "approved" | "rejected";

export interface RoutineApprovalDecisionPayload {
  /** Operator review notes — surfaced as `cause` on SendTaskFailure or
   * embedded in the success output payload. */
  reviewNotes?: string | null;
  /** Optional structured decision values when the recipe declared a
   * decisionSchema with custom fields. */
  values?: Record<string, unknown>;
}

export interface BridgeResult {
  /** True iff the bridge invoked routine-resume on this call. */
  dispatched: boolean;
  /** True iff a prior decide already consumed the token (or no token
   * exists for this inbox item). The decideInboxItem caller treats this
   * as a non-error: the operator's intent is recorded on the inbox row,
   * the SFN-side resume is just a no-op. */
  alreadyDecided: boolean;
}

// ---------------------------------------------------------------------------
// Module-scope Lambda client. Production graphql-http warm invocations
// reuse the TCP pool; tests `vi.mock('@aws-sdk/client-lambda')`.
// ---------------------------------------------------------------------------

const _DEFAULT_LAMBDA_CLIENT = new LambdaClient({
  requestHandler: { requestTimeout: 8_000, connectionTimeout: 5_000 },
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Type guard for the decideInboxItem dispatch — `current.type === 'routine_approval'`. */
export function isRoutineApprovalInboxItem(item: { type: string }): boolean {
  return item.type === "routine_approval";
}

export async function bridgeInboxDecisionToRoutineApproval(input: {
  inboxItem: RoutineApprovalInboxItem;
  decision: RoutineApprovalDecision;
  actorId: string | null;
  decisionPayload: RoutineApprovalDecisionPayload;
  /** Optional override for the Lambda client (tests inject a mock). */
  lambdaClient?: LambdaClient;
}): Promise<BridgeResult> {
  if (!isRoutineApprovalInboxItem(input.inboxItem)) {
    return { dispatched: false, alreadyDecided: false };
  }

  // Snapshot env at handler entry (the resolver — this function is
  // called from decideInboxItem). Re-reading later would risk shadowing.
  const resumeFunctionName = process.env.ROUTINE_RESUME_FUNCTION_NAME ?? "";
  if (!resumeFunctionName) {
    throw new Error(
      "Routines HITL bridge is misconfigured: ROUTINE_RESUME_FUNCTION_NAME env var is not set",
    );
  }

  // Step 1 — conditional UPDATE: consumed=false → true.
  // The WHERE clause on (inbox_item_id, consumed=false) plus the partial
  // UNIQUE index on (execution_id, node_id) WHERE consumed=false enforce
  // single-decide. .returning() with 0 rows means a prior decide already
  // consumed the token (or no token exists for this inbox item).
  const consumed = await db
    .update(routineApprovalTokens)
    .set({
      consumed: true,
      decided_by_user_id: input.actorId,
      decision_value_json: input.decisionPayload as Record<string, unknown>,
      decided_at: new Date(),
    })
    .where(
      and(
        eq(routineApprovalTokens.inbox_item_id, input.inboxItem.id),
        eq(routineApprovalTokens.consumed, false),
      ),
    )
    .returning();

  if (consumed.length === 0) {
    return { dispatched: false, alreadyDecided: true };
  }
  const tokenRow = consumed[0];

  // Step 2 — invoke routine-resume Lambda with RequestResponse so SFN
  // errors surface to the caller. The bridge has already flipped the
  // DB-side flag; if this invoke fails the caller (decideInboxItem)
  // surfaces the error and the operator can retry.
  const resumePayload =
    input.decision === "approved"
      ? {
          taskToken: tokenRow.task_token,
          decision: "success" as const,
          output: {
            decision: "approved",
            ...(input.decisionPayload.reviewNotes
              ? { reviewNotes: input.decisionPayload.reviewNotes }
              : {}),
            ...(input.decisionPayload.values ?? {}),
          },
        }
      : {
          taskToken: tokenRow.task_token,
          decision: "failure" as const,
          errorCode: "RoutineApprovalRejected",
          errorMessage: input.decisionPayload.reviewNotes ?? "",
        };

  const lambdaClient = input.lambdaClient ?? _DEFAULT_LAMBDA_CLIENT;
  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: resumeFunctionName,
      InvocationType: "RequestResponse",
      Payload: new TextEncoder().encode(JSON.stringify(resumePayload)),
    }),
  );

  return { dispatched: true, alreadyDecided: false };
}
