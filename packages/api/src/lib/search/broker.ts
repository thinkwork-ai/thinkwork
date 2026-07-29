/**
 * THINK-263 KTD-1 — the search broker: a lib-level fan-out over each source's
 * existing fast retrieval path. Legs are provider contracts (read-only
 * traversal-gates pattern): the broker calls leg lib functions directly,
 * never resolver-to-resolver.
 *
 * Concurrency: Promise.allSettled with a per-leg timeout wrapper so a slow
 * leg degrades to `timeout` status for its own rail and never blocks the
 * others. The GraphQL query and the Pi agent tool both call this module.
 *
 * Scoping: the thread leg composes the FTS predicate with the caller's
 * thread-access predicate AND the hidden-thread filter — the bare
 * threadSearchPredicate carries neither, and this is a new read path that
 * inherits neither. The memory leg reads the caller's own bank (KTD-2) and
 * excludes hits whose stamped source thread the caller cannot open; hits
 * with no stamped threadId are included (own-bank content, nothing to
 * check).
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { searchQueries, threads } from "@thinkwork/database-pg/schema";
import { randomUUID } from "node:crypto";

import { getMemoryServices } from "../memory/index.js";
import { threadSearchPredicate } from "../../graphql/resolvers/threads/search.js";
import { callerVisibleThreadPredicate } from "../../graphql/resolvers/threads/access.js";
import { visibleThreadListPredicate } from "../../graphql/resolvers/threads/system-hidden.js";

export type SearchSource = "THREADS" | "MEMORY";
export type SearchLegStatus = "OK" | "TIMEOUT" | "ERROR";

export type SearchBrokerArgs = {
  tenantId: string;
  /**
   * Caller's user id for permission scoping. Null only for service-secret
   * callers, which bypass per-user thread visibility at their own boundary
   * (mirrors threadsPaged's authType handling).
   */
  callerUserId: string | null;
  query: string;
  sources: SearchSource[];
  limit: number;
  /** Shared id across the parallel per-rail calls of one palette query. */
  queryId?: string | null;
  /** Set by ask/research callers so telemetry records the escalation. */
  escalated?: boolean;
  /** Per-leg timeout override, primarily for tests. */
  timeoutMs?: Partial<Record<SearchSource, number>>;
};

export type SearchLegResult = {
  source: SearchSource;
  status: SearchLegStatus;
  error?: string;
  threadHits?: Array<{
    id: string;
    title: string | null;
    identifier: string | null;
    spaceId: string | null;
    updatedAt: string | null;
  }>;
  memoryHits?: Array<{
    memoryRecordId: string;
    text: string;
    score: number | null;
    threadId: string | null;
    createdAt: string | null;
  }>;
};

export type SearchBrokerResult = {
  queryId: string;
  legs: SearchLegResult[];
};

// FTS legs answer in tens of milliseconds; their budget only bounds the
// pathological case. The memory leg rides the memory engine (30s transport ceiling)
// and gets a wider allowance because its callers (ask/research) are not
// keystroke-bound.
const DEFAULT_TIMEOUT_MS: Record<SearchSource, number> = {
  THREADS: 2_000,
  MEMORY: 12_000,
};

class LegTimeoutError extends Error {
  constructor(source: SearchSource, ms: number) {
    super(`search leg ${source} timed out after ${ms}ms`);
  }
}

