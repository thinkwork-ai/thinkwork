import { and, eq, sql } from "drizzle-orm";
import { db as defaultDb } from "./db.js";
import { schema } from "@thinkwork/database-pg";

const { threadTurns, threadTurnEvents } = schema;

const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;

type DrizzleEventDatabase = {
  execute: (...args: any[]) => Promise<any>;
  select: any;
  insert: any;
};

export interface ThreadTurnEventInput {
  tenantId: string;
  runId: string;
  agentId?: string | null;
  eventType: string;
  message: string;
  payload?: unknown;
  stream?: string;
  level?: string;
  color?: string;
}

export interface ThreadTurnEventRow {
  id: string | number;
  seq: number;
}

export interface ThreadTurnEventStore {
  lockThreadTurn(input: { tenantId: string; runId: string }): Promise<boolean>;
  loadMaxSeq(input: { tenantId: string; runId: string }): Promise<number>;
  insertEvent(
    input: ThreadTurnEventInput & { seq: number },
  ): Promise<ThreadTurnEventRow>;
}

export class ThreadTurnEventError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ThreadTurnEventError";
  }
}

export function assertThreadTurnEventPayloadSize(
  payload: unknown,
  maxBytes = DEFAULT_MAX_PAYLOAD_BYTES,
): void {
  const bytes = Buffer.byteLength(JSON.stringify(payload ?? null), "utf8");
  if (bytes > maxBytes) {
    throw new ThreadTurnEventError(
      `thread turn event payload exceeds ${maxBytes} bytes`,
      "PAYLOAD_TOO_LARGE",
    );
  }
}

export function nextThreadTurnEventSeq(maxSeq: number): number {
  if (!Number.isFinite(maxSeq) || maxSeq < 0) return 0;
  return Math.trunc(maxSeq) + 1;
}

export async function appendThreadTurnEvent(
  store: ThreadTurnEventStore,
  input: ThreadTurnEventInput,
): Promise<ThreadTurnEventRow> {
  assertThreadTurnEventPayloadSize(input.payload);

  const locked = await store.lockThreadTurn({
    tenantId: input.tenantId,
    runId: input.runId,
  });
  if (!locked) {
    throw new ThreadTurnEventError("thread turn not found", "TURN_NOT_FOUND");
  }

  const maxSeq = await store.loadMaxSeq({
    tenantId: input.tenantId,
    runId: input.runId,
  });
  return store.insertEvent({
    ...input,
    seq: nextThreadTurnEventSeq(maxSeq),
  });
}

export function drizzleThreadTurnEventStore(
  database: DrizzleEventDatabase = defaultDb,
): ThreadTurnEventStore {
  return {
    async lockThreadTurn(input) {
      const result = await database.execute(
        sql`SELECT 1 FROM ${threadTurns} WHERE ${threadTurns.id} = ${input.runId} AND ${threadTurns.tenant_id} = ${input.tenantId} FOR UPDATE`,
      );
      return Array.isArray(result)
        ? result.length > 0
        : ((result as { rows?: unknown[] }).rows?.length ?? 0) > 0;
    },
    async loadMaxSeq(input) {
      const [row] = await database
        .select({
          maxSeq: sql<number>`COALESCE(MAX(${threadTurnEvents.seq}), -1)::int`,
        })
        .from(threadTurnEvents)
        .where(
          and(
            eq(threadTurnEvents.tenant_id, input.tenantId),
            eq(threadTurnEvents.run_id, input.runId),
          ),
        );
      return Number(row?.maxSeq ?? -1);
    },
    async insertEvent(input) {
      const [row] = await database
        .insert(threadTurnEvents)
        .values({
          tenant_id: input.tenantId,
          run_id: input.runId,
          agent_id: input.agentId ?? null,
          seq: input.seq,
          event_type: input.eventType,
          stream: input.stream ?? "activity",
          level: input.level ?? "info",
          color: input.color ?? "blue",
          message: input.message,
          payload: input.payload ?? null,
        })
        .returning({ id: threadTurnEvents.id, seq: threadTurnEvents.seq });
      return row;
    },
  };
}
