/**
 * U3 — the console routing spine: typed-verb parsing, per-state action sets,
 * the shared authorize → live-re-check → execute → ack pipeline (KTD2), and
 * the R4 help reply. Exercised through createSlackSync so the typed path and
 * the button path are proven to route through the SAME pipeline.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_RELEASE, nextN } from "../src/domain/release.js";
import { createLogger, type Logger } from "../src/logger.js";
import type { PollCandidate } from "../src/linear/poller.js";
import {
  actionsForState,
  consoleButton,
  helpText,
  parseVerb,
  verbsForState,
  type ConsoleExecutor,
  type ConsoleVerb,
} from "../src/slack/console.js";
import { decideAction } from "../src/phases/engine.js";
import type { GithubOps, PrDetail } from "../src/phases/evidence.js";
import {
  createInspectionExecutors,
  createMergeExecutor,
  createReleaseExecutors,
  newestImages,
  RELEASE_OFFER_KEY,
} from "../src/slack/console.js";
import { LocalTransport } from "../src/workers/transport.js";
import { mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { createSteeringExecutors, formatElapsed } from "../src/slack/console.js";
import { slackConsoleChecks } from "../src/doctor.js";
import { createSlackSync, type SlackSync } from "../src/slack/sync.js";
import { openStore, type FactoryStore } from "../src/store/db.js";
import { FakeGateway, makeIssue, type FakeIssue } from "./fake-gateway.js";
import { FakeSlackGateway } from "./fake-slack.js";

const CHANNEL = "C_FACTORY";
const OPERATOR = "UOP";
const STRANGER = "UNOBODY";

let dir: string;
let store: FactoryStore;
let log: Logger;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-console-test-"));
  store = openStore(dir);
  log = createLogger({ write: () => {}, level: "error" });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function candidateFor(issue: FakeIssue): PollCandidate {
  return {
    issue,
    lane: "Claude",
    hasLfg: false,
    isVerification: false,
    blockerLabels: [],
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

interface Harness {
  gateway: FakeGateway;
  slack: FakeSlackGateway;
  sync: SlackSync;
  threadTs: string;
}

/** Enroll an issue (thread mapped in the store) and return the harness. */
async function enrolled(
  issue: FakeIssue,
  executors: Partial<Record<ConsoleVerb, ConsoleExecutor>> = {},
): Promise<Harness> {
  const gateway = new FakeGateway([issue]);
  const slack = new FakeSlackGateway();
  const sync = createSlackSync({
    slack,
    store,
    gateway,
    channelId: CHANNEL,
    operatorUserIds: [OPERATOR],
    log,
    consoleExecutors: executors,
  });
  await sync.syncCandidate(candidateFor(issue), {
    kind: "advance",
    toStatus: issue.state,
    evidence: "seed",
  });
  const row = store.getSlackThreadByIssue(issue.id);
  if (row === undefined) throw new Error("enrollment did not map a thread");
  return { gateway, slack, sync, threadTs: row.thread_ts };
}

function typed(h: Harness, text: string, userId = OPERATOR) {
  return h.sync.handleInbound({
    channel: CHANNEL,
    threadTs: h.threadTs,
    ts: `${Date.now() / 1000}`,
    userId,
    text,
  });
}

function clicked(
  h: Harness,
  verb: ConsoleVerb,
  opts: { userId?: string; value?: string } = {},
) {
  return h.sync.handleAction({
    channel: CHANNEL,
    messageTs: "999.000001",
    threadTs: h.threadTs,
    userId: opts.userId ?? OPERATOR,
    actionId: `factory-console:${verb}`,
    value: opts.value ?? JSON.stringify({ v: verb }),
  });
}

function lastReply(h: Harness): string {
  const replies = h.slack.repliesIn(h.threadTs);
  return replies[replies.length - 1]?.text ?? "";
}

describe("parseVerb", () => {
  it("parses every verb, aliases, and args", () => {
    expect(parseVerb("result")).toEqual({ verb: "result" });
    expect(parseVerb("report")).toEqual({ verb: "result" });
    expect(parseVerb("approve")).toEqual({ verb: "approve" });
    expect(parseVerb("advance")).toEqual({ verb: "approve" });
    expect(parseVerb("logs")).toEqual({ verb: "logs" });
    expect(parseVerb("logs 50")).toEqual({ verb: "logs", arg: "50" });
    expect(parseVerb("merge 123")).toEqual({ verb: "merge", arg: "123" });
    expect(parseVerb("merge #123")).toEqual({ verb: "merge", arg: "123" });
    expect(parseVerb("Retry")).toEqual({ verb: "retry" });
    expect(parseVerb("pause")).toEqual({ verb: "pause" });
    expect(parseVerb("resume")).toEqual({ verb: "resume" });
    expect(parseVerb("release")).toEqual({ verb: "release" });
    expect(parseVerb("help")).toEqual({ verb: "help" });
    expect(parseVerb("<@UBOT> status? no — help")).toBeNull();
    expect(parseVerb("merge it plz")).toBeNull();
    expect(parseVerb("what about the tests")).toBeNull();
  });
});

describe("verbsForState / actionsForState", () => {
  it("a Verification milestone carries Approve (primary) + Result + Logs", () => {
    expect(verbsForState("Verification", [])).toEqual([
      "approve",
      "result",
      "logs",
      "retry",
      "pause",
    ]);
    const block = actionsForState("Verification", [])!;
    const els = block.elements as { action_id: string; style?: string }[];
    expect(els[0].action_id).toBe("factory-console:approve");
    expect(els[0].style).toBe("primary");
  });

  it("a Paused issue offers Resume, not Pause", () => {
    expect(verbsForState("In Progress", ["Paused"])).toContain("resume");
    expect(verbsForState("In Progress", ["Paused"])).not.toContain("pause");
  });

  it("Done offers only result", () => {
    expect(verbsForState("Done", [])).toEqual(["result"]);
  });

  it("consoleButton embeds the verb (+arg) as JSON value", () => {
    const b = consoleButton("merge", { arg: "123" });
    expect(JSON.parse(b.value!)).toEqual({ v: "merge", arg: "123" });
  });
});

