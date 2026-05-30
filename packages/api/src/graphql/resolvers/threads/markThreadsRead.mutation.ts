import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import { markCallerThreadsRead } from "../../../lib/threads/thread-unread-state.js";

/**
 * Batch mark a caller's threads read/unread. Caller-scoped: the tenant and user
 * are resolved from the authenticated context (never the input), and the write
 * touches only the caller's own participant rows (see markCallerThreadsRead).
 * `read: false` marks unread. Read-state-only — no thread-update notification.
 */
export const markThreadsRead = async (
  _parent: unknown,
  args: { input: { threadIds: string[]; read?: boolean } },
  ctx: GraphQLContext,
): Promise<{ updated: number }> => {
  const { userId, tenantId } = await resolveCaller(ctx);
  if (!userId || !tenantId) {
    throw new GraphQLError("Caller identity required", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }

  const read = args.input.read ?? true;
  const threadIds = Array.from(
    new Set(
      (args.input.threadIds ?? []).map((id) => id.trim()).filter(Boolean),
    ),
  );

  const updated = await markCallerThreadsRead({
    tenantId,
    userId,
    threadIds,
    readAt: read ? new Date() : null,
  });

  return { updated };
};
