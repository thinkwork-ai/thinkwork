import { describe, expect, it, vi } from "vitest";
import {
  fetchLinearIssues,
  moveLinearIssueToState,
  parseLinearIssueQueryConfig,
  postLinearIssueCommentOnce,
} from "./linear.js";

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

describe("moveLinearIssueToState", () => {
  it("resolves the target workflow state by name and updates the issue", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          data: {
            issue: {
              id: "issue-1",
              state: { id: "state-todo", name: "Todo" },
              team: {
                states: {
                  nodes: [
                    { id: "state-todo", name: "Todo" },
                    { id: "state-started", name: "In Progress" },
                  ],
                },
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          data: {
            issueUpdate: {
              success: true,
              issue: {
                id: "issue-1",
                state: { id: "state-started", name: "In Progress" },
              },
            },
          },
        }),
      });

    await expect(
      moveLinearIssueToState({
        apiKey: "lin_api_key",
        issueId: "issue-1",
        stateName: "In Progress",
        fetchImpl,
      }),
    ).resolves.toEqual({
      issueId: "issue-1",
      stateName: "In Progress",
      stateId: "state-started",
      updated: true,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toMatchObject({
      variables: {
        id: "issue-1",
        input: { stateId: "state-started" },
      },
    });
  });

  it("skips the mutation when the issue is already in the target state", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        data: {
          issue: {
            id: "issue-1",
            state: { id: "state-started", name: "In Progress" },
            team: {
              states: {
                nodes: [{ id: "state-started", name: "In Progress" }],
              },
            },
          },
        },
      }),
    });

    await expect(
      moveLinearIssueToState({
        apiKey: "lin_api_key",
        issueId: "issue-1",
        stateName: "In Progress",
        fetchImpl,
      }),
    ).resolves.toEqual({
      issueId: "issue-1",
      stateName: "In Progress",
      stateId: "state-started",
      updated: false,
      skippedReason: "already_in_state",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("postLinearIssueCommentOnce", () => {
  it("creates a comment with a hidden dedupe marker when no matching comment exists", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          data: {
            issue: {
              id: "issue-1",
              comments: { nodes: [{ id: "comment-old", body: "hello" }] },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          data: {
            commentCreate: {
              success: true,
              comment: { id: "comment-new" },
            },
          },
        }),
      });

    await expect(
      postLinearIssueCommentOnce({
        apiKey: "lin_api_key",
        issueId: "issue-1",
        body: "Symphony agent is now working.",
        dedupeMarker: "thinkwork:symphony:dispatch:task-1",
        fetchImpl,
      }),
    ).resolves.toEqual({
      issueId: "issue-1",
      commentId: "comment-new",
      created: true,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toMatchObject({
      variables: {
        input: {
          issueId: "issue-1",
        },
      },
    });
    expect(
      JSON.parse(fetchImpl.mock.calls[1][1].body).variables.input.body,
    ).toContain("<!-- thinkwork:symphony:dispatch:task-1 -->");
  });

  it("skips comment creation when the dedupe marker already exists", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        data: {
          issue: {
            id: "issue-1",
            comments: {
              nodes: [
                {
                  id: "comment-existing",
                  body: "<!-- thinkwork:symphony:pr:task-1 -->",
                },
              ],
            },
          },
        },
      }),
    });

    await expect(
      postLinearIssueCommentOnce({
        apiKey: "lin_api_key",
        issueId: "issue-1",
        body: "PR opened.",
        dedupeMarker: "thinkwork:symphony:pr:task-1",
        fetchImpl,
      }),
    ).resolves.toEqual({
      issueId: "issue-1",
      created: false,
      skippedReason: "duplicate_marker",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
