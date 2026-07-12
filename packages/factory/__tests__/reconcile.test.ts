/**
 * Boot/periodic reconciliation (U7, F4/AE6). Every scenario uses a temp state
 * dir, a fake transport with an injected clock, and the in-memory FakeGateway —
 * no real launchctl, no network, no wall-clock.
 *
 * Covered:
 *   - orphaned active attempt (no pid) → expired, relaunch queued (AE6 shape);
 *   - dead-pid orphan with an externally-merged PR → phase adopted + advanced,
 *     NO relaunch of implement;
 *   - a genuinely live worker → reattached, never expired;
 *   - unreachable host → frozen, never expired (AE4 guard);
 *   - launch-recording-failed → ledger re-applied, flag cleared, idempotent;
 *   - deleted store → rebuilt from a Linear scan with NO dispatch.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLogger, type Logger } from "../src/logger.js";
import {
  reconcile,
  LAUNCH_RECORDING_FAILED_PREFIX,
  type ReconcileDeps,
} from "../src/reconcile/reconciler.js";
import type { GithubGateway, PrInfo } from "../src/phases/evidence.js";
import { openStore, type FactoryStore } from "../src/store/db.js";
import { DEV_DEPLOYMENT_LOCK } from "../src/sweep/locks.js";
import type {
  ExecResult,
  HostTransport,
  SpawnDetachedRequest,
} from "../src/workers/transport.js";
import { FakeGateway, makeIssue } from "./fake-gateway.js";

// ---------------------------------------------------------------------------
// fakes
// ---------------------------------------------------------------------------

class ReconcileTransport implements HostTransport {
  reachable = true;
  alivePids = new Set<number>();
  mtimeByPath = new Map<string, number>();
  killed: number[] = [];

  async exec(): Promise<ExecResult> {
    return { code: 0, stdout: "", stderr: "" };
  }
  async spawnDetached(_req: SpawnDetachedRequest): Promise<{ pid: number }> {
    return { pid: 1 };
  }
  async probe(): Promise<boolean> {
    return this.reachable;
  }
  async pidAlive(pid: number): Promise<boolean> {
    return this.alivePids.has(pid);
  }
  async readFileText(): Promise<string> {
    return "";
  }
  async readTail(): Promise<string> {
    return "";
  }
  async statMtimeMs(path: string): Promise<number | null> {
    return this.mtimeByPath.get(path) ?? null;
  }
  async writeFileText(): Promise<void> {}
  async killPidGroup(pid: number): Promise<boolean> {
    this.killed.push(pid);
    this.alivePids.delete(pid);
    return true;
  }
}

function fakeGithub(prs: PrInfo[]): GithubGateway {
  return { prsForBranch: async () => prs };
}

let dir: string;
let store: FactoryStore;
let log: Logger;
let clockNow: Date;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-reconcile-test-"));
  clockNow = new Date("2026-07-12T00:00:00.000Z");
  store = openStore(dir, () => clockNow);
  log = createLogger({ write: () => {}, level: "error" });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function deps(
  gateway: FakeGateway,
  transport: ReconcileTransport,
  github?: GithubGateway,
): ReconcileDeps {
  return {
    store,
    gateway,
    transport,
    github,
    now: () => clockNow,
    teamKey: "THINK",
    silenceBudgetMinutesFor: () => 10,
    log,
  };
}

function upsertIssueRow(
  issueId: string,
  identifier: string,
  state: string,
  labels: string[] = ["Claude"],
): void {
  store.upsertIssue({
    issueId,
    identifier,
    lane: labels.includes("Codex") ? "Codex" : "Claude",
    phase: "implement",
    state,
  });
}

// ---------------------------------------------------------------------------
// (a) orphaned active attempt → expired + relaunch queued (AE6)
// ---------------------------------------------------------------------------

describe("orphaned attempt expiry (AE6)", () => {
  it("store claims a live worker but there is no pid → attempt expired, relaunch queued", async () => {
    const issue = makeIssue({ identifier: "THINK-1", state: "In Progress" });
    const gateway = new FakeGateway([issue]);
    upsertIssueRow(issue.id, issue.identifier, issue.state);
    // The store thinks a worker is active, but the launch never recorded a pid
    // (crash during LaunchingAgentProcess) — a classic daemon-restart orphan.
    const attemptId = store.insertAttempt({
      issueId: issue.id,
      phase: "implement",
      attemptNumber: 1,
      state: "Running",
    });

    const res = await reconcile(deps(gateway, new ReconcileTransport()));

    const attempt = store.getAttempt(attemptId)!;
    // Restart-orphans settle as CanceledByReconciliation (NOT Failed) so they
    // are structurally excluded from the attempt-ceiling kill count.
    expect(attempt.state).toBe("CanceledByReconciliation");
    expect(attempt.detail).toMatch(/orphaned by daemon restart/);
    expect(store.getLease(issue.id)).toBeUndefined();
    expect(res.relaunchQueued).toContain("THINK-1");
    expect(res.outcomes[0].kind).toBe("expired-orphan");
    // No duplicate rows created by reconciliation.
    const n = store.db
      .prepare("SELECT COUNT(*) AS n FROM attempts WHERE issue_id = ?")
      .get(issue.id) as { n: number };
    expect(n.n).toBe(1);
  });

  it("dead pid with no evidence → expired + relaunch queued", async () => {
    const issue = makeIssue({ identifier: "THINK-2", state: "In Progress" });
    const gateway = new FakeGateway([issue]);
    upsertIssueRow(issue.id, issue.identifier, issue.state);
    const attemptId = store.insertAttempt({
      issueId: issue.id,
      phase: "implement",
      attemptNumber: 1,
      state: "Running",
      pid: 4242,
      branch: "auto/think-2-implement-a1",
      logPath: "/log",
    });
    const transport = new ReconcileTransport();
    transport.reachable = true; // pid 4242 NOT alive → confirmed dead

    // No github + status not moved + no baton → no evidence → expire.
    const res = await reconcile(deps(gateway, transport));

    expect(store.getAttempt(attemptId)!.state).toBe("CanceledByReconciliation");
    expect(res.relaunchQueued).toContain("THINK-2");
  });
});

// ---------------------------------------------------------------------------
// (b) externally-merged PR → phase adopted + advanced, NO relaunch
// ---------------------------------------------------------------------------

describe("externally-merged PR adoption", () => {
  it("adopts the merged PR as implement evidence and advances to Verification without relaunching", async () => {
    const issue = makeIssue({ identifier: "THINK-3", state: "In Progress" });
    const gateway = new FakeGateway([issue]);
    upsertIssueRow(issue.id, issue.identifier, issue.state);
    const branch = "auto/think-3-implement-a1";
    const attemptId = store.insertAttempt({
      issueId: issue.id,
      phase: "implement",
      attemptNumber: 1,
      state: "Running",
      pid: 5150, // dead (not in alivePids) → orphan → evidence checked
      branch,
      logPath: "/log",
    });
    const transport = new ReconcileTransport();
    const github = fakeGithub([
      {
        number: 42,
        state: "MERGED",
        url: "https://github.com/o/r/pull/42",
        mergedAt: "2026-07-11T23:00:00.000Z",
      },
    ]);

    const res = await reconcile(deps(gateway, transport, github));

    // Attempt adopted as Succeeded — never relaunched.
    expect(store.getAttempt(attemptId)!.state).toBe("Succeeded");
    expect(store.getAttempt(attemptId)!.detail).toMatch(/adopted pr-merged/);
    expect(res.relaunchQueued).toHaveLength(0);
    expect(res.outcomes[0].kind).toBe("adopted-evidence");
    // The worker died before moving the status → reconciler advances it.
    const setStates = gateway.writesOf("setState");
    expect(setStates).toHaveLength(1);
    expect(setStates[0].args).toEqual([issue.id, "Verification"]);
  });

  it("a live worker with a merged PR signal is reattached, NOT adopted (still running)", async () => {
    const issue = makeIssue({ identifier: "THINK-3b", state: "In Progress" });
    const gateway = new FakeGateway([issue]);
    upsertIssueRow(issue.id, issue.identifier, issue.state);
    const attemptId = store.insertAttempt({
      issueId: issue.id,
      phase: "implement",
      attemptNumber: 1,
      state: "Running",
      pid: 700,
      branch: "auto/think-3b-implement-a1",
      logPath: "/log",
    });
    const transport = new ReconcileTransport();
    transport.alivePids.add(700);
    transport.mtimeByPath.set("/log", clockNow.getTime() - 60_000); // fresh

    const res = await reconcile(deps(gateway, transport, fakeGithub([])));

    expect(store.getAttempt(attemptId)!.state).toBe("Running");
    expect(res.outcomes[0].kind).toBe("reattached");
    expect(gateway.writesOf("setState")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// host-unreachable freeze (AE4)
// ---------------------------------------------------------------------------

describe("host-unreachable freeze", () => {
  it("an unreachable host freezes the attempt — never expired over a possibly-live worker", async () => {
    const issue = makeIssue({ identifier: "THINK-4", state: "In Progress" });
    const gateway = new FakeGateway([issue]);
    upsertIssueRow(issue.id, issue.identifier, issue.state);
    const attemptId = store.insertAttempt({
      issueId: issue.id,
      phase: "implement",
      attemptNumber: 1,
      state: "Running",
      pid: 999,
      logPath: "/log",
    });
    const transport = new ReconcileTransport();
    transport.reachable = false;

    const res = await reconcile(deps(gateway, transport));

    expect(store.getAttempt(attemptId)!.state).toBe("Running");
    expect(res.outcomes[0].kind).toBe("host-unreachable");
    expect(res.relaunchQueued).toHaveLength(0);
    expect(transport.killed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Fix: stalled-but-ALIVE worker must be killed BEFORE it is settled/relaunched
// ---------------------------------------------------------------------------

describe("stalled-but-alive orphan is killed before settle", () => {
  it("a reachable host + live pid + stale log (stalled) → killPidGroup, then settle + relaunch", async () => {
    const issue = makeIssue({ identifier: "THINK-7", state: "In Progress" });
    const gateway = new FakeGateway([issue]);
    upsertIssueRow(issue.id, issue.identifier, issue.state);
    const attemptId = store.insertAttempt({
      issueId: issue.id,
      phase: "implement",
      attemptNumber: 1,
      state: "Running",
      pid: 8080,
      branch: "auto/think-7-implement-a1",
      logPath: "/log",
    });
    const transport = new ReconcileTransport();
    transport.reachable = true;
    transport.alivePids.add(8080); // pid is ALIVE …
    // … but the log has been silent for 20m, past the 10m budget → "stalled".
    transport.mtimeByPath.set("/log", clockNow.getTime() - 20 * 60_000);

    const res = await reconcile(deps(gateway, transport));

    // The wedged-but-live worker was killed before the row was settled — the
    // duplicate-worker / adopt-while-alive race is closed.
    expect(transport.killed).toEqual([8080]);
    const attempt = store.getAttempt(attemptId)!;
    expect(attempt.state).toBe("CanceledByReconciliation");
    expect(store.getLease(issue.id)).toBeUndefined();
    expect(res.relaunchQueued).toContain("THINK-7");
  });
});

// ---------------------------------------------------------------------------
// Fix: dev-deployment lock leaked by a hard crash → cleared on boot reconcile
// ---------------------------------------------------------------------------

describe("orphaned dev-deployment lock cleanup", () => {
  it("a lock held by an issue with NO active attempt is released on boot reconcile", async () => {
    const issue = makeIssue({ identifier: "THINK-8", state: "Verification" });
    const gateway = new FakeGateway([issue]);
    // Issue row present (store is not empty), but no active attempt — the
    // verify worker that held the lock died in a SIGKILL, leaving the row set.
    upsertIssueRow(issue.id, issue.identifier, issue.state);
    store.acquireLock(DEV_DEPLOYMENT_LOCK, issue.id, clockNow.toISOString());
    expect(store.getLock(DEV_DEPLOYMENT_LOCK)?.holder_issue_id).toBe(issue.id);

    await reconcile(deps(gateway, new ReconcileTransport()));

    expect(store.getLock(DEV_DEPLOYMENT_LOCK)).toBeUndefined();
  });

  it("a lock held by an issue whose worker was reattached (still active) is retained", async () => {
    const issue = makeIssue({ identifier: "THINK-8b", state: "Verification" });
    const gateway = new FakeGateway([issue]);
    upsertIssueRow(issue.id, issue.identifier, issue.state);
    store.insertAttempt({
      issueId: issue.id,
      phase: "verify",
      attemptNumber: 1,
      state: "Running",
      pid: 909,
      logPath: "/log",
    });
    store.acquireLock(DEV_DEPLOYMENT_LOCK, issue.id, clockNow.toISOString());
    const transport = new ReconcileTransport();
    transport.alivePids.add(909); // live → reattached, keeps its lock
    transport.mtimeByPath.set("/log", clockNow.getTime() - 60_000);

    await reconcile(deps(gateway, transport));

    expect(store.getLock(DEV_DEPLOYMENT_LOCK)?.holder_issue_id).toBe(issue.id);
  });

  it("settling an orphaned VERIFY attempt also drops its held dev lock", async () => {
    const issue = makeIssue({ identifier: "THINK-8c", state: "Verification" });
    const gateway = new FakeGateway([issue]);
    upsertIssueRow(issue.id, issue.identifier, issue.state);
    store.insertAttempt({
      issueId: issue.id,
      phase: "verify",
      attemptNumber: 1,
      state: "Running", // no pid → crash-orphan
    });
    store.acquireLock(DEV_DEPLOYMENT_LOCK, issue.id, clockNow.toISOString());

    await reconcile(deps(gateway, new ReconcileTransport()));

    expect(store.getLock(DEV_DEPLOYMENT_LOCK)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fix: adoption write failure must not relaunch already-completed work
// ---------------------------------------------------------------------------

describe("adoption write failure is non-relaunching", () => {
  class ThrowingSetStateGateway extends FakeGateway {
    async setState(): Promise<void> {
      throw new Error("fake: setState 500");
    }
  }

  it("a throwing setState still settles the attempt Succeeded and never relaunches on the next reconcile", async () => {
    const issue = makeIssue({ identifier: "THINK-9", state: "In Progress" });
    const gateway = new ThrowingSetStateGateway([issue]);
    upsertIssueRow(issue.id, issue.identifier, issue.state);
    const branch = "auto/think-9-implement-a1";
    const attemptId = store.insertAttempt({
      issueId: issue.id,
      phase: "implement",
      attemptNumber: 1,
      state: "Running",
      pid: 6060, // dead → orphan → evidence checked
      branch,
      logPath: "/log",
    });
    const github = fakeGithub([
      {
        number: 7,
        state: "MERGED",
        url: "https://github.com/o/r/pull/7",
        mergedAt: "2026-07-11T23:00:00.000Z",
      },
    ]);

    const res = await reconcile(deps(gateway, new ReconcileTransport(), github));

    // The store-first settle is the commit point: the attempt is Succeeded even
    // though the Linear advance threw, so nothing relaunches.
    expect(store.getAttempt(attemptId)!.state).toBe("Succeeded");
    expect(res.relaunchQueued).toHaveLength(0);

    // The next reconcile finds the attempt terminal (not active) → no orphan
    // processing, no duplicate dispatch.
    const res2 = await reconcile(
      deps(gateway, new ReconcileTransport(), github),
    );
    expect(res2.relaunchQueued).toHaveLength(0);
    expect(
      res2.outcomes.filter((o) => o.kind === "adopted-evidence"),
    ).toHaveLength(0);
    expect(store.getAttempt(attemptId)!.state).toBe("Succeeded");
  });
});

// ---------------------------------------------------------------------------
// (c) launch-recording-failed repair (Symphony)
// ---------------------------------------------------------------------------

describe("launch-recording-failed repair", () => {
  it("re-applies the ledger write and clears the flag; a second pass is a no-op", async () => {
    const issue = makeIssue({ identifier: "THINK-5", state: "Verification" });
    const gateway = new FakeGateway([issue]);
    upsertIssueRow(issue.id, issue.identifier, issue.state);
    // The worker succeeded, but the post-run Linear write failed and the
    // executor flagged it in the attempt detail (terminal Succeeded).
    const attemptId = store.insertAttempt({
      issueId: issue.id,
      phase: "implement",
      attemptNumber: 1,
      state: "Running",
      pid: 1,
    });
    store.transitionAttempt(
      attemptId,
      "Succeeded",
      `${LAUNCH_RECORDING_FAILED_PREFIX}: network reset`,
    );

    const res = await reconcile(deps(gateway, new ReconcileTransport()));

    expect(res.outcomes.some((o) => o.kind === "recording-repaired")).toBe(true);
    // A ledger comment was (re)written.
    const ledgerWrites = gateway.writes.filter(
      (w) => w.op === "createComment" || w.op === "updateComment",
    );
    expect(ledgerWrites.length).toBeGreaterThanOrEqual(1);
    // The flag is cleared — the attempt detail no longer starts with it.
    expect(
      store.getAttempt(attemptId)!.detail?.startsWith(
        LAUNCH_RECORDING_FAILED_PREFIX,
      ),
    ).toBe(false);

    // Idempotent: a second reconcile finds nothing to repair.
    const writesBefore = gateway.writes.length;
    const res2 = await reconcile(deps(gateway, new ReconcileTransport()));
    expect(res2.outcomes.some((o) => o.kind === "recording-repaired")).toBe(
      false,
    );
    expect(gateway.writes.length).toBe(writesBefore);
  });
});

// ---------------------------------------------------------------------------
// (d) deleted store → rebuilt from Linear scan WITHOUT duplicate dispatch
// ---------------------------------------------------------------------------

describe("empty-store rebuild", () => {
  it("rebuilds the issue cache from a Linear scan and dispatches nothing", async () => {
    // A freshly-opened (deleted) store: zero issues, zero attempts.
    const issues = [
      makeIssue({ identifier: "THINK-10", state: "In Progress", labels: ["Claude"] }),
      makeIssue({ identifier: "THINK-11", state: "Planning", labels: ["Codex"] }),
    ];
    const gateway = new FakeGateway(issues);

    const res = await reconcile(deps(gateway, new ReconcileTransport()));

    expect(res.rebuiltIssues).toBe(2);
    // Issue cache repopulated…
    expect(store.getIssue(issues[0].id)?.identifier).toBe("THINK-10");
    expect(store.getIssue(issues[1].id)?.lane).toBe("Codex");
    // …but NO attempts fabricated and NO dispatch (setState) performed — the
    // rebuild can never cause a duplicate worker.
    const n = store.db.prepare("SELECT COUNT(*) AS n FROM attempts").get() as {
      n: number;
    };
    expect(n.n).toBe(0);
    expect(gateway.writesOf("setState")).toHaveLength(0);
    expect(res.relaunchQueued).toHaveLength(0);
  });

  it("a non-empty store is NOT rebuilt (periodic reconcile only repairs attempts)", async () => {
    const issue = makeIssue({ identifier: "THINK-12", state: "In Progress" });
    const gateway = new FakeGateway([issue]);
    upsertIssueRow(issue.id, issue.identifier, issue.state);

    const res = await reconcile(deps(gateway, new ReconcileTransport()));
    expect(res.rebuiltIssues).toBe(0);
  });
});
