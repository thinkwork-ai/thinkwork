/**
 * Slack approval notification tests (THINK-302 U16 — R12, KTD-5).
 * The point: no raw argument values ever appear in the Slack text.
 */

import { describe, expect, it } from "vitest";
import { buildRedactedApprovalSummary } from "../tool-approvals/redact.js";
import {
  formatApprovalRequestSlackText,
  formatApprovalResolutionSlackText,
} from "./approval-notification.js";

const summary = buildRedactedApprovalSummary({
  toolName: "dagster_launch_run",
  callId: "toolu_1",
  class: "mcp",
  slug: "dagster",
  requestedBy: "Dana",
  args: { pipeline: "nightly_etl", token: "ghp_abcdefghijklmnop1234" },
});

describe("formatApprovalRequestSlackText", () => {
  it("names the tool + requester and includes the deep link", () => {
    const text = formatApprovalRequestSlackText({
      summary,
      deepLinkUrl: "https://app.thinkwork.ai/threads/t-1?approval=a-1",
    });
    expect(text).toContain("Approval needed");
    expect(text).toContain("dagster_launch_run (mcp/dagster)");
    expect(text).toContain("requested by Dana");
    expect(text).toContain("https://app.thinkwork.ai/threads/t-1?approval=a-1");
  });

  it("never leaks raw argument values or secrets", () => {
    const text = formatApprovalRequestSlackText({
      summary,
      deepLinkUrl: "https://app.thinkwork.ai/threads/t-1",
    });
    expect(text).not.toContain("nightly_etl");
    expect(text).not.toContain("ghp_");
    // The secret-shaped arg is flagged, not echoed.
    expect(text).toContain("token<string:secret-like>");
  });
});

describe("formatApprovalResolutionSlackText", () => {
  it("names the resolver, action, and channel of resolution", () => {
    const approved = formatApprovalResolutionSlackText({
      action: "approve",
      resolverName: "Eric",
      resolvedVia: "the web app",
      summary,
    });
    expect(approved).toContain("dagster_launch_run (mcp/dagster)");
    expect(approved).toContain("was approved by Eric via the web app");

    const denied = formatApprovalResolutionSlackText({
      action: "deny",
      resolverName: "Eric",
      summary,
    });
    expect(denied).toContain("was denied by Eric");

    const cancelled = formatApprovalResolutionSlackText({
      action: "cancel",
      resolverName: "Dana",
      summary,
    });
    expect(cancelled).toContain("was cancelled by Dana");
  });

  it("resolution text is also value-free", () => {
    const text = formatApprovalResolutionSlackText({
      action: "approve",
      resolverName: "Eric",
      summary,
    });
    expect(text).not.toContain("nightly_etl");
    expect(text).not.toContain("ghp_");
  });
});