describe("the action pipeline (KTD2)", () => {
  it("R17: a non-operator TYPED read verb is refused verbatim", async () => {
    const issue = makeIssue({ identifier: "THINK-40", state: "In Progress", labels: ["Claude"] });
    const h = await enrolled(issue, {
      result: async () => ({ text: "should never run" }),
    });
    await typed(h, "result", STRANGER);
    expect(lastReply(h)).toContain("only an authorized operator");
    expect(lastReply(h)).not.toContain("should never run");
  });

  it("R17: a non-operator BUTTON click is refused through the same pipeline", async () => {
    const issue = makeIssue({ identifier: "THINK-41", state: "In Progress", labels: ["Claude"] });
    let ran = false;
    const h = await enrolled(issue, {
      logs: async () => {
        ran = true;
        return { text: "tail" };
      },
    });
    await clicked(h, "logs", { userId: STRANGER });
    expect(ran).toBe(false);
    expect(lastReply(h)).toContain("only an authorized operator");
  });

  it("stale Approve (issue already Done) → polite no-op naming the current state", async () => {
    const issue = makeIssue({ identifier: "THINK-42", state: "In Progress", labels: ["Claude"] });
    const h = await enrolled(issue, {
      approve: async () => ({ text: "advanced" }),
    });
    issue.state = "Done"; // the live re-check must see the CURRENT state
    await clicked(h, "approve");
    expect(lastReply(h)).toContain("Done");
    expect(lastReply(h)).not.toContain("advanced");
  });

  it("typed verb and button run the SAME executor (R6 parity)", async () => {
    const issue = makeIssue({ identifier: "THINK-43", state: "Verification", labels: ["Claude"] });
    const calls: string[] = [];
    const h = await enrolled(issue, {
      approve: async (ctx) => {
        calls.push(`${ctx.identifier}:${ctx.userId}`);
        return { text: "✅ moved to Done" };
      },
    });
    await typed(h, "approve");
    await clicked(h, "approve");
    expect(calls).toEqual(["THINK-43:UOP", "THINK-43:UOP"]);
  });

  it("KTD2: a slow verb posts the interim ⏳ line, then edits it into the ack", async () => {
    const issue = makeIssue({ identifier: "THINK-44", state: "Verification", labels: ["Claude"] });
    let progressSeen = false;
    const h = await enrolled(issue, {
      result: async () => {
        progressSeen = h.slack
          .repliesIn(h.threadTs)
          .some((p) => p.text.startsWith("⏳"));
        return { text: "here is the result" };
      },
    });
    await typed(h, "result");
    expect(progressSeen).toBe(true);
    // The final ack EDITS the progress line (chat.update), not a new post.
    expect(h.slack.updates.some((u) => u.text === "here is the result")).toBe(true);
  });

  it("an executor failure is ACKED with the error (R11), never silent", async () => {
    const issue = makeIssue({ identifier: "THINK-45", state: "In Progress", labels: ["Claude"] });
    const h = await enrolled(issue, {
      retry: async () => {
        throw new Error("gh exploded");
      },
    });
    await typed(h, "retry");
    expect(lastReply(h)).toContain("gh exploded");
    expect(lastReply(h)).toContain("❌");
  });

  it("a verb with no executor acks 'not yet available'", async () => {
    const issue = makeIssue({ identifier: "THINK-46", state: "In Progress", labels: ["Claude"] });
    const h = await enrolled(issue, {});
    await typed(h, "pause");
    expect(lastReply(h)).toContain("isn't available yet");
  });

  it("malformed console value JSON is ignored with a log, nothing posts", async () => {
    const issue = makeIssue({ identifier: "THINK-47", state: "In Progress", labels: ["Claude"] });
    const h = await enrolled(issue, {
      result: async () => ({ text: "ran" }),
    });
    const before = h.slack.posts.length;
    await clicked(h, "result", { value: "{not json" });
    expect(h.slack.posts.length).toBe(before);
  });

  it("`logs 50` carries the count into the executor arg", async () => {
    const issue = makeIssue({ identifier: "THINK-48", state: "In Progress", labels: ["Claude"] });
    let arg: string | undefined;
    const h = await enrolled(issue, {
      logs: async (ctx) => {
        arg = ctx.arg;
        return { text: "tail" };
      },
    });
    await typed(h, "logs 50");
    expect(arg).toBe("50");
  });
});

