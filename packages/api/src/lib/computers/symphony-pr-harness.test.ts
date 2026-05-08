import { describe, expect, it, vi } from "vitest";
import {
  computerDelegations,
  computerEvents,
  connectorExecutions,
  messages,
  threadTurns,
} from "@thinkwork/database-pg/schema";
import { runSymphonyPrConnectorWork } from "./symphony-pr-harness.js";

describe("runSymphonyPrConnectorWork", () => {
  it("opens a deterministic draft PR, comments on Linear, moves to review, and records lifecycle metadata", async () => {
    const db = fakeHarnessDb();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(linearResponse(linearComments([])))
      .mockResolvedValueOnce(linearResponse(linearCommentCreated("comment-1")))
      .mockResolvedValueOnce(githubNotFound())
      .mockResolvedValueOnce(githubResponse({ object: { sha: "base-sha" } }))
      .mockResolvedValueOnce(githubResponse({}))
      .mockResolvedValueOnce(
        githubResponse({
          content: Buffer.from("# ThinkWork\n", "utf8").toString("base64"),
          encoding: "base64",
          sha: "file-sha",
        }),
      )
      .mockResolvedValueOnce(githubResponse({ commit: { sha: "commit-sha" } }))
      .mockResolvedValueOnce(githubResponse([]))
      .mockResolvedValueOnce(
        githubResponse({
          number: 123,
          html_url: "https://github.com/thinkwork-ai/thinkwork/pull/123",
        }),
      )
      .mockResolvedValueOnce(linearResponse(linearComments([])))
      .mockResolvedValueOnce(linearResponse(linearCommentCreated("comment-2")))
      .mockResolvedValueOnce(linearResponse(linearIssueState("Todo")))
      .mockResolvedValueOnce(
        linearResponse({ data: { issueUpdate: { success: true } } }),
      );

    const result = await runSymphonyPrConnectorWork(
      {
        tenantId: "tenant-1",
        computerId: "computer-1",
        taskId: "task-1111-2222-3333-4444",
        delegationId: "delegation-1",
        agentId: "agent-1",
        threadId: "thread-1",
        messageId: "message-1",
        payload: {
          connectorId: "connector-1",
          connectorExecutionId: "execution-1",
          externalRef: "linear-issue-id",
          title: "Update README",
          body: "Add a README checkpoint.",
          metadata: {
            linear: {
              identifier: "TECH-70",
              url: "https://linear.app/team/issue/TECH-70/update-readme",
            },
          },
        },
      },
      {
        db: db as any,
        fetchImpl,
        readSecret: async (secretRef) =>
          secretRef === "linear-secret"
            ? { apiKey: "lin_api_key" }
            : { token: "github-token" },
        now: () => new Date("2026-05-08T00:00:00.000Z"),
      },
    );

    expect(result).toMatchObject({
      handled: true,
      branch: "symphony/tech-70/task1111",
      commitSha: "commit-sha",
      prUrl: "https://github.com/thinkwork-ai/thinkwork/pull/123",
      prNumber: 123,
    });
    const githubWrite = fetchImpl.mock.calls.find(
      ([url, options]) =>
        url ===
          "https://api.github.com/repos/thinkwork-ai/thinkwork/contents/README.md" &&
        options?.method === "PUT",
    );
    expect(githubWrite).toBeTruthy();
    const githubWriteBody = JSON.parse(String(githubWrite?.[1]?.body));
    expect(
      Buffer.from(String(githubWriteBody.content), "base64").toString("utf8"),
    ).toContain("Symphony checkpoint: TECH-70");
    expect(linearRequestBodies(fetchImpl)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variables: expect.objectContaining({
            input: expect.objectContaining({
              body: expect.stringContaining(
                "Symphony agent is now working on this issue",
              ),
            }),
          }),
        }),
        expect.objectContaining({
          variables: expect.objectContaining({
            input: expect.objectContaining({
              body: expect.stringContaining(
                "Symphony agent opened a draft PR for this issue",
              ),
            }),
          }),
        }),
        expect.objectContaining({
          variables: {
            id: "linear-issue-id",
            input: { stateId: "state-review" },
          },
        }),
      ]),
    );
    expect(db.insertsFor(threadTurns)).toHaveLength(1);
    expect(db.insertsFor(messages)[0]?.content).toContain(
      "https://github.com/thinkwork-ai/thinkwork/pull/123",
    );
    expect(db.insertsFor(computerEvents)[0]?.event_type).toBe(
      "connector_work_pr_opened",
    );
    expect(db.updatesFor(computerDelegations)[0]).toMatchObject({
      status: "completed",
      output_artifacts: expect.objectContaining({
        mode: "symphony_pr_harness",
        prUrl: "https://github.com/thinkwork-ai/thinkwork/pull/123",
        threadTurnId: "thread-turn-1",
      }),
    });
    expect(db.updatesFor(connectorExecutions)[0]).toMatchObject({
      outcome_payload: expect.objectContaining({
        providerWriteback: expect.objectContaining({
          provider: "linear",
          stateName: "In Review",
          prUrl: "https://github.com/thinkwork-ai/thinkwork/pull/123",
        }),
        symphony: expect.objectContaining({
          branch: "symphony/tech-70/task1111",
          prUrl: "https://github.com/thinkwork-ai/thinkwork/pull/123",
          threadTurnId: "thread-turn-1",
        }),
      }),
    });
  });

  it("reuses existing checkpoint content without creating another commit", async () => {
    const db = fakeHarnessDb();
    const existingContent = [
      "# ThinkWork",
      "",
      "<!-- thinkwork-symphony:TECH-70:start -->",
      "## Symphony checkpoint: TECH-70",
      "",
      "- Linear issue: TECH-70",
      "- Title: Update README",
      "- URL: https://linear.app/team/issue/TECH-70/update-readme",
      "- Connector task: task-1111-2222-3333-4444",
      "<!-- thinkwork-symphony:TECH-70:end -->",
      "",
    ].join("\n");
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        linearResponse(
          linearComments([
            {
              body: "<!-- thinkwork:symphony:dispatch:task-1111-2222-3333-4444 -->",
            },
          ]),
        ),
      )
      .mockResolvedValueOnce(githubResponse({ object: { sha: "branch-sha" } }))
      .mockResolvedValueOnce(
        githubResponse({
          content: Buffer.from(existingContent, "utf8").toString("base64"),
          encoding: "base64",
          sha: "file-sha",
        }),
      )
      .mockResolvedValueOnce(githubResponse({ object: { sha: "branch-sha" } }))
      .mockResolvedValueOnce(
        githubResponse([
          {
            number: 123,
            html_url: "https://github.com/thinkwork-ai/thinkwork/pull/123",
          },
        ]),
      )
      .mockResolvedValueOnce(
        linearResponse(
          linearComments([
            { body: "<!-- thinkwork:symphony:pr:task-1111-2222-3333-4444 -->" },
          ]),
        ),
      )
      .mockResolvedValueOnce(linearResponse(linearIssueState("In Review")));

    await runSymphonyPrConnectorWork(
      {
        tenantId: "tenant-1",
        computerId: "computer-1",
        taskId: "task-1111-2222-3333-4444",
        delegationId: "delegation-1",
        agentId: "agent-1",
        threadId: "thread-1",
        messageId: "message-1",
        payload: {
          connectorId: "connector-1",
          connectorExecutionId: "execution-1",
          externalRef: "linear-issue-id",
          title: "Update README",
          body: "Add a README checkpoint.",
          metadata: {
            linear: {
              identifier: "TECH-70",
              url: "https://linear.app/team/issue/TECH-70/update-readme",
            },
          },
        },
      },
      {
        db: db as any,
        fetchImpl,
        readSecret: async (secretRef) =>
          secretRef === "linear-secret"
            ? { apiKey: "lin_api_key" }
            : { token: "github-token" },
      },
    );

    const githubWrites = fetchImpl.mock.calls.filter(
      ([url, options]) =>
        String(url).includes("api.github.com") && options?.method === "PUT",
    );
    expect(githubWrites).toHaveLength(0);
    expect(db.updatesFor(computerDelegations)[0]).toMatchObject({
      status: "completed",
      output_artifacts: expect.objectContaining({ commitSha: "branch-sha" }),
    });
  });
});

