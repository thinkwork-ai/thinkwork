/**
 * Cancel hygiene for pending questions (plan 2026-06-09-005 U3).
 *
 * Thread DELETE: no resolver change needed — the pending_user_questions
 * FKs cascade. deleteThread.mutation.ts explicitly deletes the thread's
 * messages and then the thread row inside one transaction; the pending
 * row is cascade-deleted via message_id (and via thread_id for any raw
 * thread delete). These tests pin BOTH halves of that argument: the
 * schema's onDelete behavior and the mutation's delete ordering.
 *
 * Thread ARCHIVE: updateThread cancels pending rows (status='cancelled')
 * when archived_at is set — covered by updateThread.mutation.test.ts; the
 * source assertion here guards the wiring.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { pendingUserQuestions } from "@thinkwork/database-pg/schema";

const deleteThreadSource = readFileSync(
  new URL(
    "../../graphql/resolvers/threads/deleteThread.mutation.ts",
    import.meta.url,
  ),
  "utf8",
);
const updateThreadSource = readFileSync(
  new URL(
    "../../graphql/resolvers/threads/updateThread.mutation.ts",
    import.meta.url,
  ),
  "utf8",
);

describe("thread delete cascades pending questions (schema)", () => {
  const config = getTableConfig(pendingUserQuestions);
  const fkByColumn = new Map(
    config.foreignKeys.map((fk) => {
      const ref = fk.reference();
      return [ref.columns[0]?.name, fk] as const;
    }),
  );

  it("thread_id FK cascades on delete", () => {
    expect(fkByColumn.get("thread_id")?.onDelete).toBe("cascade");
  });

  it("message_id FK cascades on delete (covers deleteThread's explicit message delete)", () => {
    expect(fkByColumn.get("message_id")?.onDelete).toBe("cascade");
  });

  it("tenant_id FK cascades on delete", () => {
    expect(fkByColumn.get("tenant_id")?.onDelete).toBe("cascade");
  });
});

describe("deleteThread relies on the cascade (no explicit cleanup needed)", () => {
  it("deletes messages and then the thread inside one transaction", () => {
    // Message delete fires the message_id cascade; the thread delete fires
    // the thread_id cascade. Either alone clears the pending rows.
    expect(deleteThreadSource).toContain("db.transaction");
    const messagesDelete = deleteThreadSource.indexOf(
      "tx.delete(messages).where(eq(messages.thread_id",
    );
    const threadsDelete = deleteThreadSource.indexOf(".delete(threads)");
    expect(messagesDelete).toBeGreaterThan(-1);
    expect(threadsDelete).toBeGreaterThan(messagesDelete);
  });
});

describe("updateThread cancels pending questions on archive", () => {
  it("calls cancelPendingQuestions when archivedAt is set", () => {
    expect(updateThreadSource).toContain("cancelPendingQuestions");
    expect(updateThreadSource).toContain("i.archivedAt !== undefined");
  });
});
