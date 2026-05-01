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

import { and, eq } from "drizzle-orm";
import {
  inboxItems,
  routineApprovalTokens,
  routineExecutions,
  tenantMembers,
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

  // Resolve the routine_executions row. triggerRoutineRun /
  // job-trigger insert this row pre-emptively, but if the
  // inbox_approval recipe is the StartAt state, the SFN callback can
  // race the resolver's commit. Retry a few times with a short delay
  // before giving up — fail-loud after that so the SFN task surfaces
  // as a real failure rather than silently looping.
  const execution = await resolveRoutineExecutionWithRetry(event.executionId);
  if (!execution) {
    console.warn(
      `[routine-approval-callback] no routine_executions row for executionArn=${event.executionId} — out-of-band SFN execution or pre-insert race`,
    );
    throw new Error(
      `routine-approval-callback: no routine_executions row for executionArn=${event.executionId}`,
    );
  }

  // assigneeUserId arrives from the recipe ASL. A malicious or
  // mistyped UUID could pin the approval onto a foreign-tenant user;
  // verify membership before persisting recipient_id.
  let recipientId: string | null = null;
  if (event.assigneeUserId) {
    const [member] = await db
      .select({ principal_id: tenantMembers.principal_id })
      .from(tenantMembers)
      .where(
        and(
          eq(tenantMembers.tenant_id, execution.tenant_id),
          eq(tenantMembers.principal_id, event.assigneeUserId),
        ),
      );
    if (member) {
      recipientId = event.assigneeUserId;
    } else {
      console.warn(
        `[routine-approval-callback] assigneeUserId=${event.assigneeUserId} is not a member of tenant=${execution.tenant_id}; dropping recipient`,
      );
    }
  }

  // Wrap the two inserts in a transaction so a partial failure +
  // SFN/Lambda async retry doesn't orphan an inbox row that the bridge
  // can never find.
  const result = await db.transaction(async (tx) => {
    const [inboxRow] = await tx
      .insert(inboxItems)
      .values({
        tenant_id: execution.tenant_id,
        requester_type: "system",
        recipient_id: recipientId,
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
    // (execution_id, node_id) WHERE consumed=false enforces
    // single-pending-approval-per-node.
    const [tokenRow] = await tx
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
    return { inboxItemId: inboxRow.id, tokenId: tokenRow.id };
  });
  return result;
}

async function resolveRoutineExecutionWithRetry(
  sfnExecutionArn: string,
): Promise<
  | { id: string; tenant_id: string; routine_id: string }
  | undefined
> {
  // 3 attempts at 100ms intervals — the resolver insert is sub-100ms
  // typically, so the worst-case race window is short. SFN's own task
  // retry is the next backstop if all attempts miss.
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await db
      .select({
        id: routineExecutions.id,
        tenant_id: routineExecutions.tenant_id,
        routine_id: routineExecutions.routine_id,
      })
      .from(routineExecutions)
      .where(eq(routineExecutions.sfn_execution_arn, sfnExecutionArn));
    if (row) return row;
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return undefined;
}
