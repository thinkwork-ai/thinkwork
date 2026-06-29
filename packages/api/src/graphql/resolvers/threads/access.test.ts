import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { callerVisibleThreadPredicate } from "./access.js";

function renderSql(): string {
  return new PgDialect().sqlToQuery(
    callerVisibleThreadPredicate("tenant-1", "user-1"),
  ).sql;
}

describe("callerVisibleThreadPredicate", () => {
  it("gates all user-visible threads on owner, explicit participant, or assigned linked Work Item", () => {
    const sql = renderSql();
    expect(sql).toContain("user_id");
    expect(sql).toContain("thread_participants");
    expect(sql).toContain("participant_type");
    expect(sql).toContain("work_item_thread_links");
    expect(sql).toContain("work_items");
    expect(sql).toContain("owner_user_id");
  });

  it("does not authorize threads through Space visibility", () => {
    const sql = renderSql();
    expect(sql).not.toContain("caller_space");
    expect(sql).not.toContain("space_members");
    expect(sql).not.toContain("access_mode");
  });

  it("treats explicit participants as thread-level invites", () => {
    const sql = renderSql();
    const participantChecks = sql.match(/thread_participants/g) ?? [];
    expect(participantChecks.length).toBe(1);
    expect(sql).toContain("caller_tp.user_id");
  });

  it("treats assigned linked Work Items as task-level thread invites", () => {
    const sql = renderSql();
    expect(sql).toContain("caller_witl.thread_id");
    expect(sql).toContain("caller_wi.owner_user_id");
    expect(sql).toContain("caller_wi.archived_at IS NULL");
  });
});
