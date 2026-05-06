import { describe, expect, it, vi } from "vitest";
import { fetchLinearIssues, parseLinearIssueQueryConfig } from "./linear.js";

describe("parseLinearIssueQueryConfig", () => {
  it("extracts credential and symphony label filters from connector config", () => {
    expect(
      parseLinearIssueQueryConfig({
        provider: "linear",
        sourceKind: "tracker_issue",
        credentialSlug: "linear",
        issueQuery: {
          teamKey: "TW",
          labels: ["symphony"],
          states: [],
          limit: 10,
        },
      }),
    ).toEqual({
      credentialId: undefined,
      credentialSlug: "linear",
      teamId: undefined,
      teamKey: "TW",
      labels: ["symphony"],
      states: [],
      limit: 10,
    });
  });

  it("returns null when no credential handle is configured", () => {
    expect(
      parseLinearIssueQueryConfig({
        issueQuery: { labels: ["symphony"] },
      }),
    ).toBeNull();
  });
});

describe("fetchLinearIssues", () => {
  it("calls Linear GraphQL with API-key auth and maps issues", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        data: {
          issues: {
            nodes: [
              {
                id: "issue-1",
                identifier: "SYM-1",
                title: "Pick up a task",
                description: "Do the thing",
                url: "https://linear.app/thinkwork/issue/SYM-1",
                priority: 1,
                state: { name: "Todo" },
                labels: {
                  nodes: [{ name: "symphony" }],
                },
              },
            ],
          },
        },
      }),
    });

    const issues = await fetchLinearIssues({
      apiKey: "lin_api_key",
      query: {
        credentialSlug: "linear",
        teamKey: "TW",
        labels: ["symphony"],
        states: [],
        limit: 10,
      },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.linear.app/graphql",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "lin_api_key",
        },
      }),
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      variables: {
        first: 10,
        filter: {
          team: { key: { eqIgnoreCase: "TW" } },
          labels: { name: { eqIgnoreCase: "symphony" } },
        },
      },
    });
    expect(issues).toEqual([
      {
        id: "issue-1",
        identifier: "SYM-1",
        title: "Pick up a task",
        description: "Do the thing",
        url: "https://linear.app/thinkwork/issue/SYM-1",
        state: "Todo",
        labels: ["symphony"],
        priority: 1,
        createdAt: null,
        updatedAt: null,
      },
    ]);
  });

  it("surfaces GraphQL errors", async () => {
    await expect(
      fetchLinearIssues({
        apiKey: "lin_api_key",
        query: {
          credentialSlug: "linear",
          labels: ["symphony"],
          states: [],
          limit: 10,
        },
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ errors: [{ message: "Bad filter" }] }),
        }),
      }),
    ).rejects.toThrow("Linear API error: Bad filter");
  });
});
