import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { callerVisibleThreadPredicate } from "./access.js";

function renderSql(): string {
  return new PgDialect().sqlToQuery(
    callerVisibleThreadPredicate("tenant-1", "user-1"),
  ).sql;
}

describe("callerVisibleThreadPredicate", () => {
  it("gates personal threads on author OR explicit participant", () => {
    const sql = renderSql();
    expect(sql).toContain("space_id");
    expect(sql).toContain("IS NULL");
    expect(sql).toContain("user_id");
    expect(sql).toContain("thread_participants");
    expect(sql).toContain("participant_type");
  });

  it("authorizes space-scoped threads through active public spaces or membership", () => {
    const sql = renderSql();
    expect(sql).toContain("IS NOT NULL");
    expect(sql).toContain("caller_space.status = 'active'");
    expect(sql).toContain("space_members");
    expect(sql).toContain("access_mode");
  });

  it("lets an explicit participant bypass the space-membership gate", () => {
    // Regression guard for the private-Space mention case: a user mentioned
    // into a thread inside a private Space they don't belong to must still see
    // that thread. The bypass is separate from Space membership, so the
    // predicate references thread_participants more than once.
    const sql = renderSql();
    const participantChecks = sql.match(/thread_participants/g) ?? [];
    expect(participantChecks.length).toBeGreaterThanOrEqual(2);
  });
});
