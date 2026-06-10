import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import {
  type KnowledgeGraphSourceKind,
  knowledgeGraphIngestRuns,
  tenantEntityPages,
  messages,
  wikiPages,
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

export interface CreateKnowledgeGraphIngestRunArgs {
  db: Database;
  tenantId: string;
  sourceKind: KnowledgeGraphSourceKind;
  threadId?: string | null;
  sourceRef?: string | null;
  sourceLabel?: string | null;
  ownerUserId?: string | null;
  pageIds?: string[] | null;
  requestedByUserId: string | null;
  force?: boolean | null;
  metadata?: string | Record<string, unknown> | null;
}

export interface CreateKnowledgeGraphThreadIngestRunResult {
  run: KnowledgeGraphIngestRunRow;
  inserted: boolean;
}

export interface CreateKnowledgeGraphObservationsIngestRunArgs {
  db: Database;
  tenantId: string;
  requestedByUserId: string | null;
  trigger?: "manual" | "scheduled" | null;
  fullRebuild?: boolean | null;
  metadata?: string | Record<string, unknown> | null;
}

export class KnowledgeGraphRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeGraphRunError";
  }
}

export const OBSERVATIONS_SOURCE_LABEL = "Hindsight observations";

/** Stable per-tenant identities — one observations dataset/run-ref per tenant. */
export function buildObservationsSourceRef(tenantId: string): string {
  return `tenant:${tenantId}:observations`;
}

export function buildObservationsDatasetName(tenantId: string): string {
  return `thinkwork:${tenantId}:observations`;
}

const DEFAULT_OBSERVATIONS_RUN_CEILING_MINUTES = 20;

export function observationsRunCeilingMinutes(): number {
  const raw = process.env.KG_OBS_RUN_CEILING_MINUTES;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_OBSERVATIONS_RUN_CEILING_MINUTES;
}

/**
 * Fail observation runs stranded in queued/running past the run ceiling.
 * The stable source_ref makes the active-run dedupe index a permanent lock
 * if a worker dies mid-run — without this, one stranded row blocks every
 * future observations run for the tenant forever.
 */
export async function reapStaleObservationIngestRuns(args: {
  db: Database;
  tenantId?: string | null;
  ceilingMinutes?: number;
}): Promise<number> {
  const ceilingMinutes = args.ceilingMinutes ?? observationsRunCeilingMinutes();
  const cutoff = new Date(Date.now() - ceilingMinutes * 60_000);
  const now = new Date();
  const predicates = [
    eq(knowledgeGraphIngestRuns.source_kind, "observations"),
    sql`${knowledgeGraphIngestRuns.status} IN ('queued','running')`,
    lt(knowledgeGraphIngestRuns.created_at, cutoff),
  ];
  if (args.tenantId) {
    predicates.push(eq(knowledgeGraphIngestRuns.tenant_id, args.tenantId));
  }
  const reaped = await args.db
    .update(knowledgeGraphIngestRuns)
    .set({
      status: "failed",
      finished_at: now,
      error: "reaped: exceeded run ceiling",
      updated_at: now,
    })
    .where(and(...predicates))
    .returning({ id: knowledgeGraphIngestRuns.id });
  return reaped.length;
}

/**
 * Claim an observations ingest run for the tenant. Unlike per-thread runs
 * there is no eligible-source precheck — an empty incremental read finishes
 * as `stale_noop` in the worker rather than refusing to start.
 */
