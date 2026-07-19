import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  messageArtifacts,
  messages,
  threadParticipants,
  threadPublicEvents,
} from "@thinkwork/database-pg/schema";

export interface CanonicalHarnessMessage {
  role: "user" | "assistant";
  content: string;
  sourceMessageId: string;
  publicEventId: number;
}

export interface CanonicalHarnessPrefix {
  history: CanonicalHarnessMessage[];
  currentMessage: string;
  currentMessageId: string;
  capturedHighWater: number;
}

function isPublicMessageMetadata(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return true;
  const metadata = value as Record<string, unknown>;
  const visibility = metadata.visibility;
  const disclosure = metadata.disclosure_status;
  return (
    (visibility == null || visibility === "public") &&
    disclosure !== "withheld" &&
    disclosure !== "confirmation_required"
  );
}

export function isPublicArtifactMetadata(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return true;
  const accessState = (value as Record<string, unknown>).access_state;
  return accessState == null || accessState === "public";
}

export function formatCanonicalArtifactReference(input: {
  id: string;
  artifactType: string;
  name: string | null;
  artifactId: string | null;
}): string {
  const name = input.name?.trim() || "unnamed";
  const stableId = input.artifactId ?? input.id;
  return `[Public artifact reference] name=${name} type=${input.artifactType} artifact_id=${stableId}`;
}

/**
 * Hydrate the complete authorized public prefix captured at the triggering
 * message. The ledger provides order and invalidation; canonical message rows
 * provide content and are re-authorized on every read.
 */
export async function loadCanonicalHarnessPrefix(input: {
  tenantId: string;
  threadId: string;
  participantUserId: string;
  triggeringMessageId: string;
  capturedHighWater: number;
  actionCurrentMessage?: string | null;
  db?: ReturnType<typeof getDb>;
}): Promise<CanonicalHarnessPrefix> {
  const database = input.db ?? getDb();
  const [membership] = await database
    .select({ id: threadParticipants.id })
    .from(threadParticipants)
    .where(
      and(
        eq(threadParticipants.tenant_id, input.tenantId),
        eq(threadParticipants.thread_id, input.threadId),
        eq(threadParticipants.participant_type, "user"),
        eq(threadParticipants.user_id, input.participantUserId),
      ),
    )
    .limit(1);
  if (!membership) throw new Error("harness_participant_not_active");

  const events = await database
    .select({
      id: threadPublicEvents.id,
      sourceKind: threadPublicEvents.source_kind,
      sourceId: threadPublicEvents.source_id,
      eventKind: threadPublicEvents.event_kind,
    })
    .from(threadPublicEvents)
    .where(
      and(
        eq(threadPublicEvents.tenant_id, input.tenantId),
        eq(threadPublicEvents.thread_id, input.threadId),
        lte(threadPublicEvents.id, input.capturedHighWater),
      ),
    )
    .orderBy(asc(threadPublicEvents.id));

  const activeEvents = new Map<
    string,
    { id: number; sourceId: string; sourceKind: "message" | "message_artifact" }
  >();
  for (const event of events) {
    if (
      event.sourceKind !== "message" &&
      event.sourceKind !== "message_artifact"
    )
      continue;
    const key = `${event.sourceKind}:${event.sourceId}`;
    if (event.eventKind === "invalidate") {
      activeEvents.delete(key);
    } else {
      activeEvents.set(key, {
        id: event.id,
        sourceId: event.sourceId,
        sourceKind: event.sourceKind,
      });
    }
  }
  const orderedEvents = [...activeEvents.values()].sort(
    (left, right) => left.id - right.id,
  );
  if (orderedEvents.length === 0)
    throw new Error("harness_public_prefix_empty");
  const messageEventIds = orderedEvents
    .filter((event) => event.sourceKind === "message")
    .map((event) => event.sourceId);
  const artifactEventIds = orderedEvents
    .filter((event) => event.sourceKind === "message_artifact")
    .map((event) => event.sourceId);
  const rows =
    messageEventIds.length === 0
      ? []
      : await database
          .select({
            id: messages.id,
            role: messages.role,
            content: messages.content,
            senderId: messages.sender_id,
            metadata: messages.metadata,
          })
          .from(messages)
          .where(
            and(
              eq(messages.tenant_id, input.tenantId),
              eq(messages.thread_id, input.threadId),
              inArray(messages.id, messageEventIds),
            ),
          );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const artifactRows =
    artifactEventIds.length === 0
      ? []
      : await database
          .select({
            id: messageArtifacts.id,
            artifactType: messageArtifacts.artifact_type,
            name: messageArtifacts.name,
            artifactId: messageArtifacts.artifact_id,
            metadata: messageArtifacts.metadata,
          })
          .from(messageArtifacts)
          .where(
            and(
              eq(messageArtifacts.tenant_id, input.tenantId),
              eq(messageArtifacts.thread_id, input.threadId),
              inArray(messageArtifacts.id, artifactEventIds),
            ),
          );
  const artifactsById = new Map(artifactRows.map((row) => [row.id, row]));
  const canonical: CanonicalHarnessMessage[] = [];
  for (const event of orderedEvents) {
    if (event.sourceKind === "message_artifact") {
      const artifact = artifactsById.get(event.sourceId);
      if (!artifact || !isPublicArtifactMetadata(artifact.metadata)) {
        throw new Error(
          `harness_public_source_not_authorized:${event.sourceId}`,
        );
      }
      canonical.push({
        role: "assistant",
        content: formatCanonicalArtifactReference(artifact),
        sourceMessageId: artifact.id,
        publicEventId: event.id,
      });
      continue;
    }
    const row = byId.get(event.sourceId);
    if (
      !row ||
      (row.role !== "user" && row.role !== "assistant") ||
      !isPublicMessageMetadata(row.metadata) ||
      typeof row.content !== "string" ||
      !row.content.trim()
    ) {
      throw new Error(`harness_public_source_not_authorized:${event.sourceId}`);
    }
    const content =
      row.role === "user"
        ? `[Participant ${row.senderId?.slice(0, 8) ?? "unknown"}] ${row.content}`
        : row.content;
    canonical.push({
      role: row.role,
      content,
      sourceMessageId: row.id,
      publicEventId: event.id,
    });
  }

  const currentIndex = canonical.findIndex(
    (message) => message.sourceMessageId === input.triggeringMessageId,
  );
  if (currentIndex < 0) throw new Error("harness_trigger_not_in_public_prefix");
  if (input.actionCurrentMessage) {
    return {
      history: canonical,
      currentMessage: input.actionCurrentMessage,
      currentMessageId: input.triggeringMessageId,
      capturedHighWater: input.capturedHighWater,
    };
  }
  const current = byId.get(input.triggeringMessageId);
  if (
    !current ||
    current.role !== "user" ||
    current.senderId !== input.participantUserId
  ) {
    throw new Error("harness_trigger_participant_mismatch");
  }
  if (currentIndex !== canonical.length - 1) {
    throw new Error("harness_trigger_not_prefix_high_water");
  }

  return {
    history: canonical.slice(0, currentIndex),
    currentMessage: current.content ?? "",
    currentMessageId: current.id,
    capturedHighWater: input.capturedHighWater,
  };
}
