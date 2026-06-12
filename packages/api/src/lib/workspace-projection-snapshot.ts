/**
 * Per-turn workspace projection snapshot helpers (plan 2026-06-12-002).
 *
 * The projection lives on `thread_turns.context_snapshot` under the
 * `workspace_projection` key:
 *
 *   context_snapshot.workspace_projection = {
 *     // dispatch-time fields written by U6 (this lib):
 *     renderedPrefix: string,
 *     sources: [{ owner, prefix, etagSummary? }],
 *     agentsMdKey: string,            // `${renderedPrefix}AGENTS.md` (U2)
 *     injectedFiles: string[],        // PROMPT_FILES present in the render
 *     generatedAt: string,            // ISO-8601
 *     fetches: WorkspaceProjectionFetchEvent[],   // appended by U4 (this lib)
 *     reconcile: { rejectedCount, rejections },   // merged at finalize (U6)
 *   }
 *
 * U4 owns the `fetches` append. U6 owns the dispatch-time snapshot write and
 * the finalize-time reconcile-summary merge. Keep additions small and
 * composable.
 *
 * Every write is a SINGLE atomic UPDATE — never a select-then-update:
 *   - the fetch append uses jsonb concat
 *     (`coalesce(... -> 'fetches', '[]') || newEvent`) so two concurrent
 *     fetch events on the same turn both persist;
 *   - the dispatch snapshot write merges over the existing projection object
 *     (`coalesce(... -> 'workspace_projection', '{}') || snapshot`) so a
 *     turn-loop RE-dispatch never clobbers fetches appended earlier in the
 *     same turn (wakeup re-invokes reuse the same thread_turn_id);
 *   - the reconcile merge sets only the `reconcile` key, leaving every other
 *     projection key untouched.
 */

import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb, type Database } from "@thinkwork/database-pg";
import { threadTurns } from "@thinkwork/database-pg/schema";

export type WorkspaceProjectionFetchKind = "space" | "user";

export type WorkspaceProjectionFetchOutcome =
  | "success"
  | "partial"
  | "denied"
  | "error";

/**
 * `not_authorized` — the access check failed and nothing indicates the turn's
 * rendered routing ever listed the target.
 * `revoked` — the access check failed but the caller asserted the target was
 * listed in the turn's rendered routing (`listedInRouting: true`), i.e.
 * access was revoked between render and fetch. The agent shouldn't retry.
 */
export type WorkspaceProjectionFetchDeniedReason = "not_authorized" | "revoked";

export interface WorkspaceProjectionFetchTarget {
  kind: WorkspaceProjectionFetchKind;
  slug: string;
}

export interface WorkspaceProjectionFetchEvent {
  target: WorkspaceProjectionFetchTarget;
  outcome: WorkspaceProjectionFetchOutcome;
  fileCount: number;
  totalBytes: number;
  deniedReason?: WorkspaceProjectionFetchDeniedReason;
  /** ISO-8601 timestamp of the fetch attempt. */
  at: string;
}

export interface AppendWorkspaceProjectionFetchEventOptions {
  /**
   * When provided, the UPDATE is additionally scoped to this tenant so a
   * caller-supplied threadTurnId can never write onto another tenant's turn.
   */
  tenantId?: string;
  /** Injectable for tests; defaults to the shared singleton. */
  db?: Database;
}

/**
 * Append one fetch event to
 * `context_snapshot.workspace_projection.fetches` on the given thread turn.
 *
 * Atomic: one UPDATE, jsonb `||` concat against the column's current value —
 * no read-modify-write, so concurrent appends both land.
 */
export async function appendWorkspaceProjectionFetchEvent(
  threadTurnId: string,
  event: WorkspaceProjectionFetchEvent,
  options: AppendWorkspaceProjectionFetchEventOptions = {},
): Promise<void> {
  const db = options.db ?? getDb();
  // jsonb `||` on two arrays concatenates them, so the new event is wrapped
  // in a single-element array.
  const eventArrayJson = JSON.stringify([event]);

  const conditions = [eq(threadTurns.id, threadTurnId)];
  if (options.tenantId) {
    conditions.push(eq(threadTurns.tenant_id, options.tenantId));
  }

  await db
    .update(threadTurns)
    .set({
      context_snapshot: sql`jsonb_set(
        jsonb_set(
          coalesce(${threadTurns.context_snapshot}, '{}'::jsonb),
          '{workspace_projection}',
          coalesce(${threadTurns.context_snapshot} -> 'workspace_projection', '{}'::jsonb),
          true
        ),
        '{workspace_projection,fetches}',
        coalesce(${threadTurns.context_snapshot} -> 'workspace_projection' -> 'fetches', '[]'::jsonb) || ${eventArrayJson}::jsonb,
        true
      )`,
    })
    .where(and(...conditions));
}

// ---------------------------------------------------------------------------
// U6 — dispatch-time projection snapshot
// ---------------------------------------------------------------------------