describe("R4: help routing", () => {
  it("AE3: unknown text in a thread with NO open question lists state commands", async () => {
    const issue = makeIssue({ identifier: "THINK-50", state: "Verification", labels: ["Claude"] });
    const h = await enrolled(issue, {});
    await typed(h, "merge it plz");
    const reply = lastReply(h);
    expect(reply).not.toContain("isn't waiting on an answer (no");
    expect(reply).toContain("commands:");
    expect(reply).toContain("`approve`");
    expect(reply).toContain("`merge <pr#>`");
  });

  it("typed `help` answers with the state's command list", async () => {
    // Enroll while active (Done is terminal and never enrolls), then finish.
    const issue = makeIssue({ identifier: "THINK-51", state: "Verification", labels: ["Claude"] });
    const h = await enrolled(issue, {});
    issue.state = "Done";
    await typed(h, "help");
    expect(lastReply(h)).toContain("commands:");
    expect(lastReply(h)).toContain("`result`");
  });

  it("a VERB in a thread with an open question routes to the console, not the relay", async () => {
    const issue = makeIssue({
      identifier: "THINK-52",
      state: "In Progress",
      labels: ["Claude", "Needs User"],
      comments: [
        { id: "q1", body: "blocker:THINK-52:implement — which db?", authorId: "worker" },
      ],
    });
    let ran = false;
    const h = await enrolled(issue, {
      logs: async () => {
        ran = true;
        return { text: "tail" };
      },
    });
    await typed(h, "logs");
    expect(ran).toBe(true);
    // The blocker must NOT have been cleared — nothing was relayed.
    expect(issue.labels).toContain("Needs User");
  });

  it("NON-verb text in a blocked thread still relays as the answer", async () => {
    const issue = makeIssue({
      identifier: "THINK-53",
      state: "In Progress",
      labels: ["Claude", "Needs User"],
      comments: [
        { id: "q1", body: "blocker:THINK-53:implement — which db?", authorId: "worker" },
      ],
    });
    const h = await enrolled(issue, {});
    await typed(h, "use postgres with the shared cluster");
    expect(issue.labels).not.toContain("Needs User");
    expect(lastReply(h)).toContain("Relayed");
  });
});

describe("helpText", () => {
  it("renders the ref verbatim and only state-valid verbs (+merge/release)", () => {
    const text = helpText("<https://x|THINK-9>", "Done", []);
    expect(text).toContain("<https://x|THINK-9> (Done)");
    expect(text).toContain("`result`");
    expect(text).not.toContain("`approve`");
    expect(text).toContain("`merge <pr#>`");
  });
});

describe("U4: steering executors", () => {
  function steering(h: Harness) {
    return createSteeringExecutors({ gateway: h.gateway, store, log });
  }

  async function enrolledWithSteering(issue: FakeIssue): Promise<Harness> {
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const sync = createSlackSync({
      slack,
      store,
      gateway,
      channelId: CHANNEL,
      operatorUserIds: [OPERATOR],
      log,
      consoleExecutors: createSteeringExecutors({ gateway, store, log }),
    });
    await sync.syncCandidate(candidateFor(issue), {
      kind: "advance",
      toStatus: issue.state,
      evidence: "seed",
    });
    const row = store.getSlackThreadByIssue(issue.id);
    if (row === undefined) throw new Error("enrollment did not map a thread");
    return { gateway, slack, sync, threadTs: row.thread_ts };
  }

  // One test per gate: the store is per-test, and the fake Slack gateway's ts
  // sequence restarts per instance — two enrollments in one test would collide
  // on (channel, thread_ts) in slack_threads.
  for (const [state, target] of [
    ["Requirements Review", "Planning"],
    ["Plan Review", "Ready to Work"],
    ["Verification", "Done"],
  ] as const) {
    it(`approve advances ${state} → ${target} (R7)`, async () => {
      const issue = makeIssue({ identifier: "THINK-60", state, labels: ["Claude"] });
      const h = await enrolledWithSteering(issue);
      await typed(h, "approve");
      expect(
        h.gateway.writesOf("setState").some((w) => w.args[1] === target),
      ).toBe(true);
      expect(lastReply(h)).toContain(target);
    });
  }

  it("approve from In Progress refuses politely, naming the state", async () => {
    const issue = makeIssue({ identifier: "THINK-64", state: "In Progress", labels: ["Claude"] });
    const h = await enrolledWithSteering(issue);
    await typed(h, "approve");
    expect(h.gateway.writesOf("setState")).toHaveLength(0);
    expect(lastReply(h)).toContain("In Progress");
  });

  it("retry on a blocked idle issue clears blockers and posts the retry baton", async () => {
    const issue = makeIssue({
      identifier: "THINK-65",
      state: "In Progress",
      labels: ["Claude", "Needs User", "Verification Failed"],
    });
    const h = await enrolledWithSteering(issue);
    await typed(h, "retry");
    const removed = h.gateway.writesOf("removeLabel").map((w) => w.args[1]);
    expect(removed).toContain("Needs User");
    expect(removed).toContain("Verification Failed");
    const batons = h.gateway
      .writesOf("createComment")
      .filter((w) => String(w.args[1]).startsWith("handoff:THINK-65:"));
    expect(batons).toHaveLength(1);
    expect(String(batons[0].args[1])).toContain("Retry: operator cleared the blocker");
    expect(lastReply(h)).toContain("🔁 Retry armed");
  });

  it("retry with an ACTIVE running attempt is a polite no-op naming the attempt", async () => {
    const issue = makeIssue({ identifier: "THINK-66", state: "In Progress", labels: ["Claude"] });
    const h = await enrolledWithSteering(issue);
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
      state: "Running",
      host: "local",
      pid: 4242,
    });
    await typed(h, "retry");
    expect(lastReply(h)).toContain("already has a running");
    expect(lastReply(h)).toContain("implement");
    expect(h.gateway.writesOf("createComment")).toHaveLength(0);
  });

  it("pause adds the Paused label and the engine then blocks the issue (KTD6)", async () => {
    const issue = makeIssue({ identifier: "THINK-67", state: "In Progress", labels: ["Claude"] });
    const h = await enrolledWithSteering(issue);
    await typed(h, "pause");
    expect(h.gateway.writesOf("addLabel").map((w) => w.args[1])).toContain("Paused");
    expect(lastReply(h)).toContain("⏸️ Paused");

    // The engine's blocked-wait: a candidate carrying Paused blocks.
    const decision = decideAction(
      { ...candidateFor(issue), blockerLabels: ["Paused"] },
      { activeAttempt: null, hasChildIssues: false },
    );
    expect(decision).toMatchObject({ kind: "block", label: "Paused" });
  });

  it("resume removes the Paused label; resume when not paused is a no-op ack", async () => {
    const issue = makeIssue({ identifier: "THINK-68", state: "In Progress", labels: ["Claude", "Paused"] });
    const h = await enrolledWithSteering(issue);
    await typed(h, "resume");
    expect(h.gateway.writesOf("removeLabel").map((w) => w.args[1])).toContain("Paused");
    expect(lastReply(h)).toContain("▶️ Resumed");

    issue.labels = issue.labels.filter((l) => l !== "Paused");
    await typed(h, "resume");
    expect(lastReply(h)).toContain("isn't paused");
  });

  it("pause when already paused acks idempotently without a second label write", async () => {
    const issue = makeIssue({ identifier: "THINK-69", state: "In Progress", labels: ["Claude", "Paused"] });
    const h = await enrolledWithSteering(issue);
    await typed(h, "pause");
    expect(h.gateway.writesOf("addLabel")).toHaveLength(0);
    expect(lastReply(h)).toContain("already paused");
  });
});

