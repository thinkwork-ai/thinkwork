/**
 * Un-enrollment pass: an enrolled issue that left the active work queue
 * (Backlog / Canceled / lane label removed / deleted) is fully wound down —
 * thread closed + row deleted, active attempt canceled, worker killed, leases /
 * nag timers / locks released. A transient poll miss on a still-valid candidate
 * is NEVER un-enrolled. A Done+compounded issue is closed with a summary and
 * nothing killed. Store cleanup happens even with no Slack surface.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLogger, type Logger } from "../src/logger.js";
import type { PollCandidate } from "../src/linear/poller.js";
import { createSlackSync, type SlackSync } from "../src/slack/sync.js";
import { runUnenrollPass } from "../src/reconcile/unenroll.js";
import { openStore, type FactoryStore } from "../src/store/db.js";
import { DEV_DEPLOYMENT_LOCK } from "../src/sweep/locks.js";
import type {
  ExecResult,
  HostTransport,
  SpawnDetachedRequest,
} from "../src/workers/transport.js";
import { FakeGateway, makeIssue, type FakeIssue } from "./fake-gateway.js";
import { FakeSlackGateway } from "./fake-slack.js";

const CHANNEL = "C_FACTORY";
const OPERATOR = "UOP";

let dir: string;
let store: FactoryStore;
let log: Logger;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-unenroll-test-"));
  store = openStore(dir);
  log = createLogger({ write: () => {}, level: "error" });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

class FakeTransport implements HostTransport {
  pids = new Set<number>();
  killed: number[] = [];

  async exec(): Promise<ExecResult> {
    return { code: 0, stdout: "", stderr: "" };
  }
  async spawnDetached(_req: SpawnDetachedRequest): Promise<{ pid: number }> {
    return { pid: 1 };
  }
  async probe(): Promise<boolean> {
    return true;
  }
  async pidAlive(pid: number): Promise<boolean> {
    return this.pids.has(pid);
  }
  async readFileText(): Promise<string> {
    return "";
  }
  async readTail(): Promise<string> {
    return "";
  }
  async statMtimeMs(): Promise<number | null> {
    return null;
  }
  async writeFileText(): Promise<void> {}
  async killPidGroup(pid: number): Promise<boolean> {
    this.killed.push(pid);
    return true;
  }
}

function candidateFor(
  issue: FakeIssue,
  opts: { hasLfg?: boolean; compounded?: boolean; blockerLabels?: string[] } = {},
): PollCandidate {
  return {
    issue,
    lane: "Claude",
    hasLfg: opts.hasLfg ?? false,
    isVerification: false,
    blockerLabels: opts.blockerLabels ?? [],
    ledger: {
      ledger: {
        phase: "implement",
        lane: "Claude",
        worker: null,
        attempt: 0,
        blocker: null,
        compounded: opts.compounded ?? false,
      },
      prose: "",
      synthesized: false,
      warnings: [],
    },
    ledgerCommentId: null,
    comments: issue.comments,
  };
}

function makeSlack(gateway: FakeGateway, slack: FakeSlackGateway): SlackSync {
  return createSlackSync({
    slack,
    store,
    gateway,
    channelId: CHANNEL,
    operatorUserIds: [OPERATOR],
    log,
  });
}

/** Enroll an issue: open its thread, record an active attempt, lease + lock. */
function enroll(
  issue: FakeIssue,
  opts: { pid?: number | null } = {},
): number {
  store.upsertSlackThread({
    issueId: issue.id,
    identifier: issue.identifier,
    channelId: CHANNEL,
    threadTs: `ts-${issue.identifier}`,
  });
  const attemptId = store.insertAttempt({
    issueId: issue.id,
    phase: "implement",
    attemptNumber: 1,
    state: "Running",
    pid: opts.pid === undefined ? 4242 : opts.pid ?? undefined,
  });
  store.upsertLease({
    issueId: issue.id,
    attemptId,
    expiresAt: "2999-01-01T00:00:00.000Z",
    heartbeatAt: "2026-01-01T00:00:00.000Z",
  });
  store.upsertNagTimer({
    issueId: issue.id,
    kind: "question",
    nextFireAt: "2999-01-01T00:00:00.000Z",
    intervalMinutes: 30,
  });
  store.acquireLock(DEV_DEPLOYMENT_LOCK, issue.id, "2026-01-01T00:00:00.000Z");
  return attemptId;
}

function assertFullyUnenrolled(issue: FakeIssue, attemptId: number) {
  expect(store.getSlackThreadByIssue(issue.id)).toBeUndefined();
  expect(store.getLease(issue.id)).toBeUndefined();
  expect(store.getNagTimer(issue.id, "question")).toBeUndefined();
  expect(store.getLock(DEV_DEPLOYMENT_LOCK)).toBeUndefined();
  const attempt = store.getAttempt(attemptId);
  expect(attempt?.state).toBe("CanceledByReconciliation");
  expect(attempt?.active).toBe(0);
}

