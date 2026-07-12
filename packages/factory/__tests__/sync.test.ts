/**
 * Daemon ↔ Slack coordinator (U8 wiring): thread opened on enrollment,
 * Needs-User escalation @mentions, launch/advance milestones without mention
 * (deduped), and inbound routing (status keyword vs the answer relay).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLogger, type Logger } from "../src/logger.js";
import type { PollCandidate } from "../src/linear/poller.js";
import type { EngineAction } from "../src/phases/engine.js";
import { createSlackSync } from "../src/slack/sync.js";
import { openStore, type FactoryStore } from "../src/store/db.js";
import { FakeGateway, makeIssue, type FakeIssue } from "./fake-gateway.js";
import { FakeSlackGateway } from "./fake-slack.js";

const CHANNEL = "C_FACTORY";
const OPERATOR = "UOP";

let dir: string;
let store: FactoryStore;
let log: Logger;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-sync-test-"));
  store = openStore(dir);
  log = createLogger({ write: () => {}, level: "error" });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function candidateFor(issue: FakeIssue, blockerLabels: string[] = []): PollCandidate {
  return {
    issue,
    lane: "Claude",
    hasLfg: false,
    isVerification: false,
    blockerLabels,
    ledger: {
      ledger: {
        phase: "implement",
        lane: "Claude",
        worker: null,
        attempt: 0,
        blocker: null,
        compounded: false,
      },
      prose: "",
      synthesized: true,
      warnings: [],
    },
    ledgerCommentId: null,
    comments: issue.comments,
  };
}

function makeSync(gateway: FakeGateway, slack: FakeSlackGateway) {
  return createSlackSync({
    slack,
    store,
    gateway,
    channelId: CHANNEL,
    operatorUserIds: [OPERATOR],
    log,
  });
}

const advance: EngineAction = {
  kind: "advance",
  toStatus: "Brainstorming",
  evidence: "x",
};
const launch: EngineAction = {
  kind: "launch",
  phase: "implement",
  runner: "claude",
  hostRequirement: "any",
  repair: false,
  promptInputs: { issueIdentifier: "THINK-1", title: "t", handoffStatus: "Ready to Work" },
};

describe("syncCandidate", () => {
  it("opens the thread on enrollment and posts a milestone for a launch", async () => {
    const issue = makeIssue({ identifier: "THINK-1", state: "In Progress", labels: ["Claude"] });
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const sync = makeSync(gateway, slack);

    await sync.syncCandidate(candidateFor(issue), launch);

    // Thread opened + persisted.
    expect(store.getSlackThreadByIssue(issue.id)).toBeDefined();
    // One root message + one milestone, no @mention on either.
    expect(slack.mentions()).toHaveLength(0);
    expect(slack.posts.some((p) => p.text.includes("Launched"))).toBe(true);
  });

  it("dedupes the milestone across repeated ticks", async () => {
    const issue = makeIssue({ identifier: "THINK-1", state: "In Progress", labels: ["Claude"] });
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const sync = makeSync(gateway, slack);

    await sync.syncCandidate(candidateFor(issue), launch);
    await sync.syncCandidate(candidateFor(issue), launch);

    expect(slack.posts.filter((p) => p.text.includes("Launched"))).toHaveLength(1);
  });

  it("escalates a Needs-User question WITH an @mention, deduped by question comment", async () => {
    const issue = makeIssue({
      identifier: "THINK-2",
      state: "Ready to Work",
      labels: ["Claude", "Needs User"],
      comments: [
        { id: "q-1", body: "@eric1 which provider? (recommend Cognito)", authorId: "worker" },
      ],
    });
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const sync = makeSync(gateway, slack);
    const candidate = candidateFor(issue, ["Needs User"]);

    await sync.syncCandidate(candidate, { kind: "block", label: "Needs User", reason: "r" });
    await sync.syncCandidate(candidate, { kind: "block", label: "Needs User", reason: "r" });

    const mentions = slack.mentions();
    expect(mentions).toHaveLength(1); // deduped
    expect(mentions[0].text).toContain("<@UOP>");
    expect(mentions[0].text).toContain("which provider");
  });
});

describe("handleInbound routing", () => {
  it("answers a `status` keyword in a mapped thread from the store", async () => {
    const issue = makeIssue({ identifier: "THINK-3", state: "Planning", labels: ["Claude"] });
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const sync = makeSync(gateway, slack);
    // Enroll (open thread) + record an issue row for the status view.
    await sync.syncCandidate(candidateFor(issue), advance);
    store.upsertIssue({
      issueId: issue.id,
      identifier: "THINK-3",
      lane: "Claude",
      phase: "plan",
      state: "Planning",
    });
    const threadTs = store.getSlackThreadByIssue(issue.id)!.thread_ts;
    slack.posts.length = 0;

    await sync.handleInbound({
      channel: CHANNEL,
      threadTs,
      ts: "1700.000900",
      userId: OPERATOR,
      text: "status",
    });

    expect(slack.posts).toHaveLength(1);
    expect(slack.posts[0].text).toContain("THINK-3");
    // A status read must NOT clear any blocker.
    expect(gateway.writesOf("removeLabel")).toHaveLength(0);
  });

  it("routes a non-status reply to the relay (answer round-trip)", async () => {
    const issue = makeIssue({
      identifier: "THINK-4",
      state: "Ready to Work",
      labels: ["Claude", "Needs User"],
      comments: [
        { id: "b1", body: "handoff:THINK-4:Ready to Work\n\nGoal: go", authorId: "viewer-daemon" },
      ],
    });
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const sync = makeSync(gateway, slack);
    await sync.syncCandidate(candidateFor(issue, ["Needs User"]), {
      kind: "block",
      label: "Needs User",
      reason: "r",
    });
    const threadTs = store.getSlackThreadByIssue(issue.id)!.thread_ts;

    await sync.handleInbound({
      channel: CHANNEL,
      threadTs,
      ts: "1700.001000",
      userId: OPERATOR,
      text: "Use Cognito.",
    });

    // Relay fired: Needs User cleared, baton appended.
    expect(gateway.writesOf("removeLabel").map((w) => w.args)).toContainEqual([
      issue.id,
      "Needs User",
    ]);
    expect(
      gateway.writesOf("createComment").some((w) => w.args[1].includes("Use Cognito.")),
    ).toBe(true);
  });
});
