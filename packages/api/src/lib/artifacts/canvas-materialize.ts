/**
 * Canvas materialization (Living Artifacts THINK-145 U8, R13).
 *
 * Checking a saved canvas out into a thread means making its head part LIVE in
 * that thread. Two seams carry it, and each is failure-isolated:
 *
 *  1. A durable `messages` row (role `assistant`) carrying the canvas head as a
 *     `data-json-render` part under its ORIGINAL stable part id — so a fresh
 *     load of the thread renders the canvas exactly like an agent-authored one
 *     (same `messages.parts` path `promoteGenUIArtifact` reads).
 *  2. A best-effort `state_snapshot` thread-turn event on the thread's most
 *     recent turn (KTD1 AG-UI vocabulary) so clients already watching the
 *     thread converge without a reload. `thread_turn_events.run_id` is a NOT
 *     NULL FK to `thread_turns`, so when the thread has never had a turn there
 *     is nothing to append to — the durable message row (and its
 *     `notifyNewMessage`) is the only convergence path in that case.
 *
 * The stable part id is preserved so a later re-emission of the same part in
 * this thread routes back to the ORIGINAL artifact via the check-out record
 * (see `born-artifact.ts` `findCheckoutRoutedArtifact`).
 */

import type { ThreadJsonRenderPart } from "../thread-json-render/persisted-parts.js";
import { threadJsonRenderStateSnapshotPayload } from "@thinkwork/thread-json-render";
import {
  and,
  db,
  desc,
  eq,
  messages,
  randomUUID,
  threadTurns,
} from "../../graphql/utils.js";
import { notifyNewMessage, notifyThreadTurnStep } from "../../graphql/notify.js";
import {
  appendThreadTurnEvent,
  drizzleThreadTurnEventStore,
} from "../thread-turn-events.js";

/**
 * `thread_turn_events.event_type` for an AG-UI STATE_SNAPSHOT (KTD1). Kept in
 * sync with the Pi runtime's
 * `STATE_SNAPSHOT_ACTIVITY_EVENT_TYPE` (a wire contract,
 * inlined here to avoid a cross-package import into the API lib — mirrors
 * `born-artifact.ts`'s inlined activity-payload-kind constant).
 */
const STATE_SNAPSHOT_ACTIVITY_EVENT_TYPE = "state_snapshot" as const;

export interface MaterializeCanvasResult {
  messageId: string;
  /** seq of the state_snapshot event, or null when no live turn existed. */
  eventSeq: number | null;
}

export async function materializeCanvasIntoThread(input: {
  tenantId: string;
  threadId: string;
  agentId: string | null;
  part: ThreadJsonRenderPart;
}): Promise<MaterializeCanvasResult> {
  // 1) Durable materialization: an assistant message carrying the part under
  //    its original stable id.
  const messageId = randomUUID();
  await db.insert(messages).values({
    id: messageId,
    thread_id: input.threadId,
    tenant_id: input.tenantId,
    role: "assistant",
    parts: [input.part],
    metadata: { source: "canvas_checkout", stablePartId: input.part.id },
  });

  await notifyNewMessage({
    messageId,
    threadId: input.threadId,
    tenantId: input.tenantId,
    role: "assistant",
    senderType: "agent",
    senderId: input.agentId ?? undefined,
  }).catch((err) => {
    console.error(
      "[canvas-materialize] notifyNewMessage failed (best-effort):",
      err,
    );
  });

  // 2) Live convergence: a state_snapshot event on the most recent turn, if the
  //    thread has one. No turn → skip (run_id is a NOT NULL FK).
  let eventSeq: number | null = null;
  try {
    const [turn] = await db
      .select({ id: threadTurns.id })
      .from(threadTurns)
      .where(
        and(
          eq(threadTurns.tenant_id, input.tenantId),
          eq(threadTurns.thread_id, input.threadId),
        ),
      )
      .orderBy(desc(threadTurns.created_at))
      .limit(1);
    if (turn?.id) {
      const payload = threadJsonRenderStateSnapshotPayload(input.part);
      const row = await appendThreadTurnEvent(drizzleThreadTurnEventStore(), {
        tenantId: input.tenantId,
        runId: turn.id,
        agentId: input.agentId,
        eventType: STATE_SNAPSHOT_ACTIVITY_EVENT_TYPE,
        message: "",
        payload,
        stream: "step",
      });
      eventSeq = row.seq;
      await notifyThreadTurnStep({
        runId: turn.id,
        threadId: input.threadId,
        tenantId: input.tenantId,
        seq: row.seq,
        eventType: STATE_SNAPSHOT_ACTIVITY_EVENT_TYPE,
        stream: "step",
        payload: payload as unknown as Record<string, unknown>,
        createdAt: new Date().toISOString(),
      }).catch((err) => {
        console.error(
          "[canvas-materialize] notifyThreadTurnStep failed (best-effort):",
          err,
        );
      });
    }
  } catch (err) {
    // Live convergence is best-effort; the durable message row already
    // materialized the canvas. Never fail the check-out on a publish fault.
    console.error(
      "[canvas-materialize] state_snapshot publish failed (best-effort):",
      err,
    );
  }

  return { messageId, eventSeq };
}
