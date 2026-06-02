import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils.js", () => ({
  and: vi.fn(),
  db: {},
  eq: vi.fn(),
  threadTurns: {
    id: "id",
    tenant_id: "tenant_id",
    started_at: "started_at",
    finished_at: "finished_at",
    created_at: "created_at",
  },
}));

import { normalizeInvocationTimestamp } from "./turnInvocationLogs.query.js";

describe("normalizeInvocationTimestamp", () => {
  it("passes valid AWSDateTime strings through as ISO timestamps", () => {
    expect(
      normalizeInvocationTimestamp("2026-06-02T16:56:55.123Z", undefined),
    ).toBe("2026-06-02T16:56:55.123Z");
  });

  it("normalizes numeric epoch timestamps before GraphQL serializes them", () => {
    expect(normalizeInvocationTimestamp(1_780_419_415_000, undefined)).toBe(
      "2026-06-02T16:56:55.000Z",
    );
  });

  it("falls back to the CloudWatch event timestamp for malformed values", () => {
    expect(normalizeInvocationTimestamp("not-a-date", 1_780_419_415_000)).toBe(
      "2026-06-02T16:56:55.000Z",
    );
  });
});
