import type { GraphQLContext } from "../../context.js";
import { isNotNull } from "drizzle-orm";
import {
  db,
  eq,
  and,
  desc,
  lt,
  sql,
  inArray,
  artifacts,
  threads,
  users,
  artifactToCamel,
} from "../../utils.js";
import { hasServiceSecret } from "../core/authz.js";
import { resolveCallerFromAuth } from "../core/resolve-auth-user.js";
import {
  canvasListVisibilityPredicate,
  excludeCanvasArtifactsPredicate,
} from "../../../lib/artifacts/canvas-access.js";
import { CANVAS_METADATA_KIND } from "../../../lib/artifacts/canvas-lifecycle.js";

export const artifacts_ = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const conditions = [eq(artifacts.tenant_id, args.tenantId)];
  if (args.threadId) conditions.push(eq(artifacts.thread_id, args.threadId));
  if (args.agentId) conditions.push(eq(artifacts.agent_id, args.agentId));
  // R15 space entry point: scope to one space's canvases. The membership
  // visibility predicate below still applies, so this only narrows the set the
  // caller may already see.
  if (args.spaceId) conditions.push(eq(artifacts.space_id, args.spaceId));
  if (args.type) conditions.push(eq(artifacts.type, args.type.toLowerCase()));
  if (args.status)
    conditions.push(eq(artifacts.status, args.status.toLowerCase()));
  if (args.favoritedOnly === true) {
    conditions.push(isNotNull(artifacts.favorited_at));
  }
  // R14: canvas list surfaces default to SAVED canvases; draft-status canvases
  // are hidden behind the explicit includeDrafts filter. Non-canvas artifacts
  // are unaffected (this only excludes draft rows carrying the canvas marker).
  if (args.includeDrafts !== true) {
    conditions.push(
      sql`NOT (${artifacts.metadata}->>'kind' = ${CANVAS_METADATA_KIND} AND ${artifacts.status} = 'draft')`,
    );
  }
  if (args.cursor)
    conditions.push(lt(artifacts.created_at, new Date(args.cursor)));

  // Canvas visibility (R15): a canvas-kind artifact appears in the list only
  // when the caller may see it — saved canvases through an accessible space,
  // drafts through their own thread. Non-canvas rows are unaffected. Service-
  // secret callers (trusted infra) bypass.
  if (!hasServiceSecret(ctx)) {
    const caller = await resolveCallerFromAuth(ctx.auth);
    if (caller.userId) {
      conditions.push(
        canvasListVisibilityPredicate(args.tenantId, caller.userId),
      );
    } else {
      // Cognito caller we cannot resolve to a user: fail closed on canvases.
      conditions.push(excludeCanvasArtifactsPredicate());
    }
  }

  const limit = Math.min(args.limit || 50, 200);
  // favoritedOnly callers (apps/web sidebar Favorites section) want
  // most-recently-favorited first, not most-recently-created. Other
  // callers keep the existing created_at-desc ordering so list paging
  // stays stable.
  const orderColumn =
    args.favoritedOnly === true ? artifacts.favorited_at : artifacts.created_at;
  const rows = await db
    .select()
    .from(artifacts)
    .where(and(...conditions))
    .orderBy(desc(orderColumn))
    .limit(limit);
  const userNameByThread = await resolveUserNamesByThread(rows);
  return rows.map((row) => ({
    ...artifactToCamel(row),
    userName: row.thread_id
      ? (userNameByThread.get(row.thread_id) ?? null)
      : null,
  }));
};

/**
 * Batch-resolve the generating user's display name for a page of artifacts via
 * the source thread (`artifacts.thread_id -> threads.user_id -> users`) — one
 * query per page, not per row. Artifacts without a thread, or whose thread has
 * no user, are simply absent from the map (the row then shows no user).
 */
async function resolveUserNamesByThread(
  rows: Array<{ thread_id: string | null }>,
): Promise<Map<string, string>> {
  const threadIds = [
    ...new Set(
      rows
        .map((row) => row.thread_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  if (threadIds.length === 0) return new Map();

  const userRows = await db
    .select({
      threadId: threads.id,
      name: users.name,
      email: users.email,
    })
    .from(threads)
    .innerJoin(users, eq(threads.user_id, users.id))
    .where(inArray(threads.id, threadIds));

  const byThread = new Map<string, string>();
  for (const row of userRows) {
    const label = row.name ?? row.email;
    if (label) byThread.set(row.threadId, label);
  }
  return byThread;
}
