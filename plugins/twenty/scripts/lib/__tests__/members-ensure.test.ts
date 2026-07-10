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

describe("ensureMembers (dry run)", () => {
  it("three reps, one already a member → one existing + two planned, map holds the existing", async () => {
    const dataClient = dataClientWithMembers([
      { id: "wm-1", userEmail: "Jane@TEI.com" },
    ]);
    const result = await ensureMembers({
      dataClient,
      adminClient: null,
      reps: [
        rep(),
        rep({ repId: "rep_2", email: "bob@tei.com" }),
        rep({ repId: "rep_3", email: "amy@tei.com" }),
      ],
      repPassword: "test",
      workspaceId: null,
      dryRun: true,
    });
    expect(result.ownerMap.get("rep_1")).toBe("wm-1");
    expect(
      result.report.filter((row) => row.action === "planned"),
    ).toHaveLength(2);
    expect(result.hadFailures).toBe(false);
  });

  it("reps without an email are unprovisionable and the run continues", async () => {
    const dataClient = dataClientWithMembers([]);
    const result = await ensureMembers({
      dataClient,
      adminClient: null,
      reps: [
        rep({ email: null }),
        rep({ repId: "rep_2", email: "bob@tei.com" }),
      ],
      repPassword: "test",
      workspaceId: null,
      dryRun: true,
    });
    expect(result.report[0]).toMatchObject({
      repId: "rep_1",
      action: "unprovisionable",
    });
    expect(result.report[1]).toMatchObject({
      repId: "rep_2",
      action: "planned",
    });
  });

  it("duplicate emails collapse to one login; both rep ids map to the same member", async () => {
    // Observed live in LastMile: a "house" sales_rep row reusing a real rep's
    // email. Email is the login identity, so the reps merge — reported, never
    // silent.
    const dataClient = dataClientWithMembers([
      { id: "wm-jane", userEmail: "jane@tei.com" },
    ]);
    const result = await ensureMembers({
      dataClient,
      adminClient: null,
      reps: [
        rep(),
        rep({ repId: "rep_2", firstName: "Employee", lastName: "Accounts" }),
      ],
      repPassword: "test",
      workspaceId: null,
      dryRun: true,
    });
    expect(result.ownerMap.get("rep_1")).toBe("wm-jane");
    expect(result.ownerMap.get("rep_2")).toBe("wm-jane");
    expect(result.report.find((row) => row.repId === "rep_2")).toMatchObject({
      action: "merged-duplicate-email",
    });
  });
});

describe("ensureMembers (apply)", () => {
  it("requires the admin client when new members must be provisioned", async () => {
    const dataClient = dataClientWithMembers([]);
    await expect(
      ensureMembers({
        dataClient,
        adminClient: null,
        reps: [rep()],
        repPassword: "test",
        workspaceId: "ws-1",
        dryRun: false,
      }),
    ).rejects.toThrow(/TWENTY_ADMIN_EMAIL/);
  });

  it("a signUpInWorkspace rejection is reported per-user and the run continues", async () => {
    const membersAfterSignup = [{ id: "wm-bob", userEmail: "bob@tei.com" }];
    let listCalls = 0;
    const dataClient = {
      requestWithRetry: vi.fn(async () => {
        listCalls += 1;
        return {
          workspaceMembers: {
            // First list: empty; lists after signup include bob only.
            edges: (listCalls === 1 ? [] : membersAfterSignup).map(
              (member) => ({
                node: member,
              }),
            ),
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        };
      }),
      endpoint: (path: string) => `https://crm.example.com${path}`,
    } as unknown as TwentyClient;

    const adminClient = {
      requestOnce: vi.fn(async () => ({
        sendInvitations: { success: true, result: [] },
      })),
      requestWithRetry: vi.fn(async (_path: string, query: string) => {
        if (query.includes("findWorkspaceInvitations")) {
          return {
            findWorkspaceInvitations: [
              { id: "inv-jane", email: "jane@tei.com" },
              { id: "inv-bob", email: "bob@tei.com" },
            ],
          };
        }
        return { getWorkspaceInvitationToken: "token-123" };
      }),
    } as unknown as TwentyClient;

    // jane's signup fails (fetch mock), bob's succeeds.
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          variables?: { email?: string };
        };
        if (body.variables?.email === "jane@tei.com") {
          return new Response(
            JSON.stringify({ errors: [{ message: "invite token invalid" }] }),
            {
              status: 200,
            },
          );
        }
        return new Response(
          JSON.stringify({ data: { signUpInWorkspace: {} } }),
          { status: 200 },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await ensureMembers({
        dataClient,
        adminClient,
        reps: [rep(), rep({ repId: "rep_2", email: "bob@tei.com" })],
        repPassword: "test",
        workspaceId: "ws-1",
        dryRun: false,
      });
      expect(result.hadFailures).toBe(true);
      expect(result.report.find((row) => row.repId === "rep_1")).toMatchObject({
        action: "failed",
      });
      expect(result.report.find((row) => row.repId === "rep_2")).toMatchObject({
        action: "invited+signedUp",
      });
      expect(result.ownerMap.get("rep_2")).toBe("wm-bob");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
