/**
 * Per-turn workspace projection snapshot helpers (plan 2026-06-12-002).
 *
 * The projection lives on `thread_turns.context_snapshot` under the
 * `workspace_projection` key:
 *
 *   context_snapshot.workspace_projection = {
 *     ...dispatch-time fields written by U6 (renderedPrefix, sources, ...),
 *     fetches: WorkspaceProjectionFetchEvent[],   // appended by U4 (this lib)
 *   }
 *
 * U4 owns the `fetches` append; U6 adds the dispatch-time snapshot writer to
 * this same module later. Keep additions small and composable.
 *
 * The append is a SINGLE atomic UPDATE using jsonb concat
 * (`coalesce(... -> 'fetches', '[]') || newEvent`) — never a
 * select-then-update — so two concurrent fetch events on the same turn both
 * persist (each UPDATE re-evaluates the column under the row lock).
 */

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
