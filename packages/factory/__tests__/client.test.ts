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

function issueNode(id: string, identifier: string, labels: string[] = []) {
  return {
    id,
    identifier,
    title: `Title ${identifier}`,
    description: `Desc ${identifier}`,
    state: Promise.resolve({ name: "Todo" }),
    labels: async () => pages(labels.map((name) => ({ name }))),
  };
}

describe("createLinearGateway — listTeamIssues", () => {
  it("drains multiple pages of team issues", async () => {
    const team = {
      key: "THINK",
      issues: async () =>
        pages(
          [issueNode("i1", "THINK-1", ["Claude"])],
          [issueNode("i2", "THINK-2"), issueNode("i3", "THINK-3", ["LFG"])],
        ),
    };
    fakeClient = { teams: async () => ({ nodes: [team] }) };
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
  });

  it("throws a named error when the team key does not exist", async () => {
    fakeClient = { teams: async () => ({ nodes: [] }) };
    const gateway = createLinearGateway("key");
    await expect(gateway.listTeamIssues("NOPE")).rejects.toThrow(
      /team with key "NOPE" not found/,
    );
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
      { id: "c1", body: "user comment", authorId: "u-1" },
      { id: "c2", body: "bot comment", authorId: "bot-1" },
      { id: "c3", body: "authorless comment", authorId: null },
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
    fakeClient = { issue: async () => issueObj, updateIssue };
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