/**
 * The prompt files the Pi runtime injects into the system prompt when present
 * in the rendered workspace. Mirrors `PROMPT_FILES` in
 * `packages/pi-extensions/src/system-prompt-compose.ts` (packages/api does
 * not depend on pi-extensions — keep the two lists in sync).
 */
export const WORKSPACE_PROJECTION_PROMPT_FILES = [
  "AGENTS.md",
  "CONTEXT.md",
  "GUARDRAILS.md",
  "SPACE.md",
  "User/USER.md",
] as const;

export interface WorkspaceProjectionSnapshotSource {
  owner: string;
  prefix: string;
  /**
   * Compact fingerprint of the files hydrated from this source:
   * `<fileCount>:<sha256-of-sorted-path@etag-lines, first 12 hex chars>`.
   * Lets evals/operators detect "same source prefix, different content"
   * without storing every etag. Omitted when the manifest lists no files
   * for the source.
   */
  etagSummary?: string;
}

/** Dispatch-time projection snapshot (U9 web panel + U10 evals consume it). */
export interface WorkspaceProjectionSnapshot {
  renderedPrefix: string;
  sources: WorkspaceProjectionSnapshotSource[];
  /** S3 key of the generated AGENTS.md for this exact render (U2). */
  agentsMdKey: string;
  /** The PROMPT_FILES actually present in the rendered workspace. */
  injectedFiles: string[];
  /** ISO-8601 — when the render this snapshot describes was generated. */
  generatedAt: string;
}

/**
 * Structural subset of `WorkspaceHydrateManifest`
 * (packages/api/src/lib/workspace-renderer/types.ts) — the dispatch handlers
 * receive it as parsed Lambda-response JSON, so treat fields as optional.
 */
export interface WorkspaceProjectionManifestLike {
  generatedAt?: string;
  sources?: Array<{ owner?: string; prefix?: string }>;
  files?: Array<{ path?: string; sourcePrefix?: string; etag?: string }>;
}

/**
 * Loose shape check for a hydrate manifest arriving as parsed Lambda-response
 * JSON. Shared by both dispatch handlers (chat-agent-invoke +
 * wakeup-processor) so the parity stays mechanical.
 */
export function isWorkspaceProjectionManifestLike(
  value: unknown,
): value is WorkspaceProjectionManifestLike {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    (obj.sources === undefined || Array.isArray(obj.sources)) &&
    (obj.files === undefined || Array.isArray(obj.files))
  );
}

function sourceEtagSummary(
  prefix: string,
  files: NonNullable<WorkspaceProjectionManifestLike["files"]>,
): string | undefined {
  const lines = files
    .filter((file) => file.sourcePrefix === prefix)
    .map((file) => `${file.path ?? ""}@${file.etag ?? ""}`)
    .sort();
  if (lines.length === 0) return undefined;
  const digest = createHash("sha256")
    .update(lines.join("\n"))
    .digest("hex")
    .slice(0, 12);
  return `${lines.length}:${digest}`;
}

/**
 * Build the dispatch-time snapshot from the workspace renderer's output.
 * Derives everything from the hydrate manifest the render already produced —
 * never re-lists S3.
 */
export function buildWorkspaceProjectionSnapshot(input: {
  renderedPrefix: string;
  manifest?: WorkspaceProjectionManifestLike | null;
  /** Injectable for tests; defaults to `new Date()`. */
  now?: () => Date;
}): WorkspaceProjectionSnapshot {
  const manifest = input.manifest ?? {};
  const files = manifest.files ?? [];
  const presentPaths = new Set(
    files.map((file) => file.path).filter((p): p is string => !!p),
  );

  return {
    renderedPrefix: input.renderedPrefix,
    sources: (manifest.sources ?? []).flatMap((source) => {
      if (!source.owner || !source.prefix) return [];
      const etagSummary = sourceEtagSummary(source.prefix, files);
      return [
        {
          owner: source.owner,
          prefix: source.prefix,
          ...(etagSummary ? { etagSummary } : {}),
        },
      ];
    }),
    agentsMdKey: `${input.renderedPrefix}AGENTS.md`,
    injectedFiles: WORKSPACE_PROJECTION_PROMPT_FILES.filter((file) =>
      presentPaths.has(file),
    ),
    generatedAt:
      manifest.generatedAt ?? (input.now?.() ?? new Date()).toISOString(),
  };
}

export interface WriteWorkspaceProjectionSnapshotOptions {
  /** Tenant scoping, same contract as the fetch-event append. */
  tenantId?: string;
  /** Injectable for tests; defaults to the shared singleton. */
  db?: Database;
}

/**
 * Write the dispatch-time snapshot onto
 * `context_snapshot.workspace_projection` for the given thread turn.
 *
 * Atomic: one UPDATE that object-merges the snapshot over the existing
 * projection (`coalesce(existing, '{}') || snapshot`). The snapshot object
 * never carries `fetches` or `reconcile` keys, so a turn-loop RE-dispatch
 * (same thread_turn_id, wakeup re-invokes) refreshes the projection fields
 * while preserving fetch events already appended this turn.
 */
