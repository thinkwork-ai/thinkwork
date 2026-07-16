/**
 * Tool-approval redaction tests (THINK-302 U11 — R12, KTD-5).
 * The point: raw argument VALUES are unrepresentable in the summary.
 */

import { describe, expect, it } from "vitest";
import {
  buildRedactedApprovalSummary,
  formatApprovalSummaryLine,
} from "./redact.js";

const base = {
  toolName: "dagster_launch_run",
  callId: "toolu_1",
  class: "mcp",
  slug: "dagster",
  requestedBy: "Dana",
};

describe("buildRedactedApprovalSummary", () => {
  it("emits value-free arg hints (keys + types, never values)", () => {
    const summary = buildRedactedApprovalSummary({
      ...base,
      args: { pipeline: "nightly_etl", dry_run: false, retries: 3 },
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("nightly_etl");
    expect(summary.argHints).toEqual([
      { key: "pipeline", type: "string", sizeBucket: "small" },
      { key: "dry_run", type: "boolean" },
      { key: "retries", type: "number" },
    ]);
  });

  it("flags a secret-shaped value without echoing it", () => {
    const summary = buildRedactedApprovalSummary({
      ...base,
      args: { token: "ghp_abcdefghijklmnop1234" },
    });
    expect(JSON.stringify(summary)).not.toContain("ghp_abcdefghijklmnop1234");
    expect(summary.argHints[0]).toMatchObject({
      key: "token",
      type: "string",
      secretLike: true,
    });
  });

  it("summarizes nested structures by count, never content", () => {
    const summary = buildRedactedApprovalSummary({
      ...base,
      args: {
        rows: [1, 2, 3],
        config: { a: 1, b: 2 },
      },
    });
    expect(JSON.stringify(summary)).not.toContain('"a"');
    expect(summary.argHints).toEqual([
      { key: "rows", type: "array", count: 3, sizeBucket: "small" },
      { key: "config", type: "object", count: 2, sizeBucket: "small" },
    ]);
  });

  it("caps the arg list and records the omitted count", () => {
    const args: Record<string, number> = {};
    for (let i = 0; i < 30; i++) args[`k${i}`] = i;
    const summary = buildRedactedApprovalSummary({ ...base, args });
    expect(summary.argHints.length).toBe(24);
    expect(summary.argsOmitted).toBe(6);
  });

  it("handles positional (array) args by count", () => {
    const summary = buildRedactedApprovalSummary({
      ...base,
      args: ["a", "b"],
    });
    expect(summary.argHints).toEqual([
      { key: "(positional)", type: "array", count: 2 },
    ]);
  });

  it("truncates an over-long key", () => {
    const longKey = "x".repeat(200);
    const summary = buildRedactedApprovalSummary({
      ...base,
      args: { [longKey]: "v" },
    });
    expect(summary.argHints[0]!.key.length).toBeLessThanOrEqual(81);
    expect(summary.argHints[0]!.key.endsWith("…")).toBe(true);
  });
});

describe("formatApprovalSummaryLine", () => {
  it("renders a value-free one-liner for Slack/logs", () => {
    const line = formatApprovalSummaryLine(
      buildRedactedApprovalSummary({
        ...base,
        args: { pipeline: "nightly_etl", token: "ghp_abcdefghijklmnop1234" },
      }),
    );
    expect(line).toContain("dagster_launch_run (mcp/dagster)");
    expect(line).toContain("requested by Dana");
    expect(line).toContain("pipeline<string>");
    expect(line).toContain("token<string:secret-like>");
    expect(line).not.toContain("nightly_etl");
    expect(line).not.toContain("ghp_");
  });

  it("says 'no arguments' for an empty call", () => {
    const line = formatApprovalSummaryLine(
      buildRedactedApprovalSummary({ ...base, args: {} }),
    );
    expect(line).toContain("no arguments");
  });
});
