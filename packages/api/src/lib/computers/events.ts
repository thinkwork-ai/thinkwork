import { and, desc, eq } from "drizzle-orm";
import { GraphQLError } from "graphql";
import { getDb } from "@thinkwork/database-pg";
import { computers, computerEvents } from "@thinkwork/database-pg/schema";

const db = getDb();
const DEFAULT_EVENT_LIMIT = 25;
const MAX_EVENT_LIMIT = 100;

export async function listComputerEvents(input: {
  tenantId: string;
  computerId: string;
  limit?: number | null;
}) {
  await requireComputer(input.tenantId, input.computerId);

  const rows = await db
    .select()
    .from(computerEvents)
    .where(
      and(
        eq(computerEvents.tenant_id, input.tenantId),
        eq(computerEvents.computer_id, input.computerId),
      ),
    )
    .orderBy(desc(computerEvents.created_at))
    .limit(normalizeComputerEventLimit(input.limit));

  return rows.map((row) => toGraphqlComputerEvent(row));
}

export function normalizeComputerEventLimit(limit?: number | null): number {
  if (limit === undefined || limit === null) return DEFAULT_EVENT_LIMIT;
  if (!Number.isFinite(limit)) return DEFAULT_EVENT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_EVENT_LIMIT);
}

export function toGraphqlComputerEvent(row: Record<string, any>) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    computerId: row.computer_id,
    taskId: row.task_id ?? null,
    eventType: row.event_type,
    level: String(row.level ?? "info").toUpperCase(),
    payload: row.payload ?? null,
    createdAt: row.created_at,
  };
}

async function requireComputer(tenantId: string, computerId: string) {
  const [computer] = await db
    .select({ id: computers.id })
    .from(computers)
    .where(and(eq(computers.tenant_id, tenantId), eq(computers.id, computerId)))
    .limit(1);
  if (!computer) {
    throw new GraphQLError("Computer not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
}