function fakeHarnessDb() {
  const inserted: Array<{ table: unknown; values: Record<string, unknown> }> =
    [];
  const updated: Array<{ table: unknown; values: Record<string, unknown> }> =
    [];
  const selectResults = [
    [
      {
        id: "connector-1",
        type: "linear_tracker",
        config: {
          credentialSlug: "linear",
          github: {
            credentialSlug: "github",
            owner: "thinkwork-ai",
            repoName: "thinkwork",
            baseBranch: "main",
            filePath: "README.md",
          },
          writeback: { moveOnPrOpened: { stateName: "In Review" } },
        },
      },
    ],
    [
      {
        id: "linear-credential",
        status: "active",
        secret_ref: "linear-secret",
      },
    ],
    [
      {
        id: "github-credential",
        status: "active",
        secret_ref: "github-secret",
      },
    ],
    [{ outcome_payload: { providerWriteback: { status: "updated" } } }],
  ];
  const db = {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectResults.shift() ?? []),
        }),
      }),
    })),
    insert: vi.fn((table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserted.push({ table, values });
        return {
          returning: () =>
            Promise.resolve(
              table === threadTurns
                ? [{ id: "thread-turn-1" }]
                : [{ id: "inserted-1", agent_id: "agent-1" }],
            ),
        };
      },
    })),
    update: vi.fn((table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updated.push({ table, values });
        return { where: () => Promise.resolve([]) };
      },
    })),
    insertsFor: (table: unknown) =>
      inserted
        .filter((entry) => entry.table === table)
        .map((entry) => entry.values),
    updatesFor: (table: unknown) =>
      updated
        .filter((entry) => entry.table === table)
        .map((entry) => entry.values),
  };
  return db;
}

function linearRequestBodies(fetchImpl: ReturnType<typeof vi.fn>) {
  return fetchImpl.mock.calls
    .filter(([url]) => url === "https://api.linear.app/graphql")
    .map(([, options]) => JSON.parse(String(options?.body)));
}

function linearComments(nodes: Array<{ body: string }>) {
  return {
    data: {
      issue: {
        id: "linear-issue-id",
        comments: { nodes },
      },
    },
  };
}

function linearCommentCreated(id: string) {
  return {
    data: { commentCreate: { success: true, comment: { id } } },
  };
}

function linearIssueState(name: string) {
  return {
    data: {
      issue: {
        id: "linear-issue-id",
        state: { id: "state-current", name },
        team: {
          states: {
            nodes: [
              { id: "state-todo", name: "Todo" },
              { id: "state-review", name: "In Review" },
            ],
          },
        },
      },
    },
  };
}

function linearResponse(payload: unknown) {
  return response(payload);
}

function githubResponse(payload: unknown) {
  return response(payload);
}

function githubNotFound() {
  return {
    ok: false,
    status: 404,
    statusText: "Not Found",
    json: async () => ({}),
    text: async () => "not found",
  };
}

function response(payload: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}
