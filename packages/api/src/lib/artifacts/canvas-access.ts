/**
 * Canvas access model (Living Artifacts, THINK-145 U2 / KTD5).
 *
 * GenUI *canvases* are the only artifact kind with living-artifact semantics
 * in v1. This module centralizes the one predicate that decides whether an
 * artifact row is a canvas (`isCanvasArtifact`) and the one gate that decides
 * whether a caller may read or write it (`assertCanvasAccess`).
 *
 * Access semantics (R15):
 *   - SAVED canvas (non-null `space_id`):
 *       read  → `canAccessSpace` (space membership OR public OR mention-invite
 *               participant) — no visibility into the originating thread.
 *       write → a `space_members` row with role owner/admin/member. The
 *               `viewer` role is read-only, and a non-member on a *public*
 *               space can read but not write (write always requires an actual
 *               membership row — "saving requires membership in the space").
 *   - DRAFT canvas (null `space_id`):
 *       read/write → originating-thread visibility (`callerVisibleThreadPredicate`,
 *               which resolves the creating user via `threads.user_id` plus
 *               participants/work-item assignees). A draft with a null
 *               `thread_id` has NO creator identity to fall back to (the
 *               artifacts table has no dedicated creator column), so it is
 *               readable/writable by no one — never publicly readable by id.
 *   - Non-canvas artifacts: no-op — the caller's existing tenant-member gate
 *     stands unchanged.
 *
 * Historical note: `artifact.query.ts` used to inline a check on
 * `metadata.kind === "genui_snapshot"`, but the retired `promoteGenUIArtifact`
 * writer persisted `metadata.kind === "json_render_snapshot"`, so the old gate
 * never fired and every promoted snapshot was readable by any tenant member
 * regardless of thread visibility. The living canvas (`json_render_canvas`) is
 * now the only GenUI artifact writer; `CANVAS_SNAPSHOT_KIND` below is retained
 * only so any straggler snapshot rows on customer stages still get the
 * space/thread access gate (defense in depth). The old `genui_snapshot` string
 * is intentionally NOT recognized (a regression test pins this).
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../graphql/context.js";
import {
  and,
  db,
  eq,
  sql,
  artifacts,
  spaceMembers,
  spaces,
  threadParticipants,
  threads,
} from "../../graphql/utils.js";
import { resolveCallerFromAuth } from "../../graphql/resolvers/core/resolve-auth-user.js";
import { canAccessSpace } from "../../graphql/resolvers/spaces/shared.js";
import { callerVisibleThreadPredicate } from "../../graphql/resolvers/threads/access.js";

/**
 * @deprecated The `metadata.kind` value the retired `promoteGenUIArtifact`
 * writer persisted. No writer emits this kind anymore (the living canvas is the
 * only GenUI artifact system — see `CANVAS_LIVING_KIND`). Retained solely so
 * access gates still recognize any straggler snapshot rows on customer stages
 * and keep them space/thread-scoped (defense in depth). Do not add new writers
 * for this kind.
 */
export const CANVAS_SNAPSHOT_KIND = "json_render_snapshot";

/**
 * The kind the born-as-artifact writer persists for living canvases
 * (`canvas-lifecycle.ts` — kept in sync by canvas-access.test.ts).
 */
export const CANVAS_LIVING_KIND = "json_render_canvas";

/** Every metadata kind that carries living-canvas access semantics in v1. */
const CANVAS_METADATA_KINDS: ReadonlySet<string> = new Set([
  CANVAS_SNAPSHOT_KIND,
  CANVAS_LIVING_KIND,
]);

export type CanvasAccessMode = "read" | "write";

export interface CanvasAccessRow {
  tenant_id: string;
  space_id?: string | null;
  thread_id?: string | null;
  metadata?: unknown;
}

/**
 * True when the artifact row is a GenUI canvas (living-artifact semantics
 * apply). Tolerates `metadata` stored as a JSON string or an already-parsed
 * object; anything else is treated as non-canvas.
 */
export function isCanvasArtifact(row: { metadata?: unknown }): boolean {
  const kind = readMetadataKind(row?.metadata);
  return kind !== null && CANVAS_METADATA_KINDS.has(kind);
}

function readMetadataKind(metadata: unknown): string | null {
  if (typeof metadata === "string") {
    try {
      return readMetadataKind(JSON.parse(metadata));
    } catch {
      return null;
    }
  }
  if (
    metadata !== null &&
    typeof metadata === "object" &&
    !Array.isArray(metadata)
  ) {
    const kind = (metadata as { kind?: unknown }).kind;
    return typeof kind === "string" ? kind : null;
  }
  return null;
}

function canvasForbidden(mode: CanvasAccessMode): GraphQLError {
  return new GraphQLError(
    mode === "write"
      ? "You do not have write access to this canvas"
      : "You do not have access to this canvas",
    { extensions: { code: "FORBIDDEN" } },
  );
}