async function withLegTimeout<T>(
  source: SearchSource,
  ms: number,
  work: Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new LegTimeoutError(source, ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function searchBroker(
  args: SearchBrokerArgs,
): Promise<SearchBrokerResult> {
  const started = Date.now();
  const query = args.query.trim();
  const queryId = args.queryId || randomUUID();
  const limit = Math.max(1, Math.min(args.limit, 50));
  const sources =
    args.sources.length > 0
      ? args.sources
      : (["THREADS", "ENTITIES"] as SearchSource[]);

  if (query.length === 0) {
    return { queryId, legs: [] };
  }

  const legWork = sources.map(async (source): Promise<SearchLegResult> => {
    const budget = args.timeoutMs?.[source] ?? DEFAULT_TIMEOUT_MS[source];
    try {
      const leg = await withLegTimeout(
        source,
        budget,
        runLeg(source, args, query, limit),
      );
      return leg;
    } catch (err) {
      if (err instanceof LegTimeoutError) {
        return { source, status: "TIMEOUT" };
      }
      return {
        source,
        status: "ERROR",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  const settled = await Promise.allSettled(legWork);
  const legs = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : ({
          source: sources[i],
          status: "ERROR",
          error: String(s.reason),
        } as SearchLegResult),
  );

  // Telemetry is fire-and-forget: the sensor never fails the search.
  void recordSearchQuery({
    args,
    queryId,
    query,
    sources,
    legs,
    durationMs: Date.now() - started,
  }).catch((err) => {
    console.warn(
      `[search-broker] telemetry write failed (non-fatal): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  });

  return { queryId, legs };
}

async function runLeg(
  source: SearchSource,
  args: SearchBrokerArgs,
  query: string,
  limit: number,
): Promise<SearchLegResult> {
  switch (source) {
    case "THREADS":
      return runThreadsLeg(args, query, limit);
    case "MEMORY":
      return runMemoryLeg(args, query, limit);
  }
}

async function runThreadsLeg(
  args: SearchBrokerArgs,
  query: string,
  limit: number,
): Promise<SearchLegResult> {
  const conditions = [
    eq(threads.tenant_id, args.tenantId),
    threadSearchPredicate(query),
    visibleThreadListPredicate(),
    sql`${threads.archived_at} IS NULL`,
  ];
  if (args.callerUserId) {
    conditions.push(
      callerVisibleThreadPredicate(args.tenantId, args.callerUserId),
    );
  }
  const rows = await getDb()
    .select({
      id: threads.id,
      title: threads.title,
      identifier: threads.identifier,
      space_id: threads.space_id,
      updated_at: threads.updated_at,
    })
    .from(threads)
    .where(and(...conditions))
    .orderBy(desc(threads.updated_at))
    .limit(limit);
  return {
    source: "THREADS",
    status: "OK",
    threadHits: rows.map((r) => ({
      id: r.id,
      title: r.title ?? null,
      identifier: r.identifier ?? null,
      spaceId: r.space_id ?? null,
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    })),
  };
}

async function runMemoryLeg(
  args: SearchBrokerArgs,
  query: string,
  limit: number,
): Promise<SearchLegResult> {
  if (!args.callerUserId) {
    // Memory banks are per-user; a service caller has no bank to read.
    return { source: "MEMORY", status: "OK", memoryHits: [] };
  }
  const { recall: recallService } = getMemoryServices();
  const hits = await recallService.recall({
    tenantId: args.tenantId,
    ownerType: "user",
    ownerId: args.callerUserId,
    query,
    limit,
    requestContext: {
      contextClass: "memory_search",
      requesterUserId: args.callerUserId,
      sourceSurface: "search.broker",
    },
  });

  const mapped = hits.map((h) => ({
    memoryRecordId: h.record.id,
    text: h.record.content.text,
    score: typeof h.score === "number" ? h.score : null,
    threadId: (h.record.threadId as string | undefined) ?? null,
    createdAt: h.record.createdAt ?? null,
  }));

  // R3 — exclude hits whose stamped source thread the caller cannot open.
  // Hits with no stamped threadId are own-bank content with nothing to check.
  const threadIds = Array.from(
    new Set(mapped.map((m) => m.threadId).filter((t): t is string => !!t)),
  );
  let accessible = new Set(threadIds);
  if (threadIds.length > 0) {
    const rows = await getDb()
      .select({ id: threads.id })
      .from(threads)
      .where(
        and(
          eq(threads.tenant_id, args.tenantId),
          inArray(threads.id, threadIds),
          callerVisibleThreadPredicate(args.tenantId, args.callerUserId),
        ),
      );
    accessible = new Set(rows.map((r) => r.id));
    // A stamped threadId that no longer resolves to a thread row is treated
    // as inaccessible-for-any-reason (KTD-7's two-state model).
  }

  return {
    source: "MEMORY",
    status: "OK",
    memoryHits: mapped
      .filter((m) => !m.threadId || accessible.has(m.threadId))
      .slice(0, limit),
  };
}

async function recordSearchQuery(input: {
  args: SearchBrokerArgs;
  queryId: string;
  query: string;
  sources: SearchSource[];
  legs: SearchLegResult[];
  durationMs: number;
}): Promise<void> {
  const hitCount = (leg: SearchLegResult) =>
    leg.threadHits?.length ?? leg.memoryHits?.length ?? 0;
  const legHitCounts: Record<string, number> = {};
  const legStatuses: Record<string, string> = {};
  let total = 0;
  for (const leg of input.legs) {
    legHitCounts[leg.source] = hitCount(leg);
    legStatuses[leg.source] = leg.status;
    total += legHitCounts[leg.source];
  }
  await getDb()
    .insert(searchQueries)
    .values({
      tenant_id: input.args.tenantId,
      user_id: input.args.callerUserId,
      query_id: input.queryId,
      query_text: input.query,
      sources: input.sources,
      leg_hit_counts: legHitCounts,
      leg_statuses: legStatuses,
      total_hits: total,
      escalated: input.args.escalated ?? false,
      duration_ms: input.durationMs,
    });
}
