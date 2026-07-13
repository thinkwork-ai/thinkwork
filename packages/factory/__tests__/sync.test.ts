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
import {
  createSlackSync,
  isQuestionKeyword,
  newestQuestion,
} from "../src/slack/sync.js";
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
  it("AE1: a launch posts exactly one short stage-move line — no rocket, no 'Launched'", async () => {
    const issue = makeIssue({ identifier: "THINK-1", state: "Ready to Work", labels: ["Claude"] });
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const sync = makeSync(gateway, slack);

    await sync.syncCandidate(candidateFor(issue), launch);

    // Thread opened + persisted.
    expect(store.getSlackThreadByIssue(issue.id)).toBeDefined();
    // One root message + one milestone, no @mention on either.
    expect(slack.mentions()).toHaveLength(0);
    const milestones = slack.posts.filter((p) => p.text.includes("→"));
    expect(milestones).toHaveLength(1);
    // An implement launch's Running hook moves the issue — show the DESTINATION.
    expect(milestones[0].text).toContain("→ In Progress");
    expect(milestones[0].text).not.toContain("Launched");
    expect(milestones[0].text).not.toContain(":rocket:");
    // R3: the milestone rides Block Kit with the plain text as fallback.
    expect(milestones[0].blocks).toBeDefined();
  });

  it("dedupes the milestone across repeated ticks", async () => {
    const issue = makeIssue({ identifier: "THINK-1", state: "In Progress", labels: ["Claude"] });
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const sync = makeSync(gateway, slack);

    await sync.syncCandidate(candidateFor(issue), launch);
    await sync.syncCandidate(candidateFor(issue), launch);

    expect(slack.posts.filter((p) => p.text.includes("→ In Progress"))).toHaveLength(1);
  });

  it("a launch and an advance describing the same move share one milestone line", async () => {
    const issue = makeIssue({ identifier: "THINK-1", state: "Ready to Work", labels: ["Claude"] });
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const sync = makeSync(gateway, slack);

    await sync.syncCandidate(candidateFor(issue), {
      kind: "advance",
      toStatus: "In Progress",
      evidence: "x",
    });
    await sync.syncCandidate(candidateFor(issue), launch);

    expect(slack.posts.filter((p) => p.text.includes("→ In Progress"))).toHaveLength(1);
  });

  it("U5: merged-PR note posts once for the routine settle-then-tick case", async () => {
    const issue = makeIssue({ identifier: "THINK-2", state: "Verification", labels: ["Claude"] });
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    let ghCalls = 0;
    const sync = createSlackSync({
      slack,
      store,
      gateway,
      channelId: CHANNEL,
      operatorUserIds: [OPERATOR],
      log,
      github: {
        prsForBranch: async () => {
          ghCalls += 1;
          return [
            {
              number: 3712,
              state: "MERGED" as const,
              url: "https://github.test/pull/3712",
              mergedAt: "2026-07-13T00:00:00Z",
            },
          ];
        },
      },
    });
    // A settled (Succeeded) implement attempt with a branch — the routine
    // path: worker merged its PR, moved the status, exited cleanly. The
    // pr-merged EVIDENCE kind never fires here; the note must anyway.
    store.upsertIssue({
      issueId: issue.id,
      identifier: issue.identifier,
      phase: "implement",
      state: issue.state,
      lane: "Claude",
    });
    store.insertAttempt({
      issueId: issue.id,
      phase: "implement",
      attemptNumber: 1,
      state: "Succeeded",
      host: "local",
      pid: 1,
      branch: "auto/think-2-implement-a1",
    });

    const advanceToVerification: EngineAction = {
      kind: "advance",
      toStatus: "Verification",
      evidence: "x",
    };
    await sync.syncCandidate(candidateFor(issue), advanceToVerification);
    const notes = slack.posts.filter((p) => p.text.includes("#3712"));
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toContain("merged");
    // Cut release + Result buttons ride the note.
    expect(JSON.stringify(notes[0].blocks)).toContain("factory-console:release");
    expect(JSON.stringify(notes[0].blocks)).toContain("factory-console:result");

    // Second tick: idempotent — one GitHub check per branch, one note.
    await sync.syncCandidate(candidateFor(issue), advanceToVerification);
    expect(slack.posts.filter((p) => p.text.includes("#3712"))).toHaveLength(1);
    expect(ghCalls).toBe(1);
  });

  it("opens NO thread for a noop action (a Done issue the daemon only noops)", async () => {
    const issue = makeIssue({ identifier: "THINK-9", state: "Done", labels: ["Claude"] });
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const sync = makeSync(gateway, slack);

    await sync.syncCandidate(candidateFor(issue), {
      kind: "noop",
      reason: "Done and already compounded",
    });

    // No thread opened, no post at all — a noop never enrolls.
    expect(store.getSlackThreadByIssue(issue.id)).toBeUndefined();
    expect(slack.posts).toHaveLength(0);
  });

  it("Done + stale Needs User → ZERO Slack activity (no thread, no escalation) — Done is terminal", async () => {
    // Regression: an old Done issue carrying a stale `Needs User` (or lane)
    // label from past work must NOT re-open a thread + @mention every tick. The
    // engine correctly noops it; the Slack layer must be terminal too, or it
    // churns a thread-open + escalation + un-enroll-close forever (the observed
    // Done-issue chatter). Only a genuine compound `launch` warrants a thread.
    const issue = makeIssue({
      identifier: "THINK-6",
      state: "Done",
      labels: ["Codex", "Needs User"],
      comments: [
        { id: "q-old", body: "@eric1 stale question from when it was active", authorId: "worker" },
      ],
    });
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const sync = makeSync(gateway, slack);
    const candidate = candidateFor(issue, ["Needs User"]);

    // The engine noops a Done issue; even across repeated ticks, nothing posts.
    await sync.syncCandidate(candidate, {
      kind: "noop",
      reason: "THINK-6 is Done without LFG — no automated compounding",
    });
    await sync.syncCandidate(candidate, {
      kind: "noop",
      reason: "THINK-6 is Done without LFG — no automated compounding",
    });

    expect(store.getSlackThreadByIssue(issue.id)).toBeUndefined();
    expect(slack.posts).toHaveLength(0);
    expect(slack.mentions()).toHaveLength(0);
  });

  it("Done + compound launch DOES open a thread but never escalates a stale Needs User", async () => {
    // The one legitimate Done thread: a factory-driven, not-yet-compounded issue
    // the engine launches compound on. It gets a launch milestone, but a stale
    // `Needs User` must not turn into an @mention escalation.
    const issue = makeIssue({
      identifier: "THINK-202",
      state: "Done",
      labels: ["Claude", "LFG", "Needs User"],
    });
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const sync = makeSync(gateway, slack);

    const compoundLaunch: EngineAction = {
      ...launch,
      phase: "compound",
      promptInputs: {
        issueIdentifier: "THINK-202",
        title: "t",
        handoffStatus: "Done",
      },
    };
    await sync.syncCandidate(candidateFor(issue, ["Needs User"]), compoundLaunch);

    expect(store.getSlackThreadByIssue(issue.id)).toBeDefined();
    expect(slack.mentions()).toHaveLength(0); // no stale-label escalation
  });

  it("opens the thread for advance and block actions", async () => {
    const advanceIssue = makeIssue({
      identifier: "THINK-7",
      state: "Requirements Review",
      labels: ["Claude", "LFG"],
    });
    const blockIssue = makeIssue({
      identifier: "THINK-8",
      state: "Planning",
      labels: ["Claude"],
    });
    const gateway = new FakeGateway([advanceIssue, blockIssue]);
    const slack = new FakeSlackGateway();
    const sync = makeSync(gateway, slack);

    await sync.syncCandidate(candidateFor(advanceIssue), advance);
    await sync.syncCandidate(candidateFor(blockIssue), {
      kind: "block",
      label: "Needs Credentials",
      reason: "r",
    });

    expect(store.getSlackThreadByIssue(advanceIssue.id)).toBeDefined();
    expect(store.getSlackThreadByIssue(blockIssue.id)).toBeDefined();
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
  it("answers a `status` keyword with LIVE Linear state, even when the store row is stale", async () => {
    // Live Linear says Verification; the store row froze at the implement
    // launch ("Ready to Work") — the answer must report Verification.
    const issue = makeIssue({
      identifier: "THINK-3",
      state: "Verification",
      labels: ["Claude", "LFG"],
    });
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const sync = makeSync(gateway, slack);
    // Enroll (open thread) + record a STALE issue row (as the executor did
    // before the lastObservedStatus fix, and as any mid-phase row still does).
    await sync.syncCandidate(candidateFor(issue), advance);
    store.upsertIssue({
      issueId: issue.id,
      identifier: "THINK-3",
      lane: "Claude",
      phase: "implement",
      state: "Ready to Work",
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
    expect(slack.posts[0].text).toContain("THINK-3> — Verification"); // linkified: <url|THINK-3> — ...
    expect(slack.posts[0].text).not.toContain("Ready to Work");
    // A status read must NOT clear any blocker.
    expect(gateway.writesOf("removeLabel")).toHaveLength(0);
  });

  it("falls back to the store view (labeled) when the live Linear read fails", async () => {
    const issue = makeIssue({ identifier: "THINK-3", state: "Planning", labels: ["Claude"] });
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const sync = makeSync(gateway, slack);
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
    gateway.failNextListIssues = true;

    await sync.handleInbound({
      channel: CHANNEL,
      threadTs,
      ts: "1700.000900",
      userId: OPERATOR,
      text: "status",
    });

    expect(slack.posts).toHaveLength(1);
    expect(slack.posts[0].text).toContain('status "Planning"');
    expect(slack.posts[0].text).toContain("couldn't reach Linear");
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

describe("answer-form buttons (block_actions round-trip)", () => {
  const FENCED_QUESTION = [
    "blocker:THINK-50:implement — @eric1",
    "",
    "Questions:",
    "1. Which OAuth scope should the connector request? (recommend read-only)",
    "",
    "```answers",
    "- question: Which OAuth scope should the connector request?",
    "  recommended: 1",
    "  options:",
    "    - Read-only (drive.readonly)",
    "    - Full drive access",
    "```",
  ].join("\n");

  type Button = {
    action_id: string;
    value: string;
    style?: string;
    text: { text: string };
  };
  type Block = { type: string; elements?: Button[] };

  function allButtons(blocks: unknown[] | undefined): Button[] {
    return ((blocks ?? []) as Block[])
      .filter((b) => b.type === "actions")
      .flatMap((b) => b.elements ?? []);
  }

  /** Escalate a fenced question and return everything a click test needs. */
  async function escalated() {
    const issue = makeIssue({
      identifier: "THINK-50",
      state: "Ready to Work",
      labels: ["Claude", "Needs User"],
      comments: [
        { id: "b1", body: "handoff:THINK-50:Ready to Work\n\nGoal: go", authorId: "viewer-daemon" },
        { id: "q-1", body: FENCED_QUESTION, authorId: "worker" },
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
    const row = store.getSlackThreadByIssue(issue.id)!;
    const escalation = slack.mentions()[0];
    return { issue, gateway, slack, sync, row, escalation };
  }

  it("escalation with a parseable fence posts option buttons (recommended = primary + ✅)", async () => {
    const { escalation, row } = await escalated();
    const buttons = allButtons(escalation.blocks);
    // Answer-form buttons first, then the state's console actions (R5 —
    // the escalation also offers result/logs/retry/pause context).
    expect(buttons.map((b) => b.action_id)).toEqual([
      "factory-answer:0:0",
      "factory-answer:0:1",
      "factory-answer-other",
      "factory-console:result",
      "factory-console:logs",
      "factory-console:retry",
      "factory-console:pause",
    ]);
    expect(buttons[0].style).toBe("primary");
    expect(buttons[0].text.text).toBe("✅ Read-only (drive.readonly)");
    // The escalation ts is stored so a click can chat.update the message.
    expect(row.last_escalated_ts).toBe(escalation.ts);
  });

  it("escalation WITHOUT a fence posts retry blocks instead", async () => {
    const issue = makeIssue({
      identifier: "THINK-51",
      state: "Ready to Work",
      labels: ["Claude", "Needs User"],
      comments: [
        {
          id: "fb-1",
          body: "factory-block:THINK-51\n\n2 consecutive killed attempts — escalating",
          authorId: "viewer-daemon",
        },
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
    const buttons = allButtons(slack.mentions()[0].blocks);
    expect(buttons.map((b) => b.action_id)).toEqual([
      "factory-answer-retry",
      "factory-answer-other",
      "factory-console:result",
      "factory-console:logs",
      "factory-console:retry",
      "factory-console:pause",
    ]);
  });

  it("clicking an option button relays: baton + blocker cleared + mirror + buttons stripped", async () => {
    const { issue, gateway, slack, sync, row, escalation } = await escalated();
    const button = allButtons(escalation.blocks)[0];

    await sync.handleAction({
      channel: CHANNEL,
      messageTs: escalation.ts,
      threadTs: row.thread_ts,
      userId: OPERATOR,
      actionId: button.action_id,
      value: button.value,
    });

    // Baton appended with the option's full answer text; blocker cleared;
    // mirror posted — identical to a typed reply.
    expect(
      gateway
        .writesOf("createComment")
        .some((w) => w.args[1].startsWith("handoff:THINK-50") && w.args[1].includes("Q1: Read-only (drive.readonly)")),
    ).toBe(true);
    expect(gateway.writesOf("removeLabel").map((w) => w.args)).toContainEqual([
      issue.id,
      "Needs User",
    ]);
    expect(
      gateway.writesOf("createComment").some((w) => w.args[1].startsWith("slack-relay:")),
    ).toBe(true);
    // The escalation message was chat.update-d to a buttonless summary so the
    // form cannot double-fire.
    expect(slack.updates).toHaveLength(1);
    expect(slack.updates[0].ts).toBe(row.last_escalated_ts);
    expect(slack.updates[0].text).toContain(`✅ Answered by <@${OPERATOR}>`);
    expect(allButtons(slack.updates[0].blocks)).toHaveLength(0);
  });

  it("a click by a non-operator is acknowledged but never injected", async () => {
    const { issue, gateway, slack, sync, row, escalation } = await escalated();
    const button = allButtons(escalation.blocks)[0];

    await sync.handleAction({
      channel: CHANNEL,
      messageTs: escalation.ts,
      threadTs: row.thread_ts,
      userId: "UINTRUDER",
      actionId: button.action_id,
      value: button.value,
    });

    expect(gateway.writesOf("removeLabel")).toHaveLength(0);
    expect(issue.labels).toContain("Needs User");
    expect(slack.updates).toHaveLength(0); // buttons stay live
    // But a polite ack was posted in the thread.
    expect(
      slack.repliesIn(row.thread_ts).some((p) => p.text.includes("authorized operator")),
    ).toBe(true);
  });

  it("the Other… button posts typing instructions and relays nothing", async () => {
    const { gateway, slack, sync, row, escalation } = await escalated();
    const other = allButtons(escalation.blocks).find(
      (b) => b.action_id === "factory-answer-other",
    )!;
    const before = gateway.writes.length;

    await sync.handleAction({
      channel: CHANNEL,
      messageTs: escalation.ts,
      threadTs: row.thread_ts,
      userId: OPERATOR,
      actionId: other.action_id,
      value: other.value,
    });

    expect(gateway.writes).toHaveLength(before); // no Linear writes at all
    expect(slack.updates).toHaveLength(0);
    const replies = slack.repliesIn(row.thread_ts);
    expect(replies[replies.length - 1].text).toContain("Reply in this thread");
  });

  it("the retry button relays the fixed retry answer", async () => {
    const issue = makeIssue({
      identifier: "THINK-52",
      state: "Ready to Work",
      labels: ["Claude", "Needs User"],
      comments: [
        { id: "fb-1", body: "factory-block:THINK-52\n\nceiling hit", authorId: "viewer-daemon" },
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
    const row = store.getSlackThreadByIssue(issue.id)!;
    const retry = allButtons(slack.mentions()[0].blocks)[0];

    await sync.handleAction({
      channel: CHANNEL,
      messageTs: slack.mentions()[0].ts,
      threadTs: row.thread_ts,
      userId: OPERATOR,
      actionId: retry.action_id,
      value: retry.value,
    });

    expect(gateway.writesOf("removeLabel").map((w) => w.args)).toContainEqual([
      issue.id,
      "Needs User",
    ]);
    expect(
      gateway
        .writesOf("createComment")
        .some((w) => w.args[1].includes("operator cleared the blocker via Slack without additional guidance")),
    ).toBe(true);
  });

  it("a malformed button value is logged and ignored", async () => {
    const { gateway, slack, sync, row, escalation } = await escalated();
    const before = gateway.writes.length;
    const postsBefore = slack.posts.length;

    await sync.handleAction({
      channel: CHANNEL,
      messageTs: escalation.ts,
      threadTs: row.thread_ts,
      userId: OPERATOR,
      actionId: "factory-answer:0:0",
      value: "not json {{{",
    });

    expect(gateway.writes).toHaveLength(before);
    expect(slack.posts).toHaveLength(postsBefore);
    expect(slack.updates).toHaveLength(0);
  });

  it("a click on an unmapped thread is ignored", async () => {
    const { gateway, slack, sync, escalation } = await escalated();
    const button = allButtons(escalation.blocks)[0];
    const before = gateway.writes.length;

    await sync.handleAction({
      channel: CHANNEL,
      messageTs: escalation.ts,
      threadTs: "9999.999999",
      userId: OPERATOR,
      actionId: button.action_id,
      value: button.value,
    });

    expect(gateway.writes).toHaveLength(before);
    expect(slack.updates).toHaveLength(0);
  });

  it("a second click after the answer is a polite no-op (no double relay)", async () => {
    const { gateway, slack, sync, row, escalation } = await escalated();
    const button = allButtons(escalation.blocks)[0];
    const click = {
      channel: CHANNEL,
      messageTs: escalation.ts,
      threadTs: row.thread_ts,
      userId: OPERATOR,
      actionId: button.action_id,
      value: button.value,
    };

    await sync.handleAction(click);
    const batonWrites = gateway
      .writesOf("createComment")
      .filter((w) => w.args[1].startsWith("handoff:")).length;
    const updates = slack.updates.length;

    // Second click: the relay core's no-open-question check (Needs User is
    // gone) makes it a polite no-op — nothing new is injected.
    await sync.handleAction(click);

    expect(
      gateway.writesOf("createComment").filter((w) => w.args[1].startsWith("handoff:")).length,
    ).toBe(batonWrites);
    expect(gateway.writesOf("removeLabel")).toHaveLength(1);
    expect(slack.updates).toHaveLength(updates); // no second edit
    const replies = slack.repliesIn(row.thread_ts);
    expect(replies[replies.length - 1].text).toContain("isn't waiting on an answer");
  });
});

describe("newestQuestion — question-protocol comment wins", () => {
  it("prefers the newest blocker: comment over a NEWER worker progress note", async () => {
    // THINK-274 live failure shape (inverted): the real numbered question is a
    // blocker: comment, and a worker progress note ("No user input required")
    // exists too. The escalation must quote the blocker: comment.
    const comments = [
      { id: "c1", body: "worker:THINK-9:implement — merge held on a gate. No user input required." },
      { id: "c2", body: "blocker:THINK-9:implement (attempt 2) — @eric1\n\nQuestions:\n1. Approve option (a)?" },
      { id: "c3", body: "worker:THINK-9:implement — still holding, re-checked the gate." },
    ];
    const q = newestQuestion(comments);
    expect(q!.id).toBe("c2");
  });

  it("falls back to the newest non-marker comment when no blocker: comment exists", () => {
    const comments = [
      { id: "c1", body: "handoff:THINK-9:Planning\n\nGoal: plan" },
      { id: "c2", body: "@eric1 which provider? (recommend Cognito)" },
      { id: "c3", body: "factory-block:THINK-9\n\nblocked" },
    ];
    expect(newestQuestion(comments)!.id).toBe("c2");
  });
});

describe("isQuestionKeyword", () => {
  it("matches the phrasings an operator actually types", () => {
    expect(isQuestionKeyword("question")).toBe(true);
    expect(isQuestionKeyword("question?")).toBe(true);
    expect(isQuestionKeyword("q?")).toBe(true);
    expect(isQuestionKeyword("why")).toBe(true);
    expect(isQuestionKeyword("What's the question?")).toBe(true);
    expect(isQuestionKeyword("What's the qustion?")).toBe(true); // live typo
    expect(isQuestionKeyword("whats the question")).toBe(true);
    expect(isQuestionKeyword("what is the question?")).toBe(true);
    expect(isQuestionKeyword("<@UBOT> question")).toBe(true);
    // Real answers must NOT match.
    expect(isQuestionKeyword("Use Cognito.")).toBe(false);
    expect(isQuestionKeyword("yes, approve option (a)")).toBe(false);
    expect(isQuestionKeyword("what should we do about the gate?")).toBe(false);
  });
});

describe("handleInbound — question keyword", () => {
  it("re-shows the open question WITHOUT relaying (blocker intact)", async () => {
    const issue = makeIssue({
      identifier: "THINK-9",
      state: "Ready to Work",
      labels: ["Claude", "Needs User"],
      comments: [
        { id: "c1", body: "worker:THINK-9:implement — progress note", authorId: "worker" },
        {
          id: "c2",
          body: "blocker:THINK-9:implement (attempt 2) — @eric1\n\nQuestions:\n1. Approve option (a)?",
          authorId: "worker",
        },
      ],
    });
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const sync = makeSync(gateway, slack);
    store.upsertSlackThread({
      issueId: issue.id,
      identifier: issue.identifier,
      channelId: CHANNEL,
      threadTs: "ts-q",
    });

    await sync.handleInbound({
      channel: CHANNEL,
      threadTs: "ts-q",
      ts: "1700.002000",
      userId: OPERATOR,
      text: "What's the qustion?",
    });

    expect(slack.posts).toHaveLength(1);
    expect(slack.posts[0].text).toContain("Approve option (a)?");
    // NOT relayed: blocker untouched, no baton/mirror comments written.
    expect(gateway.writesOf("removeLabel")).toHaveLength(0);
    expect(gateway.writesOf("createComment")).toHaveLength(0);
  });

  it("says there is no open question when the blocker is absent", async () => {
    const issue = makeIssue({
      identifier: "THINK-9",
      state: "Verification",
      labels: ["Claude"],
    });
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const sync = makeSync(gateway, slack);
    store.upsertSlackThread({
      issueId: issue.id,
      identifier: issue.identifier,
      channelId: CHANNEL,
      threadTs: "ts-q",
    });

    await sync.handleInbound({
      channel: CHANNEL,
      threadTs: "ts-q",
      ts: "1700.002100",
      userId: OPERATOR,
      text: "question",
    });

    expect(slack.posts).toHaveLength(1);
    expect(slack.posts[0].text).toContain("no open question");
    expect(slack.posts[0].text).toContain("Verification");
    expect(gateway.writesOf("removeLabel")).toHaveLength(0);
  });
});

describe("escalation content — links, no noise footer", () => {
  it("links the issue and the question comment; no verbose footer", async () => {
    const issue = makeIssue({
      identifier: "THINK-40",
      state: "Ready to Work",
      labels: ["Claude", "Needs User"],
      comments: [
        {
          id: "q-1",
          body: "blocker:THINK-40:implement — @eric1\n\nQuestions:\n1. Approve?",
          url: "https://linear.test/issue/THINK-40#comment-q-1",
          authorId: "worker",
        },
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

    const mention = slack.mentions()[0];
    expect(mention.text).toContain("<https://linear.test/issue/THINK-40|THINK-40>");
    expect(mention.text).toContain("<https://linear.test/issue/THINK-40#comment-q-1|Open the question in Linear>");
    expect(mention.text).toContain("1. Approve?");
    expect(mention.text).not.toContain("VERBATIM");
    // Root enrollment message links the issue too.
    expect(slack.posts[0].text).toContain("<https://linear.test/issue/THINK-40|THINK-40>");
  });

  it("falls back to the newest factory-block reason when no worker question exists", async () => {
    const issue = makeIssue({
      identifier: "THINK-41",
      state: "Ready to Work",
      labels: ["Claude", "Needs User"],
      comments: [
        {
          id: "fb-1",
          body: "factory-block:THINK-41\n\n**Automation blocked this issue** (`Needs User`).\n\nTHINK-41 phase \"implement\" has 2 consecutive killed/stalled attempts — escalating to an operator (R15/AE5)",
          url: "https://linear.test/issue/THINK-41#comment-fb-1",
          authorId: "viewer-daemon",
        },
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

    const mention = slack.mentions()[0];
    expect(mention.text).toContain("2 consecutive killed/stalled attempts");
    expect(mention.text).not.toContain("an answer is needed to resume");
  });
});