export async function writeWorkspaceProjectionSnapshot(
  threadTurnId: string,
  snapshot: WorkspaceProjectionSnapshot,
  options: WriteWorkspaceProjectionSnapshotOptions = {},
): Promise<void> {
  const db = options.db ?? getDb();
  const snapshotJson = JSON.stringify(snapshot);

  const conditions = [eq(threadTurns.id, threadTurnId)];
  if (options.tenantId) {
    conditions.push(eq(threadTurns.tenant_id, options.tenantId));
  }

  await db
    .update(threadTurns)
    .set({
      context_snapshot: sql`jsonb_set(
        coalesce(${threadTurns.context_snapshot}, '{}'::jsonb),
        '{workspace_projection}',
        coalesce(${threadTurns.context_snapshot} -> 'workspace_projection', '{}'::jsonb) || ${snapshotJson}::jsonb,
        true
      )`,
    })
    .where(and(...conditions));
}

/**
 * Build + write the dispatch-time snapshot, swallowing every failure: a
 * snapshot write must NEVER fail a dispatch (origin R15 is observability,
 * not a gate). Returns the snapshot on success, null on failure.
 */
export async function recordDispatchWorkspaceProjectionSnapshot(input: {
  threadTurnId: string;
  tenantId?: string;
  renderedPrefix: string;
  hydrateManifest?: WorkspaceProjectionManifestLike | null;
  /** Log tag, e.g. "chat-agent-invoke" / "wakeup-processor". */
  source: string;
  db?: Database;
}): Promise<WorkspaceProjectionSnapshot | null> {
  try {
    const snapshot = buildWorkspaceProjectionSnapshot({
      renderedPrefix: input.renderedPrefix,
      manifest: input.hydrateManifest,
    });
    await writeWorkspaceProjectionSnapshot(input.threadTurnId, snapshot, {
      tenantId: input.tenantId,
      db: input.db,
    });
    return snapshot;
  } catch (err) {
    console.error(
      `[${input.source}] workspace projection snapshot write failed (turn proceeds):`,
      err,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// U6 — finalize-time reconcile summary merge
// ---------------------------------------------------------------------------

export const WORKSPACE_PROJECTION_RECONCILE_REJECTION_CAP = 20;

export interface WorkspaceProjectionReconcileRejection {
  path: string;
  code: string;
}

export interface WorkspaceProjectionReconcileSummary {
  rejectedCount: number;
  /** First {@link WORKSPACE_PROJECTION_RECONCILE_REJECTION_CAP} rejections. */
  rejections: WorkspaceProjectionReconcileRejection[];
  /** ISO-8601 timestamp of the merge. */
  updatedAt: string;
}

/**
 * Compact the finalize reconcile report into the projection's `reconcile`
 * summary. Accepts the structural shape of `ReconcileReport`
 * (packages/api/src/lib/chat-finalize/reconcile.ts).
 */
export function buildWorkspaceProjectionReconcileSummary(
  report: {
    files: Array<{ path: string; status: string; code?: string }>;
  },
  now: () => Date = () => new Date(),
): WorkspaceProjectionReconcileSummary {
  const rejected = report.files.filter((file) => file.status === "rejected");
  return {
    rejectedCount: rejected.length,
    rejections: rejected
      .slice(0, WORKSPACE_PROJECTION_RECONCILE_REJECTION_CAP)
      .map((file) => ({ path: file.path, code: file.code ?? "unknown" })),
    updatedAt: now().toISOString(),
  };
}

/**
 * Merge the reconcile summary into
 * `context_snapshot.workspace_projection.reconcile` — additively: the nested
 * jsonb_set pair touches ONLY the `reconcile` key, so the dispatch-time
 * fields and accreted `fetches` stay intact. Crashed turns never reach this
 * merge and keep their dispatch-time snapshot as-is.
 */
export async function mergeWorkspaceProjectionReconcileSummary(
  threadTurnId: string,
  summary: WorkspaceProjectionReconcileSummary,
  options: WriteWorkspaceProjectionSnapshotOptions = {},
): Promise<void> {
  const db = options.db ?? getDb();
  const summaryJson = JSON.stringify(summary);

  const conditions = [eq(threadTurns.id, threadTurnId)];
  if (options.tenantId) {
    conditions.push(eq(threadTurns.tenant_id, options.tenantId));
  }

  await db
    .update(threadTurns)
    .set({
      context_snapshot: sql`jsonb_set(
        jsonb_set(
          coalesce(${threadTurns.context_snapshot}, '{}'::jsonb),
          '{workspace_projection}',
          coalesce(${threadTurns.context_snapshot} -> 'workspace_projection', '{}'::jsonb),
          true
        ),
        '{workspace_projection,reconcile}',
        ${summaryJson}::jsonb,
        true
      )`,
    })
    .where(and(...conditions));
}
