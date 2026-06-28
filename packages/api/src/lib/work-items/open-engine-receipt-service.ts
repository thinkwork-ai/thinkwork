import { GraphQLError } from "graphql";

import {
  and,
  db,
  eq,
  sql,
  workItemComments,
  workItemEvents,
  workItems,
} from "../../graphql/utils.js";

export const OPEN_ENGINE_RECEIPT_TYPES = [
  "claimed",
  "progress",
  "blocked",
  "unblocked",
  "human_hold",
  "human_answered",
  "resumed",
  "failed",
  "completed",
  "done",
  "applied",
  "skill_subscribed",
  "skill_installed",
  "skill_updated",
  "skill_declined",
  "follow_up",
  "status",
] as const;

export type OpenEngineReceiptType = (typeof OPEN_ENGINE_RECEIPT_TYPES)[number];
export type OpenEngineWorkItemEvent = typeof workItemEvents.$inferSelect;

export interface RecordOpenEngineReceiptInput {
  tenantId: string;
  workItemId: string;
  agentId: string;
  receiptType: OpenEngineReceiptType | string;
  threadId?: string | null;
  message?: string | null;
  evidence?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
  now?: Date;
}

export async function recordOpenEngineReceipt(
  input: RecordOpenEngineReceiptInput,
): Promise<OpenEngineWorkItemEvent> {
  const receiptType = normalizeOpenEngineReceiptType(input.receiptType);
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(workItems)
      .where(
        and(
          eq(workItems.tenant_id, input.tenantId),
          eq(workItems.id, input.workItemId),
        ),
      );
    if (!item) {
      throw new GraphQLError("Work item not found", {
        extensions: { code: "NOT_FOUND" },
      });
    }

    const idempotencyKey = optionalTrim(input.idempotencyKey);
    if (idempotencyKey) {
      const [existing] = await tx
        .select()
        .from(workItemEvents)
        .where(
          and(
            eq(workItemEvents.tenant_id, input.tenantId),
            eq(workItemEvents.work_item_id, input.workItemId),
            eq(workItemEvents.event_type, "agent_action"),
            eq(workItemEvents.actor_agent_id, input.agentId),
            sql`${workItemEvents.metadata}->>'idempotencyKey' = ${idempotencyKey}`,
          ),
        );
      if (existing) return existing;
    }

    const stateUpdate = stateUpdateForReceipt(
      receiptType,
      input.message,
      input.agentId,
      now,
    );
    if (stateUpdate) {
      await tx
        .update(workItems)
        .set(stateUpdate)
        .where(
          and(
            eq(workItems.tenant_id, input.tenantId),
            eq(workItems.id, input.workItemId),
          ),
        );
    }

    const [event] = await tx
      .insert(workItemEvents)
      .values({
        tenant_id: input.tenantId,
        space_id: item.space_id,
        work_item_id: input.workItemId,
        thread_id: input.threadId ?? null,
        actor_agent_id: input.agentId,
        event_type: "agent_action",
        message: input.message ?? defaultReceiptMessage(receiptType),
        metadata: compactObject({
          source: "open_engine",
          receiptType,
          evidence: input.evidence ?? undefined,
          ...input.metadata,
          idempotencyKey: idempotencyKey ?? undefined,
        }),
      })
      .returning();

    if (!event) {
      throw new GraphQLError("Open Engine receipt could not be recorded", {
        extensions: { code: "INTERNAL_SERVER_ERROR" },
      });
    }

    if (shouldMirrorReceiptAsComment(receiptType)) {
      await tx.insert(workItemComments).values({
        tenant_id: input.tenantId,
        space_id: item.space_id,
        work_item_id: input.workItemId,
        thread_id: input.threadId ?? null,
        author_agent_id: input.agentId,
        body: input.message ?? defaultReceiptMessage(receiptType),
        metadata: compactObject({
          source: "open_engine_receipt",
          receiptId: event.id,
          receiptType,
          evidence: input.evidence ?? undefined,
          idempotencyKey: idempotencyKey ?? undefined,
        }),
        updated_at: now,
      });
    }
    return event;
  });
}

export function normalizeOpenEngineReceiptType(
  value: string,
): OpenEngineReceiptType {
  let normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (normalized.startsWith("agent_")) {
    normalized = normalized.slice("agent_".length);
  }
  if (normalized === "done") return "done";
  if (normalized === "complete") return "completed";
  if (normalized === "human_holded") return "human_hold";
  if (normalized === "hold") return "human_hold";
  if (normalized === "answered") return "human_answered";
  if (normalized === "followup") return "follow_up";
  if ((OPEN_ENGINE_RECEIPT_TYPES as readonly string[]).includes(normalized)) {
    return normalized as OpenEngineReceiptType;
  }
  throw new GraphQLError(`Unsupported Open Engine receipt type: ${value}`, {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

function stateUpdateForReceipt(
  receiptType: OpenEngineReceiptType,
  message: string | null | undefined,
  agentId: string,
  now: Date,
) {
  if (receiptType === "blocked" || receiptType === "human_hold") {
    return {
      blocked: receiptType === "blocked",
      open_engine_human_hold: true,
      open_engine_human_hold_reason: optionalTrim(message),
      open_engine_claimed_by_agent_id: null,
      open_engine_claimed_at: null,
      open_engine_claim_expires_at: null,
      updated_at: now,
    };
  }
  if (
    receiptType === "unblocked" ||
    receiptType === "human_answered" ||
    receiptType === "resumed"
  ) {
    return {
      blocked: false,
      open_engine_human_hold: false,
      open_engine_human_hold_reason: null,
      updated_at: now,
    };
  }
  if (receiptType === "done" || receiptType === "completed") {
    return {
      completed_at: now,
      completed_by_agent_id: agentId,
      open_engine_claimed_by_agent_id: null,
      open_engine_claimed_at: null,
      open_engine_claim_expires_at: null,
      updated_at: now,
    };
  }
  if (receiptType === "applied") {
    return {
      blocked: false,
      open_engine_human_hold: false,
      open_engine_human_hold_reason: null,
      open_engine_dependency_state: "waiting",
      open_engine_claimed_by_agent_id: null,
      open_engine_claimed_at: null,
      open_engine_claim_expires_at: null,
      updated_at: now,
    };
  }
  if (receiptType === "failed") {
    return {
      open_engine_claimed_by_agent_id: null,
      open_engine_claimed_at: null,
      open_engine_claim_expires_at: null,
      updated_at: now,
    };
  }
  return {
    updated_at: now,
  };
}

function defaultReceiptMessage(receiptType: OpenEngineReceiptType) {
  return `Open Engine ${receiptType} receipt recorded.`;
}

function shouldMirrorReceiptAsComment(receiptType: OpenEngineReceiptType) {
  return ![
    "skill_subscribed",
    "skill_installed",
    "skill_updated",
    "skill_declined",
  ].includes(receiptType);
}

function optionalTrim(value: string | null | undefined) {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function compactObject(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  );
}
