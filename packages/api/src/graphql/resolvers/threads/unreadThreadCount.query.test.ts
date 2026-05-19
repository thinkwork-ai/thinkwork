import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./unreadThreadCount.query.ts", import.meta.url),
  "utf8",
);

describe("unreadThreadCount participant-scoped read state", () => {
  it("counts caller participant unread state before legacy thread read state", () => {
    expect(source).toContain("resolveCallerUserId");
    expect(source).toContain("FROM thread_participants tp");
    expect(source).toContain("tp.user_id = ${callerUserId}::uuid");
    expect(source).toContain("tp.last_read_at IS NULL");
    expect(source).toContain("${activityExpression} > tp.last_read_at");
  });

  it("keeps legacy thread-level unread behavior only for pre-participant rows", () => {
    expect(source).toContain("tp_legacy");
    expect(source).toContain("NOT EXISTS");
    expect(source).toContain("${threads.last_read_at} IS NULL");
    expect(source).toContain("${activityExpression} > ${threads.last_read_at}");
  });
});
