/**
 * Message-domain DataLoaders (per-request, merged in graphql/dataloaders.ts).
 *
 * messageUserQuestion — Message.userQuestion answer-state read path
 * (plan 2026-06-09-005 U3): batch-load pending_user_questions rows by
 * message_id. Answer state derives from the question row, never from the
 * message's parts payload.
 *
 * Tenant safety: same contract as threads/loaders.ts — the parent Message
 * was already fetched through a tenant-scoped path; only invoke via a
 * field resolver on an authorized Message object.
 */

import DataLoader from "dataloader";
import { inArray } from "drizzle-orm";
import { db } from "../../utils.js";
import { pendingUserQuestions } from "@thinkwork/database-pg/schema";
import {
  userQuestionToGraphql,
  type UserQuestionGraphql,
} from "./user-question.shared.js";

export const createMessageLoaders = () => ({
  messageUserQuestion: new DataLoader<string, UserQuestionGraphql | null>(
    async (messageIds) => {
      const ids = [...messageIds];
      if (ids.length === 0) return [];
      const rows = await db
        .select()
        .from(pendingUserQuestions)
        .where(inArray(pendingUserQuestions.message_id, ids));
      const map = new Map(
        rows.map((row) => [row.message_id, userQuestionToGraphql(row)]),
      );
      return ids.map((id) => map.get(id) ?? null);
    },
  ),
});
