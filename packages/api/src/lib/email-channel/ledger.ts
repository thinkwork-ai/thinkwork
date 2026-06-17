import { and, eq, sql } from "drizzle-orm";
import {
  emailLedgerEvents,
  emailProviderEvents,
} from "@thinkwork/database-pg/schema";
import type { NormalizedProviderEvent } from "./provider-contract.js";

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
