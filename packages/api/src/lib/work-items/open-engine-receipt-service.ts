import { GraphQLError } from "graphql";

import { and, db, eq, workItemEvents, workItems } from "../../graphql/utils.js";

export const OPEN_ENGINE_RECEIPT_TYPES = [
  "claimed",
  "progress",
  "blocked",
  "resumed",
  "failed",
  "completed",
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
  now?: Date;
}

export async function recordOpenEngineReceipt(
  input: RecordOpenEngineReceiptInput,
): Promise<OpenEngineWorkItemEvent> {
  const receiptType = normalizeReceiptType(input.receiptType);
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

    const stateUpdate = stateUpdateForReceipt(receiptType, input.message, now);
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
        }),
      })
      .returning();

    if (!event) {
      throw new GraphQLError("Open Engine receipt could not be recorded", {
        extensions: { code: "INTERNAL_SERVER_ERROR" },
      });
    }
    return event;
  });
}

function normalizeReceiptType(value: string): OpenEngineReceiptType {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
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
  now: Date,
) {
  if (receiptType === "blocked") {
    return {
      open_engine_human_hold: true,
      open_engine_human_hold_reason: optionalTrim(message),
      open_engine_claimed_by_agent_id: null,
      open_engine_claimed_at: null,
      open_engine_claim_expires_at: null,
      updated_at: now,
    };
  }
  if (receiptType === "resumed") {
    return {
      open_engine_human_hold: false,
      open_engine_human_hold_reason: null,
      updated_at: now,
    };
  }
  if (receiptType === "failed" || receiptType === "completed") {
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
