import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  harnessManagedThreadEnrollments,
  harnessParticipantSessionEvents,
  harnessParticipantSessions,
  messages,
  threadPublicEvents,
  threadTurns,
} from "@thinkwork/database-pg/schema";

import {
  loadCanonicalHarnessPrefix,
  type CanonicalHarnessPrefix,
} from "./thread-public-state.js";
import { HarnessDuplicateDeliveryError } from "./runner.js";

export interface PreparedFreshHarnessTurn extends CanonicalHarnessPrefix {
  sessionRecordId: string;
  runtimeSessionId: string;
  participantUserId: string;
}

export async function prepareFreshHarnessTurn(input: {
  tenantId: string;
  threadId: string;
  turnId: string;
  agentId: string;
  participantUserId: string;
  qualifier: string;
  resolvedVersion: string;
  baseFingerprint: string;
  participantFingerprint: string;
}): Promise<PreparedFreshHarnessTurn> {
  const database = getDb();
  const allocated = await database.transaction(async (tx) => {
    const [turn] = await tx
      .select({
        threadId: threadTurns.thread_id,
        agentId: threadTurns.agent_id,
        triggeringMessageId: threadTurns.triggering_message_id,
      })
      .from(threadTurns)
      .where(
        and(
          eq(threadTurns.tenant_id, input.tenantId),
          eq(threadTurns.id, input.turnId),
        ),
      )
      .limit(1);
    if (
      !turn ||
      turn.threadId !== input.threadId ||
      turn.agentId !== input.agentId ||
      !turn.triggeringMessageId
    ) {
      throw new Error("harness_turn_tuple_mismatch");
    }
    const [trigger] = await tx
      .select({ senderId: messages.sender_id })
      .from(messages)
      .where(
        and(
          eq(messages.tenant_id, input.tenantId),
          eq(messages.thread_id, input.threadId),
          eq(messages.id, turn.triggeringMessageId),
          eq(messages.role, "user"),
        ),
      )
      .limit(1);
    if (!trigger || trigger.senderId !== input.participantUserId) {
      throw new Error("harness_turn_participant_mismatch");
    }
    const [enrollment] = await tx
      .select({
        id: harnessManagedThreadEnrollments.id,
        agentId: harnessManagedThreadEnrollments.logical_agent_id,
        qualifier: harnessManagedThreadEnrollments.qualifier,
        version: harnessManagedThreadEnrollments.resolved_version,
      })
      .from(harnessManagedThreadEnrollments)
      .where(
        and(
          eq(harnessManagedThreadEnrollments.tenant_id, input.tenantId),
          eq(harnessManagedThreadEnrollments.thread_id, input.threadId),
          eq(harnessManagedThreadEnrollments.status, "active"),
          eq(harnessManagedThreadEnrollments.session_strategy, "fresh"),
        ),
      )
      .limit(1);
    if (!enrollment) throw new Error("agentcore_thread_enrollment_required");
    if (
      enrollment.agentId !== input.agentId ||
      enrollment.qualifier !== input.qualifier ||
      enrollment.version !== input.resolvedVersion
    ) {
      throw new Error("harness_enrollment_profile_drift");
    }
    const [triggerEvent] = await tx
      .select({ id: threadPublicEvents.id })
      .from(threadPublicEvents)
      .where(
        and(
          eq(threadPublicEvents.tenant_id, input.tenantId),
          eq(threadPublicEvents.thread_id, input.threadId),
          eq(threadPublicEvents.source_kind, "message"),
          eq(threadPublicEvents.source_id, turn.triggeringMessageId),
          eq(threadPublicEvents.event_kind, "insert"),
        ),
      )
      .orderBy(threadPublicEvents.id)
      .limit(1);
    if (!triggerEvent) throw new Error("harness_trigger_event_missing");

    const runtimeSessionId = `tw-harness-turn-${input.turnId}`;
    await tx
      .insert(harnessParticipantSessions)
      .values({
        tenant_id: input.tenantId,
        enrollment_id: enrollment.id,
        thread_id: input.threadId,
        participant_user_id: input.participantUserId,
        turn_id: input.turnId,
        runtime_session_id: runtimeSessionId,
        generation: 1,
        captured_high_water: triggerEvent.id,
        qualifier: input.qualifier,
        resolved_version: input.resolvedVersion,
        base_fingerprint: input.baseFingerprint,
        participant_fingerprint: input.participantFingerprint,
        state: "allocated",
      })
      .onConflictDoNothing({
        target: [
          harnessParticipantSessions.tenant_id,
          harnessParticipantSessions.turn_id,
        ],
      });
    const [session] = await tx
      .select({
        id: harnessParticipantSessions.id,
        runtimeSessionId: harnessParticipantSessions.runtime_session_id,
        state: harnessParticipantSessions.state,
        highWater: harnessParticipantSessions.captured_high_water,
        participantUserId: harnessParticipantSessions.participant_user_id,
      })
      .from(harnessParticipantSessions)
      .where(
        and(
          eq(harnessParticipantSessions.tenant_id, input.tenantId),
          eq(harnessParticipantSessions.turn_id, input.turnId),
        ),
      )
      .limit(1);
    if (!session || session.participantUserId !== input.participantUserId) {
      throw new Error("harness_fresh_session_tuple_mismatch");
    }
    const [claimed] = await tx
      .update(harnessParticipantSessions)
      .set({ state: "running", started_at: new Date() })
      .where(
        and(
          eq(harnessParticipantSessions.id, session.id),
          eq(harnessParticipantSessions.state, "allocated"),
        ),
      )
      .returning({ id: harnessParticipantSessions.id });
    if (!claimed) throw new HarnessDuplicateDeliveryError(session.state);
    await tx.insert(harnessParticipantSessionEvents).values({
      tenant_id: input.tenantId,
      session_id: session.id,
      turn_id: input.turnId,
      event_type: "claim",
      from_state: "allocated",
      to_state: "running",
      applied_high_water: session.highWater,
      evidence: { strategy: "fresh", generation: 1 },
    });
    return {
      sessionRecordId: session.id,
      runtimeSessionId: session.runtimeSessionId,
      capturedHighWater: session.highWater,
      triggeringMessageId: turn.triggeringMessageId,
    };
  });

  let prefix: CanonicalHarnessPrefix;
  try {
    prefix = await loadCanonicalHarnessPrefix({
      tenantId: input.tenantId,
      threadId: input.threadId,
      participantUserId: input.participantUserId,
      triggeringMessageId: allocated.triggeringMessageId,
      capturedHighWater: allocated.capturedHighWater,
    });
  } catch (error) {
    await abandonFreshHarnessTurn({
      tenantId: input.tenantId,
      turnId: input.turnId,
      sessionRecordId: allocated.sessionRecordId,
      reasonCode: "canonical_hydration_failed",
    });
    throw error;
  }
  return {
    ...prefix,
    sessionRecordId: allocated.sessionRecordId,
    runtimeSessionId: allocated.runtimeSessionId,
    participantUserId: input.participantUserId,
  };
}

