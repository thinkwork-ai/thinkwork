import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { callerVisibleThreadPredicate } from "./access.js";

function renderSql(): string {
  return new PgDialect().sqlToQuery(
    callerVisibleThreadPredicate("tenant-1", "user-1"),
  ).sql;
}

describe("callerVisibleThreadPredicate", () => {
  it("gates all user-visible threads on owner OR explicit participant", () => {
    const sql = renderSql();
    expect(sql).toContain("user_id");
    expect(sql).toContain("thread_participants");
    expect(sql).toContain("participant_type");
  });

  it("does not authorize threads through Space visibility", () => {
    const sql = renderSql();
    expect(sql).not.toContain("caller_space");
    expect(sql).not.toContain("space_members");
    expect(sql).not.toContain("access_mode");
    expect(sql).not.toContain("space_id");
  });

  it("treats explicit participants as thread-level invites", () => {
    const sql = renderSql();
    const participantChecks = sql.match(/thread_participants/g) ?? [];
    expect(participantChecks.length).toBe(1);
    expect(sql).toContain("caller_tp.user_id");
  });
});