describe("runUnenrollPass — abandoned", () => {
  it("un-enrolls an enrolled issue moved to Backlog: thread closed, rows deleted, worker killed", async () => {
    const issue = makeIssue({
      identifier: "THINK-100",
      state: "Backlog",
      labels: ["Claude"],
    });
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const transport = new FakeTransport();
    transport.pids.add(4242);
    const attemptId = enroll(issue);

    // Backlog ∉ ACTIVE_STATES → NOT a candidate this tick.
    const result = await runUnenrollPass(
      { store, gateway, transport, log, slack: makeSlack(gateway, slack) },
      [],
    );

    expect(result.outcomes).toEqual([{ issue: "THINK-100", verdict: "abandoned" }]);
    assertFullyUnenrolled(issue, attemptId);
    expect(transport.killed).toEqual([4242]);
    expect(
      slack.posts.some((p) => p.text.includes("Un-enrolled")),
    ).toBe(true);
  });

  it("un-enrolls a Canceled issue", async () => {
    const issue = makeIssue({
      identifier: "THINK-101",
      state: "Canceled",
      labels: ["Claude"],
    });
    const gateway = new FakeGateway([issue]);
    const transport = new FakeTransport();
    transport.pids.add(4242);
    const attemptId = enroll(issue);

    const result = await runUnenrollPass(
      { store, gateway, transport, log },
      [],
    );

    expect(result.outcomes).toEqual([{ issue: "THINK-101", verdict: "abandoned" }]);
    assertFullyUnenrolled(issue, attemptId);
  });

  it("un-enrolls an enrolled issue demoted BACK to Todo (below the Brainstorming floor)", async () => {
    // Todo ∉ ACTIVE_STATES — the enrollment floor is Brainstorming. An enrolled
    // issue an operator moves back to Todo has left the active work queue and
    // must be wound down just like a Backlog demotion.
    const issue = makeIssue({
      identifier: "THINK-103",
      state: "Todo",
      labels: ["Claude"],
    });
    const gateway = new FakeGateway([issue]);
    const transport = new FakeTransport();
    transport.pids.add(4242);
    const attemptId = enroll(issue);

    const result = await runUnenrollPass(
      { store, gateway, transport, log },
      [],
    );

    expect(result.outcomes).toEqual([{ issue: "THINK-103", verdict: "abandoned" }]);
    assertFullyUnenrolled(issue, attemptId);
    expect(transport.killed).toEqual([4242]);
  });

  it("un-enrolls an issue whose lane label was removed", async () => {
    const issue = makeIssue({
      identifier: "THINK-102",
      state: "In Progress",
      labels: [], // lane label removed
    });
    const gateway = new FakeGateway([issue]);
    const transport = new FakeTransport();
    transport.pids.add(4242);
    const attemptId = enroll(issue);

    const result = await runUnenrollPass(
      { store, gateway, transport, log },
      [],
    );

    expect(result.outcomes).toEqual([{ issue: "THINK-102", verdict: "abandoned" }]);
    assertFullyUnenrolled(issue, attemptId);
  });

  it("NEVER un-enrolls or kills on an unverifiable absence (issue not returned by the fetch — indistinguishable from a throttle)", async () => {
    // Safety: getIssuesByIdentifier silently omits an issue it could not fetch
    // (throttle/429/network), which looks identical to a deletion. The pass must
    // DEFER on absence, never kill a possibly-still-active worker.
    const issue = makeIssue({
      identifier: "THINK-103",
      state: "In Progress",
      labels: ["Claude"],
    });
    // Gateway returns NOTHING for the id (deleted OR throttled — same shape).
    const gateway = new FakeGateway([]);
    const transport = new FakeTransport();
    transport.pids.add(4242);
    store.upsertIssue({
      issueId: issue.id,
      identifier: issue.identifier,
      lane: "Claude",
      phase: "implement",
      state: "In Progress",
    });
    const attemptId = enroll(issue);

    const result = await runUnenrollPass({ store, gateway, transport, log }, []);

    // Deferred: no verdict, thread + attempt + worker all left intact.
    expect(result.outcomes).toEqual([]);
    expect(store.getSlackThreadByIssue(issue.id)).toBeDefined();
    expect(store.getAttempt(attemptId)!.state).not.toBe("CanceledByReconciliation");
    expect(transport.killed).toEqual([]);
  });

  it("does NOT un-enroll when getIssuesByIdentifier throws (whole batch defers)", async () => {
    const issue = makeIssue({
      identifier: "THINK-104",
      state: "In Progress",
      labels: ["Claude"],
    });
    const gateway = new FakeGateway([issue]);
    gateway.getIssuesByIdentifier = async () => {
      throw new Error("429 rate limited");
    };
    const transport = new FakeTransport();
    transport.pids.add(4243);
    store.upsertIssue({
      issueId: issue.id,
      identifier: issue.identifier,
      lane: "Claude",
      phase: "implement",
      state: "In Progress",
    });
    const attemptId = enroll(issue);

    const result = await runUnenrollPass({ store, gateway, transport, log }, []);

    expect(result.outcomes).toEqual([]);
    expect(store.getSlackThreadByIssue(issue.id)).toBeDefined();
    expect(store.getAttempt(attemptId)!.state).not.toBe("CanceledByReconciliation");
    expect(transport.killed).toEqual([]);
  });
});

