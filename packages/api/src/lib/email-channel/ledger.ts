import { and, eq, sql } from "drizzle-orm";
import {
  emailLedgerEvents,
  emailProviderEvents,
} from "@thinkwork/database-pg/schema";
import type { Database } from "@thinkwork/database-pg";
import type { NormalizedProviderEvent } from "./provider-contract.js";

type LedgerDb = Pick<Database, "insert">;

/**
 * Identity of an outbound send for the audit trail. Shared by the gated
 * (approval) path and the fast path so both write the same row shape.
 */
export interface OutboundSendLedgerContext {
  db: LedgerDb;
  tenantId: string;
  conversationId?: string | null;
  spaceId?: string | null;
  threadId?: string | null;
  inboxItemId?: string | null;
  providerInstallId?: string | null;
  actorUserId?: string | null;
  subject: string;
  fromEmail: string;
  toEmails: string[];
  /** Where the send came from — "first_send_approval" | "approved_fast_path". */
  source: string;
}

function ledgerRowBase(ctx: OutboundSendLedgerContext) {
  return {
    tenant_id: ctx.tenantId,
    conversation_id: ctx.conversationId ?? null,
    space_id: ctx.spaceId ?? null,
    thread_id: ctx.threadId ?? null,
    inbox_item_id: ctx.inboxItemId ?? null,
    provider_install_id: ctx.providerInstallId ?? null,
    actor_user_id: ctx.actorUserId ?? null,
    subject: ctx.subject,
    from_email: ctx.fromEmail,
    to_emails: ctx.toEmails,
  };
}

/**
 * Wrap a provider send with the send_attempted → send_succeeded/send_failed
 * ledger trio. Every outbound send belongs in the audit trail, not just the
 * ones a human had to approve (THINK-600): sends that skip review through an
 * already-approved recipient set used to leave no evidence at all.
 */
export async function withSendLedger<
  T extends { provider?: string; providerMessageId?: string; status?: string },
>(ctx: OutboundSendLedgerContext, send: () => Promise<T>): Promise<T> {
  const base = ledgerRowBase(ctx);
  await ctx.db.insert(emailLedgerEvents).values({
    ...base,
    event_type: "send_attempted",
    metadata: { source: ctx.source },
  });
  try {
    const result = await send();
    await ctx.db.insert(emailLedgerEvents).values({
      ...base,
      event_type: "send_succeeded",
      provider_message_id: result?.providerMessageId ?? null,
      metadata: {
        source: ctx.source,
        provider: result?.provider ?? null,
        status: result?.status ?? null,
      },
    });
    return result;
  } catch (err) {
    await ctx.db.insert(emailLedgerEvents).values({
      ...base,
      event_type: "send_failed",
      reason_code: "provider_send_failed",
      metadata: {
        source: ctx.source,
        message: err instanceof Error ? err.message : "Unknown provider error",
      },
    });
    throw err;
  }
}

export interface RecordProviderEventInput {
  db: {
    insert: (table: unknown) => any;
    update: (table: unknown) => any;
    select: (fields?: unknown) => any;
  };
  tenantId: string;
  providerInstallId: string;
  event: NormalizedProviderEvent;
}

export async function recordProviderEvent(
  input: RecordProviderEventInput,
): Promise<{ recorded: boolean; ledgerEventId: string | null }> {
  const metadata = sanitizeProviderMetadata(input.event.metadata);
  const [providerEvent] = await input.db
    .insert(emailProviderEvents)
    .values({
      tenant_id: input.tenantId,
      provider_install_id: input.providerInstallId,
      provider_event_id: input.event.providerEventId,
      provider_message_id: input.event.providerMessageId,
      event_type: input.event.eventType,
      occurred_at: input.event.occurredAt,
      payload_metadata: metadata,
    })
    .onConflictDoNothing({
      target: [
        emailProviderEvents.provider_install_id,
        emailProviderEvents.provider_event_id,
      ],
    })
    .returning({ id: emailProviderEvents.id });

  if (!providerEvent) {
    const [existing] = await input.db
      .select({ ledgerEventId: emailProviderEvents.ledger_event_id })
      .from(emailProviderEvents)
      .where(
        and(
          eq(emailProviderEvents.provider_install_id, input.providerInstallId),
          eq(
            emailProviderEvents.provider_event_id,
            input.event.providerEventId,
          ),
        ),
      )
      .limit(1);
    return { recorded: false, ledgerEventId: existing?.ledgerEventId ?? null };
  }

  const [ledgerEvent] = await input.db
    .insert(emailLedgerEvents)
    .values({
      tenant_id: input.tenantId,
      provider_install_id: input.providerInstallId,
      event_type: "provider_event",
      provider_message_id: input.event.providerMessageId,
      provider_event_id: input.event.providerEventId,
      subject: input.event.inbound?.subject ?? null,
      from_email: input.event.inbound?.fromEmail ?? null,
      to_emails: input.event.inbound?.toEmails ?? [],
      reason_code: input.event.eventType,
      metadata: {
        provider: input.event.provider,
        eventType: input.event.eventType,
        occurredAt: input.event.occurredAt?.toISOString() ?? null,
        ...metadata,
      },
      created_at: input.event.occurredAt ?? sql`now()`,
    })
    .returning({ id: emailLedgerEvents.id });

  await input.db
    .update(emailProviderEvents)
    .set({ ledger_event_id: ledgerEvent?.id ?? null })
    .where(eq(emailProviderEvents.id, providerEvent.id));

  return { recorded: true, ledgerEventId: ledgerEvent?.id ?? null };
}

export function sanitizeProviderMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const serialized = JSON.stringify(metadata, (_key, value) => {
    if (typeof value === "string" && value.length > 2048) {
      return `${value.slice(0, 2048)}...[truncated]`;
    }
    return value;
  });
  const parsed = JSON.parse(serialized) as unknown;
  return isRecord(parsed) ? parsed : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
