/**
 * Creator stamping for artifact rows: every artifact insert records the user
 * it was generated for/by in `artifacts.created_by_user_id` so list surfaces
 * resolve the User column directly instead of joining through the thread at
 * read time. The source thread's owner is the creator of record — agent-
 * emitted artifacts (canvases, documents, applets) all originate from a
 * user's thread.
 */

import { db, eq, threads } from "../../graphql/utils.js";

/**
 * Resolve the creating user for an artifact from its source thread. Returns
 * null when there is no thread or the thread has no user (system jobs) — the
 * column stays null rather than guessing.
 */
export async function creatorUserIdForThread(
  threadId: string | null | undefined,
): Promise<string | null> {
  if (!threadId) return null;
  const [row] = await db
    .select({ userId: threads.user_id })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  return row?.userId ?? null;
}
