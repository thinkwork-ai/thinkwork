import { notifyThreadActivity } from "../../graphql/notify.js";
import { selectThreadParticipantUserIds } from "./thread-participants-query.js";

type DbLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

interface PublishThreadActivityArgs {
  db: DbLike;
  tenantId: string;
  threadId: string;
  messageId: string;
  /** The message author's user id (or agent id). Excluded from the fan-out. */
  authorId: string | null;
  authorType: string;
  snippet?: string | null;
  threadTitle?: string | null;
  createdAt?: string | null;
}

/**
 * Fans out a per-participant activity event to every USER participant of the
 * thread except the author. Each participant gets a payload-complete event on
 * their own onThreadActivity stream (no follow-up fetch needed to render a
 * notification).
 *
 * Best-effort: the underlying AppSync poster swallows + logs failures, so one
 * participant's publish failing never blocks the others or the originating
 * mutation.
 *
 * Callers MUST invoke this AFTER any mention participant rows are committed
 * (KTD5) — otherwise a freshly @-tagged user is missing from the fan-out and
 * never learns they were added to a brand-new thread.
 */
export async function publishThreadActivity({
  db,
  tenantId,
  threadId,
  messageId,
  authorId,
  authorType,
  snippet,
  threadTitle,
  createdAt,
}: PublishThreadActivityArgs): Promise<void> {
  // Best-effort: a notification-path failure (participant query or AppSync
  // post) must never break the originating send/create mutation. Log and move
  // on — unread state still reconciles on the client's next focus refetch.
  try {
    const userIds = await selectThreadParticipantUserIds({ db, tenantId, threadId });
    await Promise.all(
      userIds
        .filter((userId) => userId !== authorId)
        .map((userId) =>
          notifyThreadActivity({
            userId,
            tenantId,
            threadId,
            messageId,
            authorId,
            authorType,
            snippet,
            threadTitle,
            createdAt,
          }),
        ),
    );
  } catch (err) {
    console.error(`[publishThreadActivity] failed for thread ${threadId}:`, err);
  }
}
