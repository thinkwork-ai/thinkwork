/**
 * Real-gateway tests (createLinearGateway) against a stubbed @linear/sdk
 * client matching the SDK's PageOf<T> shape: multi-page drain, comment
 * author-id population, label id resolution, and state name→id lookup.
 */

import { describe, expect, it, vi } from "vitest";

// The stub instance the mocked LinearClient constructor returns; each test
// assigns it before calling createLinearGateway.
let fakeClient: Record<string, unknown>;

vi.mock("@linear/sdk", () => ({
  LinearClient: function LinearClientMock() {
    return fakeClient;
  },
}));

const { createLinearGateway } = await import("../src/linear/client.js");

/**
 * Minimal `client.client` stub so the construction-time rawRequest guard
 * (SDK-shape guard) passes for tests that don't exercise listTeamIssues.
 * Returns an empty single page if it ever were called.
 */
const noopRawClient = {
  rawRequest: async () => ({
    data: { issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
  }),
};

interface Page<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean };
  fetchNext(): Promise<Page<T>>;
}

/** Build a PageOf<T>-shaped chain from chunks (one page per chunk). */
function pages<T>(...chunks: T[][]): Page<T> {
  const make = (i: number): Page<T> => ({
    nodes: chunks[i] ?? [],
    pageInfo: { hasNextPage: i < chunks.length - 1 },
    fetchNext: async () => make(i + 1),
  });
  return make(0);
}

/** A raw-GraphQL issue node (state + labels selected INLINE — no lazy fetch). */
function rawIssueNode(
  id: string,
  identifier: string,
  labels: string[] = [],
  state = "Todo",
) {
  return {
    id,
    identifier,
    title: `Title ${identifier}`,
    description: `Desc ${identifier}`,
    state: { name: state },
    labels: { nodes: labels.map((name) => ({ name })) },
  };
}

/** A rawRequest fake serving pre-baked issue pages (one per chunk). */
function rawRequestFor(...chunks: ReturnType<typeof rawIssueNode>[][]) {
  const calls: Record<string, unknown>[] = [];
  const byCursor = new Map<string | null, number>();
  let cursor: string | null = null;
  for (let i = 0; i < chunks.length; i++) {
    byCursor.set(cursor, i);
    cursor = i < chunks.length - 1 ? `cur-${i}` : null;
  }
  const rawRequest = async (_q: string, vars?: Record<string, unknown>) => {
    calls.push(vars ?? {});
    const after = (vars?.after ?? null) as string | null;
    const i = byCursor.get(after) ?? 0;
    const hasNext = i < chunks.length - 1;
    return {
      data: {
        issues: {
          nodes: chunks[i],
          pageInfo: { hasNextPage: hasNext, endCursor: hasNext ? `cur-${i}` : null },
        },
      },
    };
  };
  return { rawRequest, calls };
}

describe("createLinearGateway — listTeamIssues", () => {
  it("drains multiple candidate pages via one raw request each (state+labels inline)", async () => {
    const raw = rawRequestFor(
      [rawIssueNode("i1", "THINK-1", ["Claude"])],
      [
        rawIssueNode("i2", "THINK-2"),
        rawIssueNode("i3", "THINK-3", ["LFG"], "Verification"),
      ],
    );
    fakeClient = {
      teams: async () => ({ nodes: [{ key: "THINK", id: "team-1" }] }),
      client: { rawRequest: raw.rawRequest },
    };
    const gateway = createLinearGateway("key");

    const issues = await gateway.listTeamIssues("THINK");

    expect(issues.map((i) => i.identifier)).toEqual([
      "THINK-1",
      "THINK-2",
      "THINK-3",
    ]);
    expect(issues[0].labels).toEqual(["Claude"]);
    expect(issues[0].state).toBe("Todo");
    expect(issues[2].labels).toEqual(["LFG"]);
    expect(issues[2].state).toBe("Verification");
    // One raw request PER PAGE — the whole-board drain no longer round-trips.
    expect(raw.calls).toHaveLength(2);
  });

  it("no N+1: a large board costs one request per page, never ~2N per-issue reads", async () => {
    // 250 candidate issues across 3 pages. The pre-U6 gateway N+1'd
    // issue.state + issue.labels() per issue (~500 extra calls); the fixed
    // gateway selects both inline, so there is ONE request per page and NEVER a
    // per-issue client.issue() / state / labels() read.
    const page = (from: number, n: number) =>
      Array.from({ length: n }, (_, k) =>
        rawIssueNode(`i${from + k}`, `THINK-${from + k}`, ["Claude"]),
      );
    const raw = rawRequestFor(page(1, 100), page(101, 100), page(201, 50));
    const issueSpy = vi.fn();
    const teamsSpy = vi.fn(async () => ({
      nodes: [{ key: "THINK", id: "team-1" }],
    }));
    fakeClient = {
      teams: teamsSpy,
      issue: issueSpy, // must NEVER be called (that was the N+1 source)
      client: { rawRequest: raw.rawRequest },
    };
    const gateway = createLinearGateway("key");

    const issues = await gateway.listTeamIssues("THINK");

    expect(issues).toHaveLength(250);
    expect(issueSpy).not.toHaveBeenCalled();
    // Requests == pages (3), NOT ~2N (500+). One team lookup, three page reads.
    expect(raw.calls).toHaveLength(3);
    expect(teamsSpy).toHaveBeenCalledTimes(1);
  });

  it("throws a named error when the team key does not exist", async () => {
    fakeClient = { teams: async () => ({ nodes: [] }), client: noopRawClient };
    const gateway = createLinearGateway("key");
    await expect(gateway.listTeamIssues("NOPE")).rejects.toThrow(
      /team with key "NOPE" not found/,
    );
  });
});

