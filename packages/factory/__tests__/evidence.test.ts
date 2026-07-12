import { describe, expect, it } from "vitest";

import type { LinearCommentSnapshot } from "../src/linear/client.js";
import { handoffMarker } from "../src/phases/prompts.js";
import {
  createGhCliGateway,
  detectPhaseEvidence,
  type GithubGateway,
  type PrInfo,
} from "../src/phases/evidence.js";

const ID = "T-7";

function comment(id: string, body: string): LinearCommentSnapshot {
  return { id, body };
}

function fakeGithub(prs: PrInfo[]): GithubGateway {
  return { prsForBranch: async () => prs };
}

describe("detectPhaseEvidence — batons and status moves", () => {
  it("implement completes when the Verification baton is posted after launch", async () => {
    const evidence = await detectPhaseEvidence({
      phase: "implement",
      issueIdentifier: ID,
      statusAtLaunch: "In Progress",
      currentStatus: "In Progress",
      comments: [comment("c2", `${handoffMarker(ID, "Verification")}\nQA brief`)],
      commentIdsAtLaunch: new Set(["c1"]),
    });
    expect(evidence).toMatchObject({ complete: true, kind: "baton-posted" });
  });

  it("a stale pre-launch baton does NOT complete the phase", async () => {
    const evidence = await detectPhaseEvidence({
      phase: "implement",
      issueIdentifier: ID,
      statusAtLaunch: "In Progress",
      currentStatus: "In Progress",
      comments: [comment("c1", `${handoffMarker(ID, "Verification")}\nold`)],
      commentIdsAtLaunch: new Set(["c1"]),
    });
    expect(evidence.complete).toBe(false);
  });

  it("implement completes when status moved to Verification", async () => {
    const evidence = await detectPhaseEvidence({
      phase: "implement",
      issueIdentifier: ID,
      statusAtLaunch: "In Progress",
      currentStatus: "Verification",
      comments: [],
    });
    expect(evidence).toMatchObject({ complete: true, kind: "status-moved" });
  });

  it("brainstorm completes on move to Requirements Review (non-LFG stop)", async () => {
    const evidence = await detectPhaseEvidence({
      phase: "brainstorm",
      issueIdentifier: ID,
      statusAtLaunch: "Brainstorming",
      currentStatus: "Requirements Review",
      comments: [],
    });
    expect(evidence.complete).toBe(true);
  });

  it("verify: move to Done is a pass, rebound to Ready to Work is a completed phase with fail outcome", async () => {
    const pass = await detectPhaseEvidence({
      phase: "verify",
      issueIdentifier: ID,
      statusAtLaunch: "Verification",
      currentStatus: "Done",
      comments: [],
    });
    expect(pass).toMatchObject({ complete: true, outcome: "pass" });

    const fail = await detectPhaseEvidence({
      phase: "verify",
      issueIdentifier: ID,
      statusAtLaunch: "Verification",
      currentStatus: "Ready to Work",
      comments: [],
    });
    expect(fail).toMatchObject({ complete: true, outcome: "fail" });
  });

  it("a move to an unexpected status is NOT completion evidence", async () => {
    const evidence = await detectPhaseEvidence({
      phase: "implement",
      issueIdentifier: ID,
      statusAtLaunch: "In Progress",
      currentStatus: "Backlog",
      comments: [],
    });
    expect(evidence.complete).toBe(false);
  });
});

describe("detectPhaseEvidence — compound", () => {
  it("completes when the ledger compounded flag is set", async () => {
    const evidence = await detectPhaseEvidence({
      phase: "compound",
      issueIdentifier: ID,
      statusAtLaunch: "Done",
      currentStatus: "Done",
      comments: [],
      ledgerCompounded: true,
    });
    expect(evidence).toMatchObject({ complete: true, kind: "compounded" });
  });

  it("incomplete without the flag or a merged docs PR", async () => {
    const evidence = await detectPhaseEvidence({
      phase: "compound",
      issueIdentifier: ID,
      statusAtLaunch: "Done",
      currentStatus: "Done",
      comments: [],
      ledgerCompounded: false,
    });
    expect(evidence.complete).toBe(false);
  });
});

describe("detectPhaseEvidence — GitHub PR evidence", () => {
  it("a merged PR for the attempt branch completes the phase", async () => {
    const evidence = await detectPhaseEvidence({
      phase: "implement",
      issueIdentifier: ID,
      statusAtLaunch: "In Progress",
      currentStatus: "In Progress",
      comments: [],
      branch: "auto/t-7-implement-a1",
      github: fakeGithub([
        {
          number: 12,
          state: "MERGED",
          url: "https://github.com/x/y/pull/12",
          mergedAt: "2026-07-12T00:00:00Z",
        },
      ]),
    });
    expect(evidence).toMatchObject({ complete: true, kind: "pr-merged" });
  });

  it("an OPEN PR is not completion evidence", async () => {
    const evidence = await detectPhaseEvidence({
      phase: "implement",
      issueIdentifier: ID,
      statusAtLaunch: "In Progress",
      currentStatus: "In Progress",
      comments: [],
      branch: "auto/t-7-implement-a1",
      github: fakeGithub([
        {
          number: 12,
          state: "OPEN",
          url: "https://github.com/x/y/pull/12",
          mergedAt: null,
        },
      ]),
    });
    expect(evidence.complete).toBe(false);
  });
});

describe("createGhCliGateway", () => {
  it("invokes gh pr list with the branch and parses the JSON result", async () => {
    const calls: { cmd: string; args: string[]; cwd?: string }[] = [];
    const gateway = createGhCliGateway({
      repoDir: "/repo",
      execFileFn: async (cmd, args, opts) => {
        calls.push({ cmd, args, cwd: opts?.cwd });
        return {
          stdout: JSON.stringify([
            {
              number: 3,
              state: "MERGED",
              url: "https://github.com/x/y/pull/3",
              mergedAt: "2026-07-12T01:00:00Z",
            },
          ]),
        };
      },
    });
    const prs = await gateway.prsForBranch("auto/t-7-implement-a1");
    expect(prs).toEqual([
      {
        number: 3,
        state: "MERGED",
        url: "https://github.com/x/y/pull/3",
        mergedAt: "2026-07-12T01:00:00Z",
      },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe("gh");
    expect(calls[0].args).toContain("--head");
    expect(calls[0].args).toContain("auto/t-7-implement-a1");
    expect(calls[0].cwd).toBe("/repo");
  });

  it("returns [] for empty output", async () => {
    const gateway = createGhCliGateway({
      repoDir: "/repo",
      execFileFn: async () => ({ stdout: "" }),
    });
    expect(await gateway.prsForBranch("auto/x")).toEqual([]);
  });
});