/**
 * Assert the caller may read or write `row` when it is a canvas artifact.
 * No-op for non-canvas artifacts (their existing tenant-member gate stands).
 *
 * Callers should still run their own tenant-membership check first; this gate
 * additionally re-resolves the caller and refuses cross-tenant identities as
 * defense in depth.
 */
export async function assertCanvasAccess(
  ctx: GraphQLContext,
  row: CanvasAccessRow,
  mode: CanvasAccessMode,
): Promise<void> {
  if (!isCanvasArtifact(row)) return;

  const caller = await resolveCallerFromAuth(ctx.auth);
  if (!caller.userId || caller.tenantId !== row.tenant_id) {
    throw canvasForbidden(mode);
  }

  // SAVED canvas: space-scoped. Read = any space access; write = member role.
  if (row.space_id) {
    if (mode === "read") {
      if (!(await canAccessSpace(ctx, row.tenant_id, row.space_id))) {
        throw canvasForbidden(mode);
      }
    } else if (
      !(await hasSpaceWriteRole(row.tenant_id, row.space_id, caller.userId))
    ) {
      throw canvasForbidden(mode);
    }
    return;
  }

  // DRAFT canvas (null space): originating-thread visibility with the creating
  // user as the fallback. No thread → no creator identity → nobody.
  if (!row.thread_id) {
    throw canvasForbidden(mode);
  }
  const [visibleThread] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.id, row.thread_id),
        eq(threads.tenant_id, row.tenant_id),
        callerVisibleThreadPredicate(row.tenant_id, caller.userId),
      ),
    );
  if (!visibleThread) {
    throw canvasForbidden(mode);
  }
}

/**
 * True when `userId` holds a member-or-above role (owner/admin/member) on the
 * space. The `viewer` role and non-members (including on public spaces) are
 * excluded — canvas writes require an actual membership row.
 */
export async function hasSpaceWriteRole(
  tenantId: string,
  spaceId: string,
  userId: string,
): Promise<boolean> {
  const [member] = await db
    .select({ role: spaceMembers.role })
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.tenant_id, tenantId),
        eq(spaceMembers.space_id, spaceId),
        eq(spaceMembers.user_id, userId),
      ),
    );
  const role = member?.role;
  return role === "owner" || role === "admin" || role === "member";
}

/**
 * A SQL predicate that keeps a canvas-kind artifact in a list result only when
 * the caller may see it: SAVED canvases through an accessible space (public or
 * membership), DRAFT canvases through their originating thread (creator or
 * participant). Non-canvas rows always pass — this predicate never changes
 * legacy artifact listing behavior.
 *
 * NOTE (U2 scope): the draft leg mirrors thread visibility via creator +
 * participants only; it omits the work-item-assignee leg that
 * `callerVisibleThreadPredicate` carries for the single-row read path. Drafts
 * are hidden from list surfaces by default anyway (R14, U10), so this
 * narrower list visibility is intentional for now.
 */
export function canvasListVisibilityPredicate(
  tenantId: string,
  callerUserId: string,
) {
  return sql`(
    (${artifacts.metadata}->>'kind' IS DISTINCT FROM ${CANVAS_SNAPSHOT_KIND}
     AND ${artifacts.metadata}->>'kind' IS DISTINCT FROM ${CANVAS_LIVING_KIND})
    OR (
      ${artifacts.space_id} IS NOT NULL
      AND EXISTS (
        SELECT 1
          FROM ${spaces} canvas_space
         WHERE canvas_space.id = ${artifacts.space_id}
           AND canvas_space.tenant_id = ${tenantId}
           AND canvas_space.status = 'active'
           AND (
             canvas_space.access_mode = 'public'
             OR EXISTS (
               SELECT 1
                 FROM ${spaceMembers} canvas_sm
                WHERE canvas_sm.tenant_id = ${tenantId}
                  AND canvas_sm.space_id = ${artifacts.space_id}
                  AND canvas_sm.user_id = ${callerUserId}
             )
           )
      )
    )
    OR (
      ${artifacts.space_id} IS NULL
      AND ${artifacts.thread_id} IS NOT NULL
      AND EXISTS (
        SELECT 1
          FROM ${threads} canvas_thread
         WHERE canvas_thread.id = ${artifacts.thread_id}
           AND canvas_thread.tenant_id = ${tenantId}
           AND (
             canvas_thread.user_id = ${callerUserId}
             OR EXISTS (
               SELECT 1
                 FROM ${threadParticipants} canvas_tp
                WHERE canvas_tp.tenant_id = ${tenantId}
                  AND canvas_tp.thread_id = canvas_thread.id
                  AND canvas_tp.participant_type = 'user'
                  AND canvas_tp.user_id = ${callerUserId}
             )
           )
      )
    )
  )`;
}

/** SQL predicate that excludes ALL canvas-kind artifacts (fail-closed). */
export function excludeCanvasArtifactsPredicate() {
  return sql`(${artifacts.metadata}->>'kind' IS DISTINCT FROM ${CANVAS_SNAPSHOT_KIND}
    AND ${artifacts.metadata}->>'kind' IS DISTINCT FROM ${CANVAS_LIVING_KIND})`;
}