describe("createLinearGateway — listTeamIssues pagination hardening", () => {
  // A bad page (GraphQL error / throttle / partial failure) must ABORT, not
  // silently return a truncated candidate list that looks like success —
  // otherwise an enrolled issue is dropped with no error (under-dispatch).
  it("throws when the FIRST page resolves without a data.issues payload", async () => {
    fakeClient = {
      teams: async () => ({ nodes: [{ key: "THINK", id: "team-1" }] }),
      client: { rawRequest: async () => ({ data: null }) },
    };
    const gateway = createLinearGateway("key");
    await expect(gateway.listTeamIssues("THINK")).rejects.toThrow(
      /truncated candidate set/,
    );
  });

  it("throws mid-pagination when a LATER page loses data.issues (no short list)", async () => {
    let call = 0;
    const rawRequest = async () => {
      call += 1;
      if (call === 1) {
        return {
          data: {
            issues: {
              nodes: [rawIssueNode("i1", "THINK-1", ["Claude"])],
              pageInfo: { hasNextPage: true, endCursor: "cur-0" },
            },
          },
        };
      }
      return { data: null }; // second page fails → must throw, not return [i1]
    };
    fakeClient = {
      teams: async () => ({ nodes: [{ key: "THINK", id: "team-1" }] }),
      client: { rawRequest },
    };
    const gateway = createLinearGateway("key");
    await expect(gateway.listTeamIssues("THINK")).rejects.toThrow(
      /truncated candidate set/,
    );
  });

  it("throws when the response carries a non-empty GraphQL errors array", async () => {
    fakeClient = {
      teams: async () => ({ nodes: [{ key: "THINK", id: "team-1" }] }),
      client: {
        rawRequest: async () => ({
          data: null,
          errors: [{ message: "throttled" }],
        }),
      },
    };
    const gateway = createLinearGateway("key");
    await expect(gateway.listTeamIssues("THINK")).rejects.toThrow(
      /truncated candidate set/,
    );
  });
});

