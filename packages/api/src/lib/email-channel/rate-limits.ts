import { and, eq, gte, sql } from "drizzle-orm";
import { emailLedgerEvents } from "@thinkwork/database-pg/schema";

export type EmailInboundRateLimitScope = "tenant" | "space" | "sender";

export interface EmailInboundRateLimitResult {
  allowed: boolean;
  scope?: EmailInboundRateLimitScope;
  count?: number;
  limit?: number;
}

export async function checkInboundEmailRateLimits(input: {
  db: {
    select: (fields?: unknown) => any;
  };
  tenantId: string;
  spaceId: string;
  senderEmail: string;
  now?: Date;
}): Promise<EmailInboundRateLimitResult> {
  const now = input.now ?? new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const checks: Array<{
    scope: EmailInboundRateLimitScope;
    limit: number;
    where: unknown;
  }> = [
    {
      scope: "tenant",
      limit: 200,
      where: and(
        eq(emailLedgerEvents.tenant_id, input.tenantId),
        eq(emailLedgerEvents.event_type, "inbound_authorized"),
        gte(emailLedgerEvents.created_at, oneHourAgo),
      ),
    },
    {
      scope: "space",
      limit: 50,
      where: and(
        eq(emailLedgerEvents.tenant_id, input.tenantId),
        eq(emailLedgerEvents.space_id, input.spaceId),
        eq(emailLedgerEvents.event_type, "inbound_authorized"),
        gte(emailLedgerEvents.created_at, oneHourAgo),
      ),
    },
    {
      scope: "sender",
      limit: 20,
      where: and(
        eq(emailLedgerEvents.tenant_id, input.tenantId),
        eq(emailLedgerEvents.space_id, input.spaceId),
        eq(emailLedgerEvents.from_email, input.senderEmail),
        eq(emailLedgerEvents.event_type, "inbound_authorized"),
        gte(emailLedgerEvents.created_at, oneHourAgo),
      ),
    },
  ];

  for (const check of checks) {
    const [row] = await input.db
      .select({ count: sql<number>`count(*)::int` })
      .from(emailLedgerEvents)
      .where(check.where);
    const count = row?.count ?? 0;
    if (count >= check.limit) {
      return {
        allowed: false,
        scope: check.scope,
        count,
        limit: check.limit,
      };
    }
  }

  return { allowed: true };
}
