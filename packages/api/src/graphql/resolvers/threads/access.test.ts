import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { callerVisibleThreadPredicate } from "./access.js";

function renderSql(): string {
  return new PgDialect().sqlToQuery(
    callerVisibleThreadPredicate("tenant-1", "user-1"),
  ).sql;
}

describe("callerVisibleThreadPredicate", () => {
  it("gates on author OR explicit participant", () => {
    const sql = renderSql();
    expect(sql).toContain("user_id");
    expect(sql).toContain("thread_participants");
    expect(sql).toContain("participant_type");
  });

  it("restricts space-scoped threads to members or public spaces", () => {
    const sql = renderSql();
    expect(sql).toContain("space_members");
    expect(sql).toContain("access_mode");
  });

  it("lets an explicit participant bypass the space-membership gate", () => {
    // Regression guard for the private-Space mention case: a user mentioned
    // into a thread inside a private Space they don't belong to must still see
    // that thread. The bypass adds a SECOND thread_participants check inside
    // the space clause, so the predicate references thread_participants twice.
    const sql = renderSql();
    const participantChecks = sql.match(/thread_participants/g) ?? [];
    expect(participantChecks.length).toBeGreaterThanOrEqual(2);
  });
});
