import { describe, expect, it } from "vitest";
import {
  resolveUserQuestionRecord,
  toUserQuestionStatus,
} from "./user-question-record";
import type { UserQuestionRecord } from "./ui-message-types";

describe("toUserQuestionStatus", () => {
  it("uppercases and narrows known statuses", () => {
    expect(toUserQuestionStatus("answered")).toBe("ANSWERED");
    expect(toUserQuestionStatus("PENDING")).toBe("PENDING");
    expect(toUserQuestionStatus(" cancelled ")).toBe("CANCELLED");
  });

  it("falls back to PENDING only for missing values", () => {
    expect(toUserQuestionStatus(null)).toBe("PENDING");
    expect(toUserQuestionStatus(undefined)).toBe("PENDING");
    expect(toUserQuestionStatus("  ")).toBe("PENDING");
  });

  it("preserves an unknown non-empty status instead of coercing to PENDING", () => {
    expect(toUserQuestionStatus("expired")).toBe("EXPIRED");
  });
});

describe("resolveUserQuestionRecord", () => {
  const record: UserQuestionRecord = {
    id: "q-1",
    status: "ANSWERED",
    answeredBy: "user-1",
  };

  it("resolves the current user's own answer to their name", () => {
    expect(
      resolveUserQuestionRecord(record, {
        currentUser: { id: "user-1", name: "Eric Odom" },
      })?.answeredByDisplayName,
    ).toBe("Eric Odom");
  });

  it("resolves through USER mention targets", () => {
    expect(
      resolveUserQuestionRecord(record, {
        mentionTargets: [
          { targetType: "AGENT", targetId: "user-1", displayName: "Bot" },
          { targetType: "USER", targetId: "user-1", displayName: "Teammate" },
        ],
      })?.answeredByDisplayName,
    ).toBe("Teammate");
  });

  it("passes the record through unchanged when no name source matches", () => {
    const resolved = resolveUserQuestionRecord(record, {
      currentUser: { id: "someone-else", name: "Other" },
      mentionTargets: [],
    });
    expect(resolved).toEqual(record);
    expect(resolved?.answeredByDisplayName).toBeUndefined();
  });

  it("returns null for a missing record", () => {
    expect(resolveUserQuestionRecord(null)).toBeNull();
    expect(resolveUserQuestionRecord(undefined)).toBeNull();
  });
});