describe("createLinearGateway — SDK-shape startup guard", () => {
  it("throws a clear, NAMED error at construction when client.rawRequest is absent", () => {
    fakeClient = { teams: async () => ({ nodes: [] }) }; // no `client` at all
    let caught: unknown;
    try {
      createLinearGateway("key");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe("LinearSdkShapeError");
    expect((caught as Error).message).toMatch(/rawRequest/);
  });

  it("throws at construction when client.rawRequest is not a function", () => {
    fakeClient = { client: { rawRequest: "nope" } };
    expect(() => createLinearGateway("key")).toThrow(/rawRequest/);
  });
});

describe("createLinearGateway — listComments author ids", () => {
  it("populates authorId from user id, bot actor id, or null", async () => {
    type CommentNode = {
      id: string;
      body: string;
      userId?: string | null;
      botActor?: { id: string } | null;
    };
    fakeClient = {
      client: noopRawClient,
      issue: async () => ({
        comments: async () =>
          pages<CommentNode>(
            [
              { id: "c1", body: "user comment", userId: "u-1", botActor: null },
              { id: "c2", body: "bot comment", botActor: { id: "bot-1" } },
            ],
            [{ id: "c3", body: "authorless comment" }],
          ),
      }),
    };
    const gateway = createLinearGateway("key");

    const comments = await gateway.listComments("i1");

    expect(comments).toEqual([
      { id: "c1", body: "user comment", url: null, authorId: "u-1" },
      { id: "c2", body: "bot comment", url: null, authorId: "bot-1" },
      { id: "c3", body: "authorless comment", url: null, authorId: null },
    ]);
  });
});

describe("createLinearGateway — label mutations", () => {
  function labelHarness(currentLabels: { id: string; name: string }[]) {
    const updateIssue = vi.fn(async () => ({}));
    const issueObj = {
      team: Promise.resolve({
        key: "THINK",
        labels: async () => pages([{ id: "lbl-lfg", name: "LFG" }]),
      }),
      labels: async () => pages(currentLabels),
    };
    fakeClient = { client: noopRawClient, issue: async () => issueObj, updateIssue };
    return { updateIssue };
  }

  it("addLabel resolves the label id on the team and unions it in", async () => {
    const { updateIssue } = labelHarness([{ id: "lbl-claude", name: "Claude" }]);
    const gateway = createLinearGateway("key");

    await gateway.addLabel("i1", "LFG");

    expect(updateIssue).toHaveBeenCalledTimes(1);
    const [issueId, input] = updateIssue.mock.calls[0] as unknown as [
      string,
      { labelIds: string[] },
    ];
    expect(issueId).toBe("i1");
    expect(new Set(input.labelIds)).toEqual(
      new Set(["lbl-claude", "lbl-lfg"]),
    );
  });

  it("addLabel is a no-op when the label is already present", async () => {
    const { updateIssue } = labelHarness([{ id: "lbl-lfg", name: "LFG" }]);
    const gateway = createLinearGateway("key");
    await gateway.addLabel("i1", "LFG");
    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("removeLabel filters the named label out by id", async () => {
    const { updateIssue } = labelHarness([
      { id: "lbl-claude", name: "Claude" },
      { id: "lbl-lfg", name: "LFG" },
    ]);
    const gateway = createLinearGateway("key");

    await gateway.removeLabel("i1", "LFG");

    expect(updateIssue).toHaveBeenCalledWith("i1", {
      labelIds: ["lbl-claude"],
    });
  });

  it("removeLabel is a no-op when the label is absent", async () => {
    const { updateIssue } = labelHarness([{ id: "lbl-claude", name: "Claude" }]);
    const gateway = createLinearGateway("key");
    await gateway.removeLabel("i1", "LFG");
    expect(updateIssue).not.toHaveBeenCalled();
  });

  it("addLabel fails loudly when the label does not exist on the team", async () => {
    labelHarness([]);
    const gateway = createLinearGateway("key");
    await expect(gateway.addLabel("i1", "Nonexistent")).rejects.toThrow(
      /label "Nonexistent" not found/,
    );
  });
});

describe("createLinearGateway — setState", () => {
  function stateHarness() {
    const updateIssue = vi.fn(async () => ({}));
    fakeClient = {
      client: noopRawClient,
      issue: async () => ({
        team: Promise.resolve({
          key: "THINK",
          states: async () =>
            pages(
              [{ id: "st-todo", name: "Todo" }],
              [{ id: "st-verif", name: "Verification" }],
            ),
        }),
      }),
      updateIssue,
    };
    return { updateIssue };
  }

  it("looks the workflow state up by name across pages", async () => {
    const { updateIssue } = stateHarness();
    const gateway = createLinearGateway("key");

    await gateway.setState("i1", "Verification");

    expect(updateIssue).toHaveBeenCalledWith("i1", { stateId: "st-verif" });
  });

  it("fails loudly for an unknown state name", async () => {
    const { updateIssue } = stateHarness();
    const gateway = createLinearGateway("key");
    await expect(gateway.setState("i1", "Nonexistent")).rejects.toThrow(
      /workflow state "Nonexistent" not found/,
    );
    expect(updateIssue).not.toHaveBeenCalled();
  });
});

describe("createLinearGateway — viewerId", () => {
  it("resolves the viewer id once and caches it", async () => {
    let viewerReads = 0;
    fakeClient = {
      client: noopRawClient,
      get viewer() {
        viewerReads++;
        return Promise.resolve({ id: "viewer-1" });
      },
    };
    const gateway = createLinearGateway("key");

    expect(await gateway.viewerId()).toBe("viewer-1");
    expect(await gateway.viewerId()).toBe("viewer-1");
    expect(viewerReads).toBe(1);
  });
});
