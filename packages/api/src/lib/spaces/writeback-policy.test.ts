import { describe, expect, it } from "vitest";

import {
  evaluateExternalTaskWriteback,
  normalizeSpaceWritebackPolicy,
} from "./writeback-policy.js";

describe("Space external writeback policy", () => {
  it("defaults unknown or absent policies to disabled", () => {
    expect(normalizeSpaceWritebackPolicy(null)).toBe("disabled");
    expect(normalizeSpaceWritebackPolicy("surprise")).toBe("disabled");
  });

  it("blocks all external task writeback when disabled", () => {
    expect(
      evaluateExternalTaskWriteback({
        policy: "disabled",
        action: "status_summary",
      }),
    ).toMatchObject({
      allowed: false,
      reason: "writeback_disabled",
      requiresHumanConfirmation: false,
    });
  });

  it("allows status summaries but not comments for status_only spaces", () => {
    expect(
      evaluateExternalTaskWriteback({
        policy: "status_only",
        action: "status_summary",
      }),
    ).toMatchObject({ allowed: true, reason: "allowed" });
    expect(
      evaluateExternalTaskWriteback({
        policy: "status_only",
        action: "human_comment",
      }),
    ).toMatchObject({ allowed: false, reason: "comments_disabled" });
  });

  it("allows human comments under status_and_comments", () => {
    expect(
      evaluateExternalTaskWriteback({
        policy: "status_and_comments",
        action: "human_comment",
      }),
    ).toMatchObject({ allowed: true, reason: "allowed" });
  });

  it("requires human confirmation before agent-authored comments by default", () => {
    expect(
      evaluateExternalTaskWriteback({
        policy: "status_and_comments",
        action: "agent_comment",
      }),
    ).toMatchObject({
      allowed: false,
      reason: "agent_comment_confirmation_required",
      requiresHumanConfirmation: true,
    });
    expect(
      evaluateExternalTaskWriteback({
        policy: "status_and_comments",
        action: "agent_comment",
        humanConfirmed: true,
      }),
    ).toMatchObject({ allowed: true, reason: "allowed" });
  });

  it("honors explicit agent comment modes", () => {
    expect(
      evaluateExternalTaskWriteback({
        policy: "status_and_comments",
        action: "agent_comment",
        config: { agentCommentMode: "disabled" },
      }),
    ).toMatchObject({ allowed: false, reason: "agent_comments_disabled" });
    expect(
      evaluateExternalTaskWriteback({
        policy: "status_and_comments",
        action: "agent_comment",
        config: { allowAgentComments: true },
      }),
    ).toMatchObject({ allowed: true, reason: "allowed" });
  });
});