export async function createKnowledgeGraphObservationsIngestRun(
  args: CreateKnowledgeGraphObservationsIngestRunArgs,
): Promise<CreateKnowledgeGraphThreadIngestRunResult> {
  await reapStaleObservationIngestRuns({
    db: args.db,
    tenantId: args.tenantId,
  });

  const sourceRef = buildObservationsSourceRef(args.tenantId);
  const [inserted] = await args.db
    .insert(knowledgeGraphIngestRuns)
    .values({
      id: randomUUID(),
      tenant_id: args.tenantId,
      thread_id: null,
      source_kind: "observations",
      source_ref: sourceRef,
      source_label: OBSERVATIONS_SOURCE_LABEL,
      requested_by_user_id: args.requestedByUserId,
      status: "queued",
      trigger: args.trigger ?? "manual",
      cognee_dataset_name: buildObservationsDatasetName(args.tenantId),
      message_count: 0,
      input: {
        source: "observations",
        sourceKind: "observations",
        sourceRef,
        fullRebuild: args.fullRebuild === true,
      },
      metadata: normalizeMetadata(args.metadata),
    })
    .onConflictDoNothing({
      target: [
        knowledgeGraphIngestRuns.tenant_id,
        knowledgeGraphIngestRuns.source_kind,
        knowledgeGraphIngestRuns.source_ref,
      ],
      where: sql`status IN ('queued','running')`,
    })
    .returning();

  if (inserted) {
    return { run: inserted as KnowledgeGraphIngestRunRow, inserted: true };
  }

  const existing = await loadActiveRun(
    args.db,
    args.tenantId,
    "observations",
    sourceRef,
  );
  if (!existing) {
    throw new KnowledgeGraphRunError(
      "Knowledge Graph observations ingest start raced with an active-run conflict",
    );
  }
  return { run: existing, inserted: false };
}

export async function createKnowledgeGraphThreadIngestRun(
  args: CreateKnowledgeGraphThreadIngestRunArgs,
): Promise<CreateKnowledgeGraphThreadIngestRunResult> {
  return createKnowledgeGraphIngestRun({
    ...args,
    sourceKind: "thread",
    sourceRef: args.threadId,
  });
}

export async function createKnowledgeGraphIngestRun(
  args: CreateKnowledgeGraphIngestRunArgs,
): Promise<CreateKnowledgeGraphThreadIngestRunResult> {
  const source = await resolveSourceScope(args);
  if (source.sourceKind === "thread" && !source.threadId) {
    throw new KnowledgeGraphRunError("threadId is required for thread ingest");
  }

  const sourceCount = await countSourceItems({ ...args, source });
  if (sourceCount <= 0) {
    throw new KnowledgeGraphRunError(
      source.sourceKind === "thread"
        ? "Knowledge Graph ingest requires at least one thread message"
        : `Knowledge Graph ${source.sourceKind} ingest found no eligible source pages`,
    );
  }

  const messageCount = await countThreadMessages(args);
  const runId = randomUUID();
  const [inserted] = await args.db
    .insert(knowledgeGraphIngestRuns)
    .values({
      id: runId,
      tenant_id: args.tenantId,
      thread_id: source.threadId,
      source_kind: source.sourceKind,
      source_ref: source.sourceRef,
      source_label: source.sourceLabel,
      requested_by_user_id: args.requestedByUserId,
      status: "queued",
      trigger: "manual",
      cognee_dataset_name: buildCogneeDatasetName(
        args.tenantId,
        source.sourceKind,
        source.sourceRef,
        runId,
      ),
      message_count: source.sourceKind === "thread" ? messageCount : 0,
      input: {
        force: args.force === true,
        source: source.sourceKind,
        sourceKind: source.sourceKind,
        sourceRef: source.sourceRef,
        sourceLabel: source.sourceLabel,
        threadId: source.threadId,
        ownerUserId: source.ownerUserId,
        pageIds: source.pageIds,
        sourceCount,
      },
      metadata: normalizeMetadata(args.metadata),
    })
    .onConflictDoNothing({
      target: [
        knowledgeGraphIngestRuns.tenant_id,
        knowledgeGraphIngestRuns.source_kind,
        knowledgeGraphIngestRuns.source_ref,
      ],
      where: sql`status IN ('queued','running')`,
    })
    .returning();

  if (inserted) {
    return { run: inserted as KnowledgeGraphIngestRunRow, inserted: true };
  }

  const existing = await loadActiveRun(
    args.db,
    args.tenantId,
    source.sourceKind,
    source.sourceRef,
  );
  if (!existing) {
    throw new KnowledgeGraphRunError(
      "Knowledge Graph ingest start raced with an active-run conflict",
    );
  }

  return { run: existing, inserted: false };
}

