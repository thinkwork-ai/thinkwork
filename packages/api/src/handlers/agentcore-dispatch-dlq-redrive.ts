/**
 * agentcore-dispatch-dlq-redrive (THINK-585 U6, R5).
 *
 * The dispatcher Lambda runs with EventInvokeConfig retries=0 and a DLQ: an
 * invoke that dies before the handler can mark its turn failed (OOM, crash,
 * timeout at 900 s) lands here as the original LWA envelope. This consumer
 * marks the enveloped thread_turn failed **idempotently** — the UPDATE is
 * guarded on status='running' AND finalized_at IS NULL, so a turn the
 * container already finalized (dispatcher died after finalize) is a no-op.
 *
 * Emits one `dispatch_dlq_redrive` log line per record for the U8 dashboard
 * (log-metric; DLQ depth > 0 is a soak-gate failure).
 */

import { eq, and, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { threadTurns } from "@thinkwork/database-pg/schema";
import { notifyThreadTurnUpdate } from "../lib/chat-finalize/notify.js";
import { releaseThreadCheckout } from "../lib/thread-checkout.js";

interface SqsRecord {
  messageId: string;
  body: string;
}

export interface SqsEvent {
  Records?: SqsRecord[];
}

interface RedriveOutcome {
  messageId: string;
  threadTurnId: string | null;
  outcome: "marked_failed" | "already_settled" | "unparseable";
}

function extractTurnRef(body: string): {
  tenantId: string;
  threadId: string;
  agentId: string;
  threadTurnId: string;
} | null {
  try {
    // Lambda DLQ messages carry the original invoke payload as the SQS body
    // (the LWA envelope); its `body` is the inner dispatch payload JSON.
    const envelope = JSON.parse(body) as { body?: string };
    const payload = JSON.parse(envelope.body ?? "") as Record<string, unknown>;
    const tenantId = String(payload.tenant_id ?? "");
    const threadId = String(payload.thread_id ?? "");
    const agentId = String(payload.assistant_id ?? "");
    const threadTurnId = String(payload.thread_turn_id ?? "");
    if (!tenantId || !threadId || !threadTurnId) return null;
    return { tenantId, threadId, agentId, threadTurnId };
  } catch {
    return null;
  }
}

export async function handler(event: SqsEvent): Promise<void> {
  const db = getDb();
  const outcomes: RedriveOutcome[] = [];

  for (const record of event.Records ?? []) {
    const ref = extractTurnRef(record.body);
    if (!ref) {
      outcomes.push({
        messageId: record.messageId,
        threadTurnId: null,
        outcome: "unparseable",
      });
      continue;
    }

    const updated = await db
      .update(threadTurns)
      .set({
        status: "failed",
        finished_at: new Date(),
        last_activity_at: new Date(),
        error:
          "Runtime dispatch was lost (dispatcher crash or timeout); recovered by the DLQ redrive consumer.",
        error_code: "agentcore_runtime_dispatch_lost",
      })
      .where(
        and(
          eq(threadTurns.id, ref.threadTurnId),
          eq(threadTurns.tenant_id, ref.tenantId),
          eq(threadTurns.status, "running"),
          sql`${threadTurns.finalized_at} IS NULL`,
        ),
      )
      .returning({ id: threadTurns.id });

    if (updated.length > 0) {
      await notifyThreadTurnUpdate({
        runId: ref.threadTurnId,
        tenantId: ref.tenantId,
        threadId: ref.threadId,
        agentId: ref.agentId,
        status: "failed",
        triggerName: "AgentCore",
      }).catch(() => undefined);
      await releaseThreadCheckout({
        threadId: ref.threadId,
        runId: ref.threadTurnId,
      }).catch(() => undefined);
    }
    outcomes.push({
      messageId: record.messageId,
      threadTurnId: ref.threadTurnId,
      outcome: updated.length > 0 ? "marked_failed" : "already_settled",
    });
  }

  for (const outcome of outcomes) {
    console.log(JSON.stringify({ event: "dispatch_dlq_redrive", ...outcome }));
  }
}