describe("runUnenrollPass — transient-miss guard", () => {
  it("does NOT un-enroll an enrolled id missing from candidates but still a valid In-Progress+lane candidate", async () => {
    const issue = makeIssue({
      identifier: "THINK-110",
      state: "In Progress",
      labels: ["Claude"],
    });
    const gateway = new FakeGateway([issue]);
    const transport = new FakeTransport();
    transport.pids.add(4242);
    const attemptId = enroll(issue);

    // Empty candidate set this tick (a transient poll miss), but the live fetch
    // shows a still-valid In-Progress+lane candidate.
    const result = await runUnenrollPass(
      { store, gateway, transport, log },
      [],
    );

    expect(result.outcomes).toEqual([]);
    // Nothing touched.
    expect(store.getSlackThreadByIssue(issue.id)).toBeDefined();
    expect(store.getLease(issue.id)).toBeDefined();
    expect(store.getAttempt(attemptId)?.state).toBe("Running");
    expect(transport.killed).toEqual([]);
  });
});

describe("runUnenrollPass — completed", () => {
  it("closes a Done+compounded enrolled issue with a summary and kills nothing", async () => {
    const issue = makeIssue({
      identifier: "THINK-120",
      state: "Done",
      labels: ["Claude", "LFG"],
    });
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const transport = new FakeTransport();
    // Enroll WITHOUT an active attempt (a completed issue has no live worker).
    store.upsertSlackThread({
      issueId: issue.id,
      identifier: issue.identifier,
      channelId: CHANNEL,
      threadTs: `ts-${issue.identifier}`,
    });

    const candidate = candidateFor(issue, { hasLfg: true, compounded: true });
    const result = await runUnenrollPass(
      { store, gateway, transport, log, slack: makeSlack(gateway, slack) },
      [candidate],
    );

    expect(result.outcomes).toEqual([{ issue: "THINK-120", verdict: "completed" }]);
    expect(store.getSlackThreadByIssue(issue.id)).toBeUndefined();
    expect(transport.killed).toEqual([]);
    expect(slack.posts.some((p) => p.text.includes("Done"))).toBe(true);
  });

  it("classifies a Done MISS as completed (Done is no longer enrolled): summary posted, nothing killed", async () => {
    // Done ∉ ACTIVE_STATES, so a finished enrolled issue drops out of the
    // candidate set and must be classified from the batched miss-fetch as
    // COMPLETED (checkered-flag summary, no worker kill) — never abandoned.
    const issue = makeIssue({
      identifier: "THINK-122",
      state: "Done",
      labels: ["Claude", "LFG"],
    });
    const gateway = new FakeGateway([issue]);
    const slack = new FakeSlackGateway();
    const transport = new FakeTransport();
    store.upsertSlackThread({
      issueId: issue.id,
      identifier: issue.identifier,
      channelId: CHANNEL,
      threadTs: `ts-${issue.identifier}`,
    });

    const result = await runUnenrollPass(
      { store, gateway, transport, log, slack: makeSlack(gateway, slack) },
      [], // Done issue is missing from the candidate set
    );

    expect(result.outcomes).toEqual([{ issue: "THINK-122", verdict: "completed" }]);
    expect(store.getSlackThreadByIssue(issue.id)).toBeUndefined();
    expect(transport.killed).toEqual([]);
    expect(slack.posts.some((p) => p.text.includes("Done"))).toBe(true);
  });

  it("closes a non-LFG Done enrolled issue (nothing left to compound)", async () => {
    const issue = makeIssue({
      identifier: "THINK-121",
      state: "Done",
      labels: ["Claude"], // no LFG → never compounds
    });
    const gateway = new FakeGateway([issue]);
    const transport = new FakeTransport();
    store.upsertSlackThread({
      issueId: issue.id,
      identifier: issue.identifier,
      channelId: CHANNEL,
      threadTs: `ts-${issue.identifier}`,
    });

    const candidate = candidateFor(issue, { hasLfg: false, compounded: false });
    const result = await runUnenrollPass(
      { store, gateway, transport, log },
      [candidate],
    );

    expect(result.outcomes).toEqual([{ issue: "THINK-121", verdict: "completed" }]);
    expect(store.getSlackThreadByIssue(issue.id)).toBeUndefined();
  });
});

describe("runUnenrollPass — Slack absent", () => {
  it("still cleans store rows and winds down the worker with no Slack surface", async () => {
    const issue = makeIssue({
      identifier: "THINK-130",
      state: "Backlog",
      labels: ["Claude"],
    });
    const gateway = new FakeGateway([issue]);
    const transport = new FakeTransport();
    transport.pids.add(4242);
    const attemptId = enroll(issue);

    // No `slack` in deps.
    const result = await runUnenrollPass(
      { store, gateway, transport, log },
      [],
    );

    expect(result.outcomes).toEqual([{ issue: "THINK-130", verdict: "abandoned" }]);
    assertFullyUnenrolled(issue, attemptId);
    expect(transport.killed).toEqual([4242]);
  });
});