describe("formatElapsed", () => {
  it("renders human-short elapsed", () => {
    const now = new Date("2026-07-13T12:00:00Z");
    expect(formatElapsed("2026-07-13T11:59:20Z", now)).toBe("40s");
    expect(formatElapsed("2026-07-13T11:48:00Z", now)).toBe("12m");
    expect(formatElapsed("2026-07-13T10:20:00Z", now)).toBe("1h40");
  });
});

describe("U5: merge executor", () => {
  function fakeGithub(overrides: Partial<GithubOps> = {}): GithubOps & {
    merges: number[];
  } {
    const merges: number[] = [];
    return {
      merges,
      prsForBranch: async () => [],
      prView: async (n): Promise<PrDetail | null> => ({
        number: n,
        state: "OPEN",
        title: "feat: thing",
        headRefName: "auto/think-70-implement-a1",
        url: `https://github.test/pull/${n}`,
        mergedAt: null,
      }),
      prChecks: async () => ({ ok: true, summary: "all checks pass" }),
      prMerge: async (n) => {
        merges.push(n);
        return { ok: true, output: "auto-merge armed" };
      },
      ...overrides,
    };
  }

  async function mergeHarness(
    issue: FakeIssue,
    github: GithubOps,
  ): Promise<Harness> {
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const sync = createSlackSync({
      slack,
      store,
      gateway,
      channelId: CHANNEL,
      operatorUserIds: [OPERATOR],
      log,
      consoleExecutors: {
        merge: createMergeExecutor({ gateway, store, github, log }),
      },
    });
    await sync.syncCandidate(candidateFor(issue), {
      kind: "advance",
      toStatus: issue.state,
      evidence: "seed",
    });
    const row = store.getSlackThreadByIssue(issue.id)!;
    return { gateway, slack, sync, threadTs: row.thread_ts };
  }

  /** Attempt row so the PR's head branch associates with the issue. */
  function seedAttempt(issue: FakeIssue, branch: string) {
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
      branch,
    });
  }

  it("merges a green, associated PR and acks the arm/merge outcome", async () => {
    const issue = makeIssue({ identifier: "THINK-70", state: "In Progress", labels: ["Claude"] });
    const gh = fakeGithub();
    const h = await mergeHarness(issue, gh);
    seedAttempt(issue, "auto/think-70-implement-a1");
    await typed(h, "merge 123");
    expect(gh.merges).toEqual([123]);
    // Checks summary posted BEFORE the merge ack (visibility, R8).
    const texts = h.slack.repliesIn(h.threadTs).map((p) => p.text);
    expect(texts.some((t) => t.includes("all checks pass"))).toBe(true);
    // Final ack rides the edited ⏳ progress line (chat.update).
    expect(h.slack.updates.some((u) => u.text.includes("auto-merge armed"))).toBe(true);
  });

  it("refuses a PR not associated with the thread's issue, naming the mismatch", async () => {
    const issue = makeIssue({ identifier: "THINK-71", state: "In Progress", labels: ["Claude"] });
    const gh = fakeGithub({
      prView: async (n) => ({
        number: n,
        state: "OPEN",
        title: "some unrelated PR",
        headRefName: "feature/other-thing",
        url: `https://github.test/pull/${n}`,
        mergedAt: null,
      }),
    });
    const h = await mergeHarness(issue, gh);
    await typed(h, "merge 999");
    expect(gh.merges).toEqual([]);
    const final = h.slack.updates[h.slack.updates.length - 1]?.text ?? lastReply(h);
    expect(final).toContain("Refusing to merge");
    expect(final).toContain("some unrelated PR");
    expect(final).toContain("feature/other-thing");
  });

  it("a failing-checks PR shows the failing checks before acting", async () => {
    const issue = makeIssue({ identifier: "THINK-72", state: "In Progress", labels: ["Claude"] });
    const gh = fakeGithub({
      prChecks: async () => ({ ok: false, summary: "test  fail  2m10s" }),
    });
    const h = await mergeHarness(issue, gh);
    seedAttempt(issue, "auto/think-70-implement-a1");
    await typed(h, "merge 5");
    const texts = h.slack.repliesIn(h.threadTs).map((p) => p.text);
    expect(texts.some((t) => t.includes("checks NOT green") && t.includes("fail"))).toBe(true);
    expect(gh.merges).toEqual([5]); // --auto only completes when checks pass
  });

  it("gh merge failure output surfaces in the ack (R11)", async () => {
    const issue = makeIssue({ identifier: "THINK-73", state: "In Progress", labels: ["Claude"] });
    const gh = fakeGithub({
      prMerge: async () => ({ ok: false, output: "GraphQL: Base branch was modified" }),
    });
    const h = await mergeHarness(issue, gh);
    seedAttempt(issue, "auto/think-70-implement-a1");
    await typed(h, "merge 7");
    const final = h.slack.updates[h.slack.updates.length - 1]?.text ?? "";
    expect(final).toContain("❌");
    expect(final).toContain("Base branch was modified");
  });

  it("non-numeric or missing arg is refused with usage", async () => {
    const issue = makeIssue({ identifier: "THINK-74", state: "In Progress", labels: ["Claude"] });
    const gh = fakeGithub();
    const h = await mergeHarness(issue, gh);
    await typed(h, "merge abc");
    expect(gh.merges).toEqual([]);
    const final = h.slack.updates[h.slack.updates.length - 1]?.text ?? lastReply(h);
    expect(final).toContain("Usage: `merge <pr#>`");
  });

  it("an already-merged PR is an idempotent no-op ack", async () => {
    const issue = makeIssue({ identifier: "THINK-75", state: "In Progress", labels: ["Claude"] });
    const gh = fakeGithub({
      prView: async (n) => ({
        number: n,
        state: "MERGED",
        title: "feat: thing",
        headRefName: "auto/think-70-implement-a1",
        url: `https://github.test/pull/${n}`,
        mergedAt: "2026-07-13T00:00:00Z",
      }),
    });
    const h = await mergeHarness(issue, gh);
    await typed(h, "merge 3");
    expect(gh.merges).toEqual([]);
    const final = h.slack.updates[h.slack.updates.length - 1]?.text ?? "";
    expect(final).toContain("already merged");
  });
});

