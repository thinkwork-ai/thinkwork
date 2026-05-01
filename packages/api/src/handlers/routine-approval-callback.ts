/**
 * routine-approval-callback (Plan 2026-05-01-005 §U8).
 *
 * SFN's inbox_approval recipe Task pauses execution via
 * `.waitForTaskToken` and invokes this Lambda directly (NOT through API
 * Gateway — SFN delivers the payload as the Lambda event). The callback:
 *
 *   1. Extracts `taskToken`, `executionId`, `nodeId`, `title`,
 *      `markdownContext`, `decisionSchema`, `assigneeUserId?` from the
 *      SFN-delivered payload.
 *   2. Resolves the `routine_executions` row by SFN execution ARN to
 *      capture `tenant_id` + `routine_id` for the inbox row.
 *   3. Inserts an `inbox_items` row with type='routine_approval' carrying
 *      the title + markdown context + decision schema in `config`.
 *   4. Inserts a `routine_approval_tokens` row keyed on the inbox item id
 *      and the SFN task token (consumed=false).
 *
 * The bridge (routine-approval-bridge.ts) handles the operator's later
 * decideInboxItem call: conditional UPDATE on the token row + invoke
 * routine-resume.
 *
 * Auth: SFN-Lambda invocations run under the routines execution role
 * (no Bearer auth on the call itself) — the IAM grant is the trust
 * boundary. No HTTP/API-Gateway exposure.
 */

import { eq } from "drizzle-orm";
import {
  inboxItems,
  routineApprovalTokens,
  routineExecutions,
} from "@thinkwork/database-pg/schema";
import { db } from "../graphql/utils.js";

// ---------------------------------------------------------------------------
// SFN-delivered event shape (matches the inbox_approval recipe emitter
// in packages/api/src/lib/routines/recipe-catalog.ts)
// ---------------------------------------------------------------------------

export interface RoutineApprovalCallbackEvent {
  taskToken: string;
  executionId: string;
  nodeId: string;
  title: string;
  markdownContext: string;
  decisionSchema?: Record<string, unknown>;
  assigneeUserId?: string;
}

export interface RoutineApprovalCallbackResult {
  inboxItemId: string;
  tokenId: string;
}

export async function handler(
  event: RoutineApprovalCallbackEvent,
): Promise<RoutineApprovalCallbackResult> {
  if (!event.taskToken) {
    throw new Error("routine-approval-callback: taskToken is required");
  }
  if (!event.executionId) {
    throw new Error("routine-approval-callback: executionId is required");
  }
  if (!event.title || !event.markdownContext) {
    throw new Error(
      "routine-approval-callback: title + markdownContext are required",
    );
  }

  // Resolve the routine_executions row so the inbox item carries the
  // correct tenant + routine + execution scoping.
  const [execution] = await db
    .select({
      id: routineExecutions.id,
      tenant_id: routineExecutions.tenant_id,
      routine_id: routineExecutions.routine_id,
    })
    .from(routineExecutions)
    .where(eq(routineExecutions.sfn_execution_arn, event.executionId));
  if (!execution) {
    // The bridge runs after the resolver insert in triggerRoutineRun /
    // job-trigger; missing row means an out-of-band SFN execution
    // started without our pre-emptive insert. Fail loud — the operator
    // would otherwise see an inbox item with no routine context.
    throw new Error(
      `routine-approval-callback: no routine_executions row for executionArn=${event.executionId}`,
    );
  }

  // Insert the inbox item the operator decides on. config carries the
  // markdown context + decision schema so the inbox UI can render the
  // approval form without a separate fetch.
  const [inboxRow] = await db
    .insert(inboxItems)
    .values({
      tenant_id: execution.tenant_id,
      requester_type: "system",
      recipient_id: event.assigneeUserId ?? null,
      type: "routine_approval",
      status: "pending",
      title: event.title,
      description: event.markdownContext,
      entity_type: "routine_execution",
      entity_id: execution.id,
      config: {
        executionArn: event.executionId,
        nodeId: event.nodeId,
        decisionSchema: event.decisionSchema ?? null,
        markdownContext: event.markdownContext,
      },
    })
    .returning();

  // Persist the SFN task token. The partial UNIQUE index on
  // (execution_id, node_id) WHERE consumed=false enforces single-pending-
  // approval-per-node; if SFN somehow re-fires the callback for the same
  // node before the prior approval lands, the second insert raises
  // unique_violation and we surface it.
  const [tokenRow] = await db
    .insert(routineApprovalTokens)
    .values({
      tenant_id: execution.tenant_id,
      execution_id: execution.id,
      inbox_item_id: inboxRow.id,
      node_id: event.nodeId,
      task_token: event.taskToken,
      consumed: false,
    })
    .returning();

  return {
    inboxItemId: inboxRow.id,
    tokenId: tokenRow.id,
  };
}
