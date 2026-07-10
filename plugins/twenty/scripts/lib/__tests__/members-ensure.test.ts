import { describe, expect, it, vi } from "vitest";

import { ensureMembers, type RepToProvision } from "../members-ensure";
import type { TwentyClient } from "../twenty-client";

function rep(overrides: Partial<RepToProvision> = {}): RepToProvision {
  return {
    repId: "rep_1",
    email: "jane@tei.com",
    firstName: "Jane",
    lastName: "Doe",
    archived: false,
    ...overrides,
  };
}

function dataClientWithMembers(
  members: Array<{ id: string; userEmail: string }>,
): TwentyClient {
  return {
    requestWithRetry: vi.fn(async () => ({
      workspaceMembers: {
        edges: members.map((member) => ({ node: member })),
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    })),
    endpoint: (path: string) => `https://crm.example.com${path}`,
  } as unknown as TwentyClient;
}

describe("ensureMembers (matches existing members; never creates)", () => {
  it("maps reps onto members by email, case-insensitively", async () => {
    const dataClient = dataClientWithMembers([
      { id: "wm-1", userEmail: "Jane@TEI.com" },
    ]);
    const result = await ensureMembers({ dataClient, reps: [rep()] });
    expect(result.ownerMap.get("rep_1")).toBe("wm-1");
    expect(result.report[0]).toMatchObject({ action: "existing" });
    expect(result.missingMembers).toBe(0);
  });

  it("reports a rep with no Twenty member instead of failing the run", async () => {
    // provision-twenty-members.ts creates members; this module only matches
    // them. Records for an unmatched rep load ownerless and heal on a re-run.
    const dataClient = dataClientWithMembers([]);
    const result = await ensureMembers({ dataClient, reps: [rep()] });
    expect(result.ownerMap.size).toBe(0);
    expect(result.report[0]).toMatchObject({ action: "missing-member" });
    expect(result.missingMembers).toBe(1);
    expect(result.hadFailures).toBe(false);
  });

  it("marks emailless reps unprovisionable and keeps going", async () => {
    const dataClient = dataClientWithMembers([
      { id: "wm-bob", userEmail: "bob@tei.com" },
    ]);
    const result = await ensureMembers({
      dataClient,
      reps: [
        rep({ email: null }),
        rep({ repId: "rep_2", email: "bob@tei.com" }),
      ],
    });
    expect(result.report[0]).toMatchObject({
      repId: "rep_1",
      action: "unprovisionable",
    });
    expect(result.ownerMap.get("rep_2")).toBe("wm-bob");
  });

  it("collapses reps sharing an email onto one login, and says so", async () => {
    const dataClient = dataClientWithMembers([
      { id: "wm-jane", userEmail: "jane@tei.com" },
    ]);
    const result = await ensureMembers({
      dataClient,
      reps: [
        rep(),
        rep({ repId: "rep_2", firstName: "Employee", lastName: "Accounts" }),
      ],
    });
    expect(result.ownerMap.get("rep_1")).toBe("wm-jane");
    expect(result.ownerMap.get("rep_2")).toBe("wm-jane");
    expect(result.report.find((row) => row.repId === "rep_2")).toMatchObject({
      action: "merged-duplicate-email",
    });
  });

  it("leaves a merged rep unmapped when its primary has no member either", async () => {
    const dataClient = dataClientWithMembers([]);
    const result = await ensureMembers({
      dataClient,
      reps: [rep(), rep({ repId: "rep_2" })],
    });
    expect(result.ownerMap.size).toBe(0);
    expect(result.missingMembers).toBe(1);
  });
});