describe("U6: inspection executors", () => {
  function inspectionHarness(
    issue: FakeIssue,
    opts: { github?: Partial<GithubOps> } = {},
  ) {
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const github: GithubOps = {
      prsForBranch: async () => [],
      prView: async () => null,
      prChecks: async () => ({ ok: true, summary: "" }),
      prMerge: async () => ({ ok: true, output: "" }),
      ...opts.github,
    };
    const artifactsRoot = join(dir, "artifacts");
    const sync = createSlackSync({
      slack,
      store,
      gateway,
      channelId: CHANNEL,
      operatorUserIds: [OPERATOR],
      log,
      consoleExecutors: createInspectionExecutors({
        gateway,
        store,
        github,
        slack,
        transport: new LocalTransport(),
        artifactsDirFor: (id) => join(artifactsRoot, id),
        log,
      }),
    });
    return { gateway, slack, sync, artifactsRoot };
  }

  async function enrollFor(sync: SlackSync, issue: FakeIssue): Promise<string> {
    await sync.syncCandidate(candidateFor(issue), {
      kind: "advance",
      toStatus: issue.state,
      evidence: "seed",
    });
    return store.getSlackThreadByIssue(issue.id)!.thread_ts;
  }

  it("AE4: artifacts present → screenshots upload inline into the thread", async () => {
    const issue = makeIssue({
      identifier: "THINK-80",
      state: "Verification",
      labels: ["Claude"],
      comments: [
        { id: "h1", body: "handoff:THINK-80:Done\n\nGoal reached; everything verified.", authorId: "viewer-daemon" },
      ],
    });
    const h = inspectionHarness(issue);
    const threadTs = await enrollFor(h.sync, issue);
    const artDir = join(h.artifactsRoot, "THINK-80");
    mkdirSync(artDir, { recursive: true });
    writeFileSync(join(artDir, "01-login.png"), "png");
    writeFileSync(join(artDir, "02-board.png"), "png");
    writeFileSync(join(artDir, "notes.txt"), "not an image");

    await h.sync.handleInbound({
      channel: CHANNEL, threadTs, ts: "9.1", userId: OPERATOR, text: "result",
    });

    expect(h.slack.uploads).toHaveLength(1);
    expect(h.slack.uploads[0].threadTs).toBe(threadTs);
    expect(h.slack.uploads[0].paths).toHaveLength(2);
    expect(h.slack.uploads[0].paths.every((p) => p.endsWith(".png"))).toBe(true);
    // The final ack (edited ⏳ line) carries the handoff summary.
    const final = h.slack.updates[h.slack.updates.length - 1];
    expect(JSON.stringify(final.blocks)).toContain("Goal reached");
  });

  it("result with no artifacts says so plainly", async () => {
    const issue = makeIssue({ identifier: "THINK-81", state: "Verification", labels: ["Claude"] });
    const h = inspectionHarness(issue);
    const threadTs = await enrollFor(h.sync, issue);
    await h.sync.handleInbound({
      channel: CHANNEL, threadTs, ts: "9.2", userId: OPERATOR, text: "result",
    });
    expect(h.slack.uploads).toHaveLength(0);
    const final = h.slack.updates[h.slack.updates.length - 1];
    expect(JSON.stringify(final.blocks)).toContain("No screenshots on file");
  });

  it("result surfaces merged PR links from the issue's attempt branches", async () => {
    const issue = makeIssue({ identifier: "THINK-82", state: "Done", labels: ["Claude"] });
    // enroll while active
    issue.state = "Verification";
    const h = inspectionHarness(issue, {
      github: {
        prsForBranch: async () => [
          { number: 42, state: "MERGED", url: "https://github.test/pull/42", mergedAt: "2026-07-13T00:00:00Z" },
        ],
      },
    });
    const threadTs = await enrollFor(h.sync, issue);
    store.upsertIssue({
      issueId: issue.id, identifier: issue.identifier, phase: "implement",
      state: issue.state, lane: "Claude",
    });
    store.insertAttempt({
      issueId: issue.id, phase: "implement", attemptNumber: 1,
      state: "Succeeded", host: "local", pid: 1, branch: "auto/think-82-implement-a1",
    });
    await h.sync.handleInbound({
      channel: CHANNEL, threadTs, ts: "9.3", userId: OPERATOR, text: "result",
    });
    const final = h.slack.updates[h.slack.updates.length - 1];
    expect(JSON.stringify(final.blocks)).toContain("pull/42");
  });

  it("upload failure is acked, result still renders (R11)", async () => {
    const issue = makeIssue({ identifier: "THINK-83", state: "Verification", labels: ["Claude"] });
    const h = inspectionHarness(issue);
    const threadTs = await enrollFor(h.sync, issue);
    const artDir = join(h.artifactsRoot, "THINK-83");
    mkdirSync(artDir, { recursive: true });
    writeFileSync(join(artDir, "01-x.png"), "png");
    h.slack.uploadError = new Error("missing_scope: files:write");
    await h.sync.handleInbound({
      channel: CHANNEL, threadTs, ts: "9.4", userId: OPERATOR, text: "result",
    });
    const final = h.slack.updates[h.slack.updates.length - 1];
    expect(JSON.stringify(final.blocks)).toContain("upload failed");
    expect(JSON.stringify(final.blocks)).toContain("missing_scope");
  });

  it("logs tails the newest attempt log via the transport, fenced", async () => {
    const issue = makeIssue({ identifier: "THINK-84", state: "In Progress", labels: ["Claude"] });
    const h = inspectionHarness(issue);
    const threadTs = await enrollFor(h.sync, issue);
    const logPath = join(dir, "worker.log");
    writeFileSync(logPath, Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n"));
    store.upsertIssue({
      issueId: issue.id, identifier: issue.identifier, phase: "implement",
      state: issue.state, lane: "Claude",
    });
    store.insertAttempt({
      issueId: issue.id, phase: "implement", attemptNumber: 2,
      state: "Running", host: "local", pid: 9, logPath,
    });
    await h.sync.handleInbound({
      channel: CHANNEL, threadTs, ts: "9.5", userId: OPERATOR, text: "logs 10",
    });
    const texts = h.slack.repliesIn(threadTs).map((p) => JSON.stringify(p.blocks ?? p.text));
    const logReply = texts.find((t) => t.includes("line 60"));
    expect(logReply).toBeDefined();
    expect(logReply).not.toContain("line 50"); // only the last 10 lines
    expect(logReply).toContain("attempt 2");
  });

  it("logs with no attempt on file says so", async () => {
    const issue = makeIssue({ identifier: "THINK-85", state: "In Progress", labels: ["Claude"] });
    const h = inspectionHarness(issue);
    const threadTs = await enrollFor(h.sync, issue);
    await h.sync.handleInbound({
      channel: CHANNEL, threadTs, ts: "9.6", userId: OPERATOR, text: "logs",
    });
    expect(lastReplyText(h.slack, threadTs)).toContain("no worker log yet");
  });
});

function lastReplyText(slack: FakeSlackGateway, threadTs: string): string {
  const replies = slack.repliesIn(threadTs);
  return replies[replies.length - 1]?.text ?? "";
}

describe("newestImages", () => {
  it("returns newest-first, images only, capped", () => {
    const d = join(dir, "imgs");
    mkdirSync(d, { recursive: true });
    for (let i = 1; i <= 12; i++) {
      const p = join(d, `${String(i).padStart(2, "0")}-shot.png`);
      writeFileSync(p, "x");
      const t = new Date(2026, 0, i).getTime() / 1000;
      utimesSync(p, t, t);
    }
    writeFileSync(join(d, "readme.md"), "x");
    const imgs = newestImages(d, 10);
    expect(imgs).toHaveLength(10);
    expect(imgs[0]).toContain("12-shot.png");
    expect(imgs.every((p) => p.endsWith(".png"))).toBe(true);
    expect(newestImages(join(d, "missing"), 10)).toEqual([]);
  });
});

describe("U8: release confirm round-trip", () => {
  interface GitCall {
    cmd: string;
    args: string[];
  }

  /** Scripted transport: canned tag list + sha; records tag/push calls. */
  function fakeTransport(opts: { sha?: string; shaAfterConfirm?: string; existingTag?: string } = {}) {
    const calls: GitCall[] = [];
    let fetches = 0;
    return {
      calls,
      async exec(cmd: string, args: string[]) {
        calls.push({ cmd, args });
        if (cmd === "git" && args[0] === "fetch") {
          fetches += 1;
          return { code: 0, stdout: "", stderr: "" };
        }
        if (cmd === "git" && args[0] === "tag" && args[1] === "--list" && args[2] === "v0.1.0-canary.*") {
          return { code: 0, stdout: "v0.1.0-canary.354\nv0.1.0-canary.353\n", stderr: "" };
        }
        if (cmd === "git" && args[0] === "tag" && args[1] === "--list") {
          // collision probe for a specific tag
          return {
            code: 0,
            stdout: opts.existingTag !== undefined && args[2] === opts.existingTag ? opts.existingTag : "",
            stderr: "",
          };
        }
        if (cmd === "git" && args[0] === "rev-parse") {
          const sha =
            fetches >= 2 && opts.shaAfterConfirm !== undefined
              ? opts.shaAfterConfirm
              : (opts.sha ?? "abc1234def5678");
          return { code: 0, stdout: sha + "\n", stderr: "" };
        }
        if (cmd === "git" && (args[0] === "tag" || args[0] === "push")) {
          return { code: 0, stdout: "", stderr: "" };
        }
        if (cmd === "gh") {
          return { code: 0, stdout: JSON.stringify([{ url: "https://github.test/actions/runs/1" }]), stderr: "" };
        }
        return { code: 0, stdout: "", stderr: "" };
      },
    };
  }

  async function releaseHarness(transport: ReturnType<typeof fakeTransport>) {
    const issue = makeIssue({ identifier: "THINK-90", state: "Verification", labels: ["Claude"] });
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const sync = createSlackSync({
      slack,
      store,
      gateway,
      channelId: CHANNEL,
      operatorUserIds: [OPERATOR],
      log,
      repoExecutors: createReleaseExecutors({
        store,
        slack,
        transport,
        repoPath: "/fake/repo",
        channelId: CHANNEL,
        release: DEFAULT_RELEASE,
        log,
      }),
    });
    await sync.syncCandidate(candidateFor(issue), {
      kind: "advance",
      toStatus: issue.state,
      evidence: "seed",
    });
    const threadTs = store.getSlackThreadByIssue(issue.id)!.thread_ts;
    return { slack, sync, threadTs };
  }

  function offerToken(): string {
    return (JSON.parse(store.getMeta(RELEASE_OFFER_KEY)!) as { token: string }).token;
  }

  function taggedRefs(t: ReturnType<typeof fakeTransport>): string[] {
    return t.calls
      .filter((c) => c.cmd === "git" && c.args[0] === "tag" && c.args[1]?.startsWith("v0.1.0") === false && c.args[1] !== "--list" && c.args[1] !== "-d")
      .map((c) => c.args[1]);
  }

  function tagCreates(t: ReturnType<typeof fakeTransport>): string[] {
    return t.calls
      .filter((c) => c.cmd === "git" && c.args[0] === "tag" && c.args.length === 3 && c.args[1] !== "--list" && c.args[1] !== "--list" && c.args[1] !== "-d")
      .map((c) => c.args[1]);
  }

  it("release derives next N and offers the pair + sha; nothing tags until confirm", async () => {
    const t = fakeTransport({ sha: "abc1234def5678" });
    const h = await releaseHarness(t);
    await h.sync.handleInbound({ channel: CHANNEL, threadTs: h.threadTs, ts: "7.1", userId: OPERATOR, text: "release" });
    const confirm = h.slack.updates[h.slack.updates.length - 1];
    expect(confirm.text).toContain("v0.1.0-canary.355");
    expect(confirm.text).toContain("desktop-v0.1.0-canary.355");
    expect(confirm.text).toContain("abc1234def");
    expect(tagCreates(t)).toEqual([]); // offer only — no tag yet
    // Confirm/Cancel buttons ride the offer, token stored with the message ts.
    expect(JSON.stringify(confirm.blocks)).toContain("factory-console:release-confirm");
    const offer = JSON.parse(store.getMeta(RELEASE_OFFER_KEY)!) as { messageTs: string | null };
    expect(offer.messageTs).toBe(confirm.ts);
  });

  it("confirm with the matching token tags the STORED sha and pushes the pair", async () => {
    const t = fakeTransport({ sha: "abc1234def5678" });
    const h = await releaseHarness(t);
    await h.sync.handleInbound({ channel: CHANNEL, threadTs: h.threadTs, ts: "7.2", userId: OPERATOR, text: "release" });
    const token = offerToken();
    await h.sync.handleAction({
      channel: CHANNEL, messageTs: "1.1", threadTs: h.threadTs, userId: OPERATOR,
      actionId: "factory-console:release-confirm",
      value: JSON.stringify({ v: "release-confirm", arg: token }),
    });
    const creates = t.calls.filter((c) => c.cmd === "git" && c.args[0] === "tag" && c.args.length === 3 && c.args[1] !== "--list");
    expect(creates.map((c) => c.args[1])).toEqual(["v0.1.0-canary.355", "desktop-v0.1.0-canary.355"]);
    expect(creates.every((c) => c.args[2] === "abc1234def5678")).toBe(true);
    const push = t.calls.find((c) => c.cmd === "git" && c.args[0] === "push");
    expect(push!.args).toContain("v0.1.0-canary.355");
    expect(push!.args).toContain("desktop-v0.1.0-canary.355");
    // Token consumed; the confirm message's buttons were stripped.
    expect(store.getMeta(RELEASE_OFFER_KEY)).toBeUndefined();
    const stripped = h.slack.updates.find((u) => u.text.includes("🚢 Cut"));
    expect(stripped).toBeDefined();
  }, 30_000);

  it("AE2: a stale/mismatched token is a polite no-op — nothing tags", async () => {
    const t = fakeTransport();
    const h = await releaseHarness(t);
    await h.sync.handleAction({
      channel: CHANNEL, messageTs: "1.1", threadTs: h.threadTs, userId: OPERATOR,
      actionId: "factory-console:release-confirm",
      value: JSON.stringify({ v: "release-confirm", arg: "no-such-token" }),
    });
    expect(
      t.calls.filter((c) => c.args[0] === "tag" && c.args.length === 3 && c.args[1] !== "--list"),
    ).toEqual([]);
    const final = h.slack.updates[h.slack.updates.length - 1];
    expect(final.text).toContain("no longer live");
  });

  it("AE2: a non-operator confirm click is refused; nothing executes", async () => {
    const t = fakeTransport();
    const h = await releaseHarness(t);
    await h.sync.handleInbound({ channel: CHANNEL, threadTs: h.threadTs, ts: "7.3", userId: OPERATOR, text: "release" });
    const token = offerToken();
    await h.sync.handleAction({
      channel: CHANNEL, messageTs: "1.1", threadTs: h.threadTs, userId: STRANGER,
      actionId: "factory-console:release-confirm",
      value: JSON.stringify({ v: "release-confirm", arg: token }),
    });
    expect(
      t.calls.filter((c) => c.args[0] === "tag" && c.args.length === 3 && c.args[1] !== "--list"),
    ).toEqual([]);
    expect(store.getMeta(RELEASE_OFFER_KEY)).toBeDefined(); // offer still live
  });

  it("confirm after origin/main advanced refuses and never tags the new head", async () => {
    const t = fakeTransport({ sha: "abc1234def5678", shaAfterConfirm: "fff9999aaa0000" });
    const h = await releaseHarness(t);
    await h.sync.handleInbound({ channel: CHANNEL, threadTs: h.threadTs, ts: "7.4", userId: OPERATOR, text: "release" });
    const token = offerToken();
    await h.sync.handleAction({
      channel: CHANNEL, messageTs: "1.1", threadTs: h.threadTs, userId: OPERATOR,
      actionId: "factory-console:release-confirm",
      value: JSON.stringify({ v: "release-confirm", arg: token }),
    });
    expect(
      t.calls.filter((c) => c.args[0] === "tag" && c.args.length === 3 && c.args[1] !== "--list"),
    ).toEqual([]);
    const final = h.slack.updates[h.slack.updates.length - 1];
    expect(final.text).toContain("origin/main advanced");
    expect(store.getMeta(RELEASE_OFFER_KEY)).toBeUndefined(); // consumed
  });

  it("cancel clears the token and strips the offer's buttons", async () => {
    const t = fakeTransport();
    const h = await releaseHarness(t);
    await h.sync.handleInbound({ channel: CHANNEL, threadTs: h.threadTs, ts: "7.5", userId: OPERATOR, text: "release" });
    const token = offerToken();
    const offerTs = (JSON.parse(store.getMeta(RELEASE_OFFER_KEY)!) as { messageTs: string }).messageTs;
    await h.sync.handleAction({
      channel: CHANNEL, messageTs: offerTs, threadTs: h.threadTs, userId: OPERATOR,
      actionId: "factory-console:release-cancel",
      value: JSON.stringify({ v: "release-cancel", arg: token }),
    });
    expect(store.getMeta(RELEASE_OFFER_KEY)).toBeUndefined();
    const resolved = h.slack.updates.find((u) => u.ts === offerTs && u.text.includes("cancelled"));
    expect(resolved).toBeDefined();
    expect(
      t.calls.filter((c) => c.args[0] === "tag" && c.args.length === 3 && c.args[1] !== "--list"),
    ).toEqual([]);
  });

  it("double-confirm is idempotent — the second click finds no token", async () => {
    const t = fakeTransport({ sha: "abc1234def5678" });
    const h = await releaseHarness(t);
    await h.sync.handleInbound({ channel: CHANNEL, threadTs: h.threadTs, ts: "7.6", userId: OPERATOR, text: "release" });
    const token = offerToken();
    const click = () =>
      h.sync.handleAction({
        channel: CHANNEL, messageTs: "1.1", threadTs: h.threadTs, userId: OPERATOR,
        actionId: "factory-console:release-confirm",
        value: JSON.stringify({ v: "release-confirm", arg: token }),
      });
    await click();
    await click();
    const creates = t.calls.filter((c) => c.cmd === "git" && c.args[0] === "tag" && c.args.length === 3 && c.args[1] !== "--list");
    expect(creates).toHaveLength(2); // one pair, once
    const final = h.slack.updates[h.slack.updates.length - 1];
    expect(final.text).toContain("no longer live");
  }, 30_000);

  it("a tag collision surfaces in the ack and nothing pushes", async () => {
    const t = fakeTransport({ sha: "abc1234def5678", existingTag: "v0.1.0-canary.355" });
    const h = await releaseHarness(t);
    await h.sync.handleInbound({ channel: CHANNEL, threadTs: h.threadTs, ts: "7.7", userId: OPERATOR, text: "release" });
    const token = offerToken();
    await h.sync.handleAction({
      channel: CHANNEL, messageTs: "1.1", threadTs: h.threadTs, userId: OPERATOR,
      actionId: "factory-console:release-confirm",
      value: JSON.stringify({ v: "release-confirm", arg: token }),
    });
    expect(t.calls.filter((c) => c.args[0] === "push")).toEqual([]);
    const final = h.slack.updates[h.slack.updates.length - 1];
    expect(final.text).toContain("already exists");
  });
});

describe("nextN (release scheme)", () => {
  it("derives from the newest-first tag list; empty list starts at 1", () => {
    expect(nextN("v0.1.0-canary.<N>", "v0.1.0-canary.354\nv0.1.0-canary.353\n")).toBe(355);
    expect(nextN("v0.1.0-canary.<N>", "")).toBe(1);
    expect(nextN("v0.1.0-canary.<N>", "garbage\nv0.1.0-canary.7")).toBe(8);
  });
});

describe("U10: doctor console-scope checks", () => {
  it("passes pins:read when the gateway accepts the probe; checklist item present", async () => {
    const slack = new FakeSlackGateway();
    const checks = await slackConsoleChecks(slack, CHANNEL);
    const pins = checks.find((c) => c.name === "slack-pins-read")!;
    expect(pins.ok).toBe(true);
    const checklist = checks.find((c) => c.name === "slack-scope-checklist")!;
    expect(checklist.ok).toBe(true);
    expect(checklist.detail).toContain("pins:write");
    expect(checklist.detail).toContain("files:write");
    expect(checklist.detail).toContain("not probe-able");
  });

  it("reports a pins.list failure as missing pins:read with the fix named", async () => {
    const slack = new FakeSlackGateway();
    slack.listPinsError = new Error("missing_scope: pins:read");
    const checks = await slackConsoleChecks(slack, CHANNEL);
    const pins = checks.find((c) => c.name === "slack-pins-read")!;
    expect(pins.ok).toBe(false);
    expect(pins.detail).toContain("pins:read");
    expect(pins.detail).toContain("reinstall");
  });
});