export async function transitionFreshHarnessTurn(input: {
  tenantId: string;
  turnId: string;
  sessionRecordId: string;
  from: "running" | "finalizing";
  to: "finalizing" | "completed";
  appliedHighWater: number;
}): Promise<void> {
  const database = getDb();
  await database.transaction(async (tx) => {
    const terminal = input.to === "completed";
    const authorizationFence =
      input.from === "running" && input.to === "finalizing"
        ? sql`EXISTS (
            SELECT 1
            FROM harness_managed_thread_enrollments he
            JOIN thread_participants hp
              ON hp.tenant_id = ${harnessParticipantSessions.tenant_id}
             AND hp.thread_id = ${harnessParticipantSessions.thread_id}
             AND hp.participant_type = 'user'
             AND hp.user_id = ${harnessParticipantSessions.participant_user_id}
            WHERE he.id = ${harnessParticipantSessions.enrollment_id}
              AND he.tenant_id = ${harnessParticipantSessions.tenant_id}
              AND he.thread_id = ${harnessParticipantSessions.thread_id}
              AND he.status = 'active'
              AND he.qualifier = ${harnessParticipantSessions.qualifier}
              AND he.resolved_version = ${harnessParticipantSessions.resolved_version}
              AND ${harnessParticipantSessions.base_fingerprint} <> ''
              AND ${harnessParticipantSessions.participant_fingerprint} <> ''
              AND NOT EXISTS (
                SELECT 1 FROM thread_public_events hpe
                WHERE hpe.tenant_id = ${harnessParticipantSessions.tenant_id}
                  AND hpe.thread_id = ${harnessParticipantSessions.thread_id}
                  AND hpe.id > ${harnessParticipantSessions.captured_high_water}
                  AND hpe.event_kind = 'invalidate'
              )
          )`
        : sql`true`;
    const [updated] = await tx
      .update(harnessParticipantSessions)
      .set({
        state: input.to,
        applied_high_water: input.appliedHighWater,
        ...(terminal ? { finished_at: new Date() } : {}),
      })
      .where(
        and(
          eq(harnessParticipantSessions.tenant_id, input.tenantId),
          eq(harnessParticipantSessions.turn_id, input.turnId),
          eq(harnessParticipantSessions.id, input.sessionRecordId),
          eq(harnessParticipantSessions.state, input.from),
          authorizationFence,
        ),
      )
      .returning({ id: harnessParticipantSessions.id });
    if (!updated) throw new Error("harness_session_transition_fenced");
    await tx.insert(harnessParticipantSessionEvents).values({
      tenant_id: input.tenantId,
      session_id: input.sessionRecordId,
      turn_id: input.turnId,
      event_type: input.to === "completed" ? "complete" : "finalize_claim",
      from_state: input.from,
      to_state: input.to,
      applied_high_water: input.appliedHighWater,
      evidence: { strategy: "fresh", generation: 1 },
    });
  });
}

export async function abandonFreshHarnessTurn(input: {
  tenantId: string;
  turnId: string;
  sessionRecordId: string;
  reasonCode: string;
}): Promise<void> {
  const database = getDb();
  await database.transaction(async (tx) => {
    const [session] = await tx
      .select({ state: harnessParticipantSessions.state })
      .from(harnessParticipantSessions)
      .where(
        and(
          eq(harnessParticipantSessions.tenant_id, input.tenantId),
          eq(harnessParticipantSessions.turn_id, input.turnId),
          eq(harnessParticipantSessions.id, input.sessionRecordId),
        ),
      )
      .limit(1);
    if (
      !session ||
      session.state === "completed" ||
      session.state === "abandoned"
    )
      return;
    const [updated] = await tx
      .update(harnessParticipantSessions)
      .set({
        state: "abandoned",
        failure_reason: input.reasonCode,
        finished_at: new Date(),
      })
      .where(
        and(
          eq(harnessParticipantSessions.id, input.sessionRecordId),
          inArray(harnessParticipantSessions.state, [
            "allocated",
            "running",
            "finalizing",
          ]),
        ),
      )
      .returning({ id: harnessParticipantSessions.id });
    if (!updated) return;
    await tx.insert(harnessParticipantSessionEvents).values({
      tenant_id: input.tenantId,
      session_id: input.sessionRecordId,
      turn_id: input.turnId,
      event_type: "abandon",
      from_state: session.state,
      to_state: "abandoned",
      reason_code: input.reasonCode,
      evidence: { strategy: "fresh", generation: 1 },
    });
  });
}