async function loadActiveRun(
  db: Database,
  tenantId: string,
  sourceKind: KnowledgeGraphSourceKind,
  sourceRef: string,
): Promise<KnowledgeGraphIngestRunRow | null> {
  const [existing] = await db
    .select()
    .from(knowledgeGraphIngestRuns)
    .where(
      and(
        eq(knowledgeGraphIngestRuns.tenant_id, tenantId),
        eq(knowledgeGraphIngestRuns.source_kind, sourceKind),
        eq(knowledgeGraphIngestRuns.source_ref, sourceRef),
        sql`${knowledgeGraphIngestRuns.status} IN ('queued','running')`,
      ),
    )
    .orderBy(knowledgeGraphIngestRuns.created_at)
    .limit(1);
  return (existing as KnowledgeGraphIngestRunRow | undefined) ?? null;
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
  sourceKind: KnowledgeGraphSourceKind,
  sourceRef: string,
  runId?: string | null,
): string {
  const safeSourceRef = sourceRef.replace(/[^a-zA-Z0-9:_-]+/g, "_");
  const base = `thinkwork:${tenantId}:${sourceKind}:${safeSourceRef}`;
  return runId ? `${base}:run:${runId}` : base;
}

async function countThreadMessages(
  args: Pick<CreateKnowledgeGraphIngestRunArgs, "db" | "tenantId"> & {
    threadId?: string | null;
  },
): Promise<number> {
  if (!args.threadId) return 0;
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

interface ResolvedSourceScope {
  sourceKind: KnowledgeGraphSourceKind;
  threadId: string | null;
  sourceRef: string;
  sourceLabel: string | null;
  ownerUserId: string | null;
  pageIds: string[];
}

async function resolveSourceScope(
  args: CreateKnowledgeGraphIngestRunArgs,
): Promise<ResolvedSourceScope> {
  const pageIds = [...new Set(args.pageIds ?? [])].filter(Boolean).sort();
  if (args.sourceKind === "thread") {
    const threadId = args.threadId ?? args.sourceRef;
    if (!threadId) {
      throw new KnowledgeGraphRunError(
        "threadId is required for thread ingest",
      );
    }
    return {
      sourceKind: "thread",
      threadId,
      sourceRef: threadId,
      sourceLabel: args.sourceLabel ?? null,
      ownerUserId: null,
      pageIds: [],
    };
  }

  if (args.sourceKind === "wiki") {
    if (!args.ownerUserId) {
      throw new KnowledgeGraphRunError(
        "ownerUserId is required for wiki ingest",
      );
    }
    return {
      sourceKind: "wiki",
      threadId: null,
      sourceRef:
        args.sourceRef ??
        (pageIds.length
          ? `owner:${args.ownerUserId}:pages:${pageIds.join(",")}`
          : `owner:${args.ownerUserId}:recent`),
      sourceLabel: args.sourceLabel ?? "Compounding Memory wiki",
      ownerUserId: args.ownerUserId,
      pageIds,
    };
  }

  return {
    sourceKind: "brain",
    threadId: null,
    sourceRef:
      args.sourceRef ??
      (pageIds.length ? `pages:${pageIds.join(",")}` : "tenant:recent"),
    sourceLabel: args.sourceLabel ?? "Company Brain",
    ownerUserId: null,
    pageIds,
  };
}

async function countSourceItems(args: {
  db: Database;
  tenantId: string;
  source: ResolvedSourceScope;
}): Promise<number> {
  if (args.source.sourceKind === "thread") {
    return countThreadMessages({
      db: args.db,
      tenantId: args.tenantId,
      threadId: args.source.threadId,
    });
  }
  if (args.source.sourceKind === "wiki") {
    const [row] = await args.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(wikiPages)
      .where(
        and(
          eq(wikiPages.tenant_id, args.tenantId),
          eq(wikiPages.owner_id, args.source.ownerUserId!),
          eq(wikiPages.status, "active"),
          args.source.pageIds.length
            ? inArray(wikiPages.id, args.source.pageIds)
            : sql`true`,
        ),
      );
    return Number(row?.count ?? 0);
  }
  const [row] = await args.db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(tenantEntityPages)
    .where(
      and(
        eq(tenantEntityPages.tenant_id, args.tenantId),
        eq(tenantEntityPages.status, "active"),
        args.source.pageIds.length
          ? inArray(tenantEntityPages.id, args.source.pageIds)
          : sql`true`,
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
