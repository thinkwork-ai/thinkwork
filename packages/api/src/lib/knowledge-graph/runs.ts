import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  knowledgeGraphIngestRuns,
  messages,
} from "@thinkwork/database-pg/schema";
import type { Database } from "../db.js";
import type { KnowledgeGraphIngestRunRow } from "../../graphql/resolvers/knowledge-graph/mappers.js";

export interface CreateKnowledgeGraphThreadIngestRunArgs {
  db: Database;
  tenantId: string;
  threadId: string;
  requestedByUserId: string | null;
  force?: boolean | null;
  metadata?: string | Record<string, unknown> | null;
}

export interface CreateKnowledgeGraphThreadIngestRunResult {
  run: KnowledgeGraphIngestRunRow;
  inserted: boolean;
}

export class KnowledgeGraphRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeGraphRunError";
  }
}

export async function createKnowledgeGraphThreadIngestRun(
  args: CreateKnowledgeGraphThreadIngestRunArgs,
): Promise<CreateKnowledgeGraphThreadIngestRunResult> {
  const messageCount = await countThreadMessages(args);
  if (messageCount <= 0) {
    throw new KnowledgeGraphRunError(
      "Knowledge Graph ingest requires at least one thread message",
    );
  }

  const runId = randomUUID();
  const [inserted] = await args.db
    .insert(knowledgeGraphIngestRuns)
    .values({
      id: runId,
      tenant_id: args.tenantId,
      thread_id: args.threadId,
      requested_by_user_id: args.requestedByUserId,
      status: "queued",
      trigger: "manual",
      cognee_dataset_name: buildCogneeDatasetName(
        args.tenantId,
        args.threadId,
        runId,
      ),
      message_count: messageCount,
      input: {
        force: args.force === true,
        source: "thread",
        threadId: args.threadId,
      },
      metadata: normalizeMetadata(args.metadata),
    })
    .onConflictDoNothing({
      target: [
        knowledgeGraphIngestRuns.tenant_id,
        knowledgeGraphIngestRuns.thread_id,
      ],
      where: sql`status IN ('queued','running')`,
    })
    .returning();

  if (inserted) {
    return { run: inserted as KnowledgeGraphIngestRunRow, inserted: true };
  }

  const [existing] = await args.db
    .select()
    .from(knowledgeGraphIngestRuns)
    .where(
      and(
        eq(knowledgeGraphIngestRuns.tenant_id, args.tenantId),
        eq(knowledgeGraphIngestRuns.thread_id, args.threadId),
        sql`${knowledgeGraphIngestRuns.status} IN ('queued','running')`,
      ),
    )
    .orderBy(knowledgeGraphIngestRuns.created_at)
    .limit(1);

  if (!existing) {
    throw new KnowledgeGraphRunError(
      "Knowledge Graph ingest start raced with an active-run conflict",
    );
  }

  return { run: existing as KnowledgeGraphIngestRunRow, inserted: false };
}

export async function markKnowledgeGraphRunInvokeFailed(args: {
  db: Database;
  runId: string;
  error: string;
}): Promise<KnowledgeGraphIngestRunRow | null> {
  const [row] = await args.db
    .update(knowledgeGraphIngestRuns)
    .set({
      status: "failed",
      finished_at: new Date(),
      error: args.error.slice(0, 4000),
      updated_at: new Date(),
    })
    .where(eq(knowledgeGraphIngestRuns.id, args.runId))
    .returning();
  return (row as KnowledgeGraphIngestRunRow | undefined) ?? null;
}

export function buildCogneeDatasetName(
  tenantId: string,
  threadId: string,
  runId?: string | null,
): string {
  const base = `thinkwork:${tenantId}:thread:${threadId}`;
  return runId ? `${base}:run:${runId}` : base;
}

async function countThreadMessages(
  args: Pick<
    CreateKnowledgeGraphThreadIngestRunArgs,
    "db" | "tenantId" | "threadId"
  >,
): Promise<number> {
  const [row] = await args.db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.tenant_id, args.tenantId),
        eq(messages.thread_id, args.threadId),
      ),
    );
  return Number(row?.count ?? 0);
}

function normalizeMetadata(
  value: string | Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!value) return {};
  if (typeof value !== "string") return value;
  if (!value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new KnowledgeGraphRunError("metadata must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof KnowledgeGraphRunError) throw err;
    throw new KnowledgeGraphRunError("metadata must be valid JSON");
  }
}
