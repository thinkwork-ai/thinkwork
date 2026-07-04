/**
 * Saved-canvas index (Living Artifacts THINK-145 U9).
 *
 * Shared read helpers behind the agent parity `threadCanvasContext` query and
 * the rendered workspace canvas manifest: enumerate the SAVED (non-draft)
 * canvases in a space (R19), the current thread's canvas part (the `save_canvas`
 * target), and the spaces the acting user may save into. Drafts are excluded
 * from the saved list by construction.
 *
 * Canvas detection uses the same `metadata.kind` set as the access model
 * (`canvas-access.ts`) so listing can never drift from the writer/gate.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import {
  artifacts,
  db,
  spaceMembers,
  spaces,
  threads,
} from "../../graphql/utils.js";
import { CANVAS_LIVING_KIND, CANVAS_SNAPSHOT_KIND } from "./canvas-access.js";

export interface SavedCanvasSummary {
  artifactId: string;
  title: string;
  updatedAt: string | null;
  headVersion: number;
  status: string;
  /**
   * The canvas's json-render stable part id (`metadata.stablePartId`) — the id
   * an agent must re-emit under to update THIS canvas instead of minting a
   * stray thread-derived draft (checkout routing keys on it). Null for legacy
   * rows written before the id was recorded.
   */
  stablePartId: string | null;
}

export interface WritableSpaceSummary {
  spaceId: string;
  name: string;
}

/** SQL predicate: the row carries a living-canvas metadata kind. */
function isCanvasKindPredicate() {
  return sql`(${artifacts.metadata}->>'kind' = ${CANVAS_LIVING_KIND}
    OR ${artifacts.metadata}->>'kind' = ${CANVAS_SNAPSHOT_KIND})`;
}

function toSummary(row: {
  id: string;
  title: string | null;
  head_version: number | null;
  status: string | null;
  updated_at: Date | string | null;
  stable_part_id?: string | null;
}): SavedCanvasSummary {
  const updated = row.updated_at;
  return {
    artifactId: row.id,
    title: row.title ?? "",
    headVersion: row.head_version ?? 0,
    status: row.status ?? "final",
    stablePartId: row.stable_part_id ?? null,
    updatedAt:
      updated instanceof Date
        ? updated.toISOString()
        : typeof updated === "string"
          ? updated
          : null,
  };
}

/** Column set shared by the summary queries (includes the stable part id). */
const SUMMARY_COLUMNS = {
  id: artifacts.id,
  title: artifacts.title,
  head_version: artifacts.head_version,
  status: artifacts.status,
  updated_at: artifacts.updated_at,
  stable_part_id: sql<string | null>`${artifacts.metadata}->>'stablePartId'`.as(
    "stable_part_id",
  ),
};

/**
 * SAVED (status 'final') canvases in a space, most-recently-updated first.
 * Drafts (status 'draft', null space) never appear here (R19).
 */
export async function listSavedCanvasesInSpace(
  tenantId: string,
  spaceId: string,
  limit = 100,
): Promise<SavedCanvasSummary[]> {
  const rows = await db
    .select(SUMMARY_COLUMNS)
    .from(artifacts)
    .where(
      and(
        eq(artifacts.tenant_id, tenantId),
        eq(artifacts.space_id, spaceId),
        eq(artifacts.status, "final"),
        isCanvasKindPredicate(),
      ),
    )
    .orderBy(desc(artifacts.updated_at))
    .limit(limit);
  return rows.map(toSummary);
}

/**
 * The most-recent canvas artifact materialized in a thread — checked-out head
 * or draft (born-as-artifact). This is the `save_canvas` / `refresh` target
 * when the model names no explicit artifact. Null when the thread has no
 * canvas.
 *
 * Preference order (THINK-145 seam fix): a canvas CHECKED OUT into this thread
 * (`metadata.checkouts` contains `{threadId}`) wins over a thread-derived
 * draft. Rationale: when a saved canvas is open in the thread, any stray draft
 * that exists alongside it is almost always an accidental new-part-id emission
 * — preferring the draft made `save_canvas` persist the stray and orphan the
 * user's real canvas. The checked-out canvas lives in ITS ORIGINAL thread's
 * `thread_id`, so the thread-derived query never sees it; the checkout record
 * is the only linkage.
 */
export async function getThreadCurrentCanvas(
  tenantId: string,
  threadId: string,
): Promise<SavedCanvasSummary | null> {
  const checkoutMatch = JSON.stringify([{ threadId }]);
  const [checkedOut] = await db
    .select(SUMMARY_COLUMNS)
    .from(artifacts)
    .where(
      and(
        eq(artifacts.tenant_id, tenantId),
        sql`coalesce(${artifacts.metadata}->'checkouts', '[]'::jsonb) @> ${checkoutMatch}::jsonb`,
        isCanvasKindPredicate(),
      ),
    )
    .orderBy(desc(artifacts.updated_at))
    .limit(1);
  if (checkedOut) return toSummary(checkedOut);

  const [row] = await db
    .select(SUMMARY_COLUMNS)
    .from(artifacts)
    .where(
      and(
        eq(artifacts.tenant_id, tenantId),
        eq(artifacts.thread_id, threadId),
        isCanvasKindPredicate(),
      ),
    )
    .orderBy(desc(artifacts.updated_at))
    .limit(1);
  return row ? toSummary(row) : null;
}

/**
 * Spaces the user holds a member-or-above role in (owner/admin/member) — the
 * set they may save a canvas into. Viewer-role memberships are excluded to
 * mirror the write gate in `canvas-access.ts`.
 */
export async function listWritableSpacesForUser(
  tenantId: string,
  userId: string,
): Promise<WritableSpaceSummary[]> {
  const rows = await db
    .select({
      spaceId: spaces.id,
      name: spaces.name,
      role: spaceMembers.role,
    })
    .from(spaceMembers)
    .innerJoin(spaces, eq(spaces.id, spaceMembers.space_id))
    .where(
      and(
        eq(spaceMembers.tenant_id, tenantId),
        eq(spaceMembers.user_id, userId),
        eq(spaces.status, "active"),
      ),
    );
  return rows
    .filter(
      (row) =>
        row.role === "owner" || row.role === "admin" || row.role === "member",
    )
    .map((row) => ({ spaceId: row.spaceId, name: row.name }));
}

/** Resolve a thread's tenant + home space (name included), or null. */
export async function resolveThreadSpace(threadId: string): Promise<{
  tenantId: string;
  spaceId: string | null;
  spaceName: string | null;
} | null> {
  const [row] = await db
    .select({
      tenantId: threads.tenant_id,
      spaceId: threads.space_id,
      spaceName: spaces.name,
    })
    .from(threads)
    .leftJoin(spaces, eq(spaces.id, threads.space_id))
    .where(eq(threads.id, threadId));
  if (!row) return null;
  return {
    tenantId: row.tenantId,
    spaceId: row.spaceId ?? null,
    spaceName: row.spaceName ?? null,
  };
}
