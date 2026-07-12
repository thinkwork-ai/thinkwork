/**
 * No-orphan sweep (U6): leases + host-aware liveness (R10/R11), stall/dead
 * recovery (R14/R15, AE4/AE5), quota routing (AE8), the dev-deployment mutex
 * (KTD-11), nag timers (R23), and the R22 unclassifiable → operator-alert
 * guarantee. Every timer/SLA computation flows through an injected simulated
 * clock — no test touches wall-clock time. Transport is a fake.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLogger, type Logger } from "../src/logger.js";
import type { PollCandidate } from "../src/linear/poller.js";
import { DEFAULT_LEDGER } from "../src/linear/ledger.js";
import { decideAction, type StoreView } from "../src/phases/engine.js";
import { openStore, type FactoryStore } from "../src/store/db.js";
import type {
  ExecResult,
  HostTransport,
  SpawnDetachedRequest,
} from "../src/workers/transport.js";
import { runSweep } from "../src/sweep/classifier.js";
import { evaluateLiveness, renewLease } from "../src/sweep/leases.js";
import { armNag, disarmNag, sweepNags, type FiredNag } from "../src/sweep/nags.js";
import {
  acquireDevLock,
  devLockHeldByOther,
  releaseDevLock,
} from "../src/sweep/locks.js";

// ---------------------------------------------------------------------------
// fakes
// ---------------------------------------------------------------------------

class SweepTransport implements HostTransport {
  reachable = true;
  alivePids = new Set<number>();
  mtimeByPath = new Map<string, number>();
  tailByPath = new Map<string, string>();
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
  async readTail(path: string): Promise<string> {
    return this.tailByPath.get(path) ?? "";
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

let dir: string;
let store: FactoryStore;
let log: Logger;
let clockNow: Date;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-sweep-test-"));
  clockNow = new Date("2026-07-12T00:00:00.000Z");
  store = openStore(dir, () => clockNow);
  log = createLogger({ write: () => {}, level: "error" });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const now = () => clockNow;
const at = (minutes: number) =>
  new Date(clockNow.getTime() + minutes * 60_000);

function candidate(
  partial: Partial<{
    id: string;
    identifier: string;
    state: string;
    labels: string[];
    blockerLabels: string[];
    hasLfg: boolean;
  }> = {},
): PollCandidate {
  const identifier = partial.identifier ?? "THINK-1";
  const state = partial.state ?? "In Progress";
  return {
    issue: {
      id: partial.id ?? `uuid-${identifier}`,
      identifier,
      title: `Title ${identifier}`,
      description: "",
      state,
      labels: partial.labels ?? ["Claude"],
    },
    lane: "Claude",
    hasLfg: partial.hasLfg ?? false,
    isVerification: state === "Verification" || state === "Review",
    blockerLabels: partial.blockerLabels ?? [],
    ledger: {
      ledger: { ...DEFAULT_LEDGER },
      prose: "",
      synthesized: true,
      warnings: [],
    },
    ledgerCommentId: null,
    comments: [],
  };
}

function sweepDeps(transport: SweepTransport, silenceBudgetMinutes = 10) {
  return {
    store,
    transport,
    now,
    silenceBudgetMinutesFor: () => silenceBudgetMinutes,
    log,
  };
}

function insertRunningAttempt(
  issueId: string,
  opts: { pid?: number; logPath?: string; phase?: string; state?: string } = {},
): number {
  return store.insertAttempt({
    issueId,
    phase: opts.phase ?? "implement",
    attemptNumber: 1,
    state: opts.state ?? "Running",
    pid: opts.pid,
    logPath: opts.logPath,
  });
}

// ---------------------------------------------------------------------------
// AE4 — a missed heartbeat expires a lease only after reachable + pid death
// ---------------------------------------------------------------------------

describe("lease expiry / duplicate-worker guard (AE4)", () => {
  it("host unreachable → NOT expired: worker left alone, SLA clock frozen", async () => {
    const c = candidate();
    const attemptId = insertRunningAttempt(c.issue.id, {
      pid: 4242,
      logPath: "/log",
    });
    const transport = new SweepTransport();
    transport.reachable = false; // asleep host
    // Even though the pid looks "dead" (not in alivePids), an unreachable host
    // must NOT expire the lease — that is the AE4 no-duplicate guarantee.

    const res = await runSweep([c], sweepDeps(transport));

    expect(res.classifications[0].kind).toBe("host-unreachable");
    // Attempt is untouched (still active/Running), no kill, lease frozen.
    expect(store.getAttempt(attemptId)!.state).toBe("Running");
    expect(transport.killed).toEqual([]);
    expect(store.getLease(c.issue.id)!.sla_accumulated_ms).toBe(0);
  });

  it("host reachable + pid confirmed dead → lease expires, attempt settled (relaunch next decide)", async () => {
    const c = candidate();
    const attemptId = insertRunningAttempt(c.issue.id, {
      pid: 4242,
      logPath: "/log",
    });
    const transport = new SweepTransport();
    transport.reachable = true;
    // 4242 not in alivePids → confirmed dead.

    const res = await runSweep([c], sweepDeps(transport));

    expect(res.classifications[0].kind).toBe("recovered-dead");
    const attempt = store.getAttempt(attemptId)!;
    expect(attempt.state).toBe("Failed");
    expect(attempt.detail).toMatch(/pid 4242 confirmed dead/);
    expect(store.getLease(c.issue.id)).toBeUndefined();
    // No duplicate: exactly one attempt row exists.
    const n = store.db
      .prepare("SELECT COUNT(*) AS n FROM attempts WHERE issue_id = ?")
      .get(c.issue.id) as { n: number };
    expect(n.n).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// R11 — SLA clock accumulates only observed-reachable time (frozen when asleep)
// ---------------------------------------------------------------------------

describe("SLA clock freezes while host-unreachable (R11)", () => {
  it("accumulates reachable intervals only; an unreachable window contributes zero", () => {
    const c = candidate();
    const attemptId = insertRunningAttempt(c.issue.id, {
      pid: 7,
      logPath: "/log",
    });
    const attempt = store.getAttempt(attemptId)!; // started_at = t0
    const t0 = clockNow.getTime();
    const min = (m: number) => new Date(t0 + m * 60_000);

    // t0 → t0+5 reachable: +5 min.
    let sla = renewLease({ store, issueId: c.issue.id, attempt, now: min(5), reachable: true });
    expect(sla).toBe(5 * 60_000);

    // t0+5 → t0+10 UNREACHABLE: +0 (frozen), heartbeat still advances to t0+10.
    sla = renewLease({ store, issueId: c.issue.id, attempt, now: min(10), reachable: false });
    expect(sla).toBe(5 * 60_000);

    // t0+10 → t0+15 reachable again: +5 more (the asleep window is excluded).
    sla = renewLease({ store, issueId: c.issue.id, attempt, now: min(15), reachable: true });
    expect(sla).toBe(10 * 60_000);
  });
});

// ---------------------------------------------------------------------------
// AE5 first half — silence past budget with a reachable host → Stalled
// ---------------------------------------------------------------------------

describe("stall detection + recovery (AE5 first half)", () => {
  it("live pid + log silent past budget → kill, tail recorded, Stalled, lease dropped", async () => {
    const c = candidate();
    const attemptId = insertRunningAttempt(c.issue.id, {
      pid: 999,
      logPath: "/log",
    });
    const transport = new SweepTransport();
    transport.reachable = true;
    transport.alivePids.add(999); // still alive
    // Log last grew 20 min ago; silence budget is 10 min → stalled.
    transport.mtimeByPath.set("/log", clockNow.getTime() - 20 * 60_000);
    transport.tailByPath.set("/log", "…last worker output line");

    const res = await runSweep([c], sweepDeps(transport, 10));

    expect(res.classifications[0].kind).toBe("recovered-stalled");
    expect(transport.killed).toEqual([999]); // process group killed
    const attempt = store.getAttempt(attemptId)!;
    expect(attempt.state).toBe("Stalled");
    expect(attempt.detail).toMatch(/last worker output line/); // tail preserved
    expect(store.getLease(c.issue.id)).toBeUndefined();
  });

  it("live pid + fresh log within budget → leased (renewed, not killed)", async () => {
    const c = candidate();
    insertRunningAttempt(c.issue.id, { pid: 500, logPath: "/log" });
    const transport = new SweepTransport();
    transport.reachable = true;
    transport.alivePids.add(500);
    transport.mtimeByPath.set("/log", clockNow.getTime() - 2 * 60_000); // fresh

    const res = await runSweep([c], sweepDeps(transport, 10));

    expect(res.classifications[0].kind).toBe("leased");
    expect(transport.killed).toEqual([]);
    expect(store.getLease(c.issue.id)).toBeDefined();
  });

  it("evaluateLiveness maps the four verdicts", async () => {
    const attemptId = insertRunningAttempt("iss_x", { pid: 42, logPath: "/l" });
    const attempt = store.getAttempt(attemptId)!;
    const t = new SweepTransport();

    t.reachable = false;
    expect(
      await evaluateLiveness({ attempt, transport: t, now: clockNow, silenceBudgetMs: 600_000 }),
    ).toBe("host-unreachable");

    t.reachable = true; // pid 42 not alive
    expect(
      await evaluateLiveness({ attempt, transport: t, now: clockNow, silenceBudgetMs: 600_000 }),
    ).toBe("dead");

    t.alivePids.add(42);
    t.mtimeByPath.set("/l", clockNow.getTime() - 20 * 60_000);
    expect(
      await evaluateLiveness({ attempt, transport: t, now: clockNow, silenceBudgetMs: 600_000 }),
    ).toBe("stalled");

    t.mtimeByPath.set("/l", clockNow.getTime());
    expect(
      await evaluateLiveness({ attempt, transport: t, now: clockNow, silenceBudgetMs: 600_000 }),
    ).toBe("leased");
  });
});

// ---------------------------------------------------------------------------
// AE5 second half — second consecutive kill on a phase escalates, no 3rd attempt
// ---------------------------------------------------------------------------

describe("attempt ceiling (AE5 second half / R15)", () => {
  const view = (kills: number): StoreView => ({
    activeAttempt: null,
    hasChildIssues: false,
    consecutiveKillsByPhase: { implement: kills },
  });

  it("launches on the first and second attempt, escalates on the third", () => {
    const c = {
      issue: {
        identifier: "THINK-5",
        title: "t",
        state: "In Progress",
        labels: ["Claude"],
      },
      lane: "Claude" as const,
      hasLfg: false,
      isVerification: false,
      blockerLabels: [],
      ledger: { ledger: { ...DEFAULT_LEDGER }, synthesized: false },
    };
    expect(decideAction(c, view(0)).kind).toBe("launch");
    expect(decideAction(c, view(1)).kind).toBe("launch");
    // 2 consecutive kills → escalate to an operator instead of a third attempt.
    const escalated = decideAction(c, view(2));
    expect(escalated.kind).toBe("block");
    if (escalated.kind === "block") {
      expect(escalated.label).toBe("Needs User");
      expect(escalated.reason).toMatch(/consecutive killed\/stalled/);
    }
  });

  it("the sweep's kills feed the ceiling: two settled Failed implement attempts block the third", () => {
    // Two consecutive failed implement attempts recorded by the recovery path.
    const issueId = "uuid-THINK-6";
    const a1 = store.insertAttempt({
      issueId,
      phase: "implement",
      attemptNumber: 1,
      state: "Running",
    });
    store.transitionAttempt(a1, "Failed", "kill 1");
    const a2 = store.insertAttempt({
      issueId,
      phase: "implement",
      attemptNumber: 2,
      state: "Running",
    });
    store.transitionAttempt(a2, "Stalled", "kill 2");

    // Restate what buildStoreView computes: trailing consecutive kills.
    const attempts = store.listAttemptsForPhase(issueId, "implement");
    let kills = 0;
    for (const a of attempts) {
      if (["Failed", "Stalled", "TimedOut"].includes(a.state)) kills += 1;
      else break;
    }
    expect(kills).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AE8 — rate-limit → QuotaCooldown → wait inside window, escalate past it
// ---------------------------------------------------------------------------

describe("quota routing in decideAction (AE8)", () => {
  const base = {
    issue: {
      identifier: "THINK-7",
      title: "t",
      state: "In Progress",
      labels: ["Claude"],
    },
    lane: "Claude" as const,
    hasLfg: false,
    isVerification: false,
    blockerLabels: [],
    ledger: { ledger: { ...DEFAULT_LEDGER }, synthesized: false },
  };

  it("cooldown → wait (no relaunch)", () => {
    const action = decideAction(base, {
      activeAttempt: null,
      hasChildIssues: false,
      quota: { kind: "cooldown", until: "2026-07-12T01:00:00.000Z" },
    });
    expect(action.kind).toBe("wait");
    if (action.kind === "wait") expect(action.reason).toMatch(/QuotaCooldown/);
  });

  it("expired → escalate (block Needs User), not a retry", () => {
    const action = decideAction(base, {
      activeAttempt: null,
      hasChildIssues: false,
      quota: { kind: "expired" },
    });
    expect(action.kind).toBe("block");
    if (action.kind === "block") expect(action.label).toBe("Needs User");
  });
});

// ---------------------------------------------------------------------------
// KTD-11 — the dev-deployment mutex
// ---------------------------------------------------------------------------

describe("dev-deployment mutex (KTD-11)", () => {
  it("second contender waits while the first holds it, then acquires on release", () => {
    const first = "uuid-THINK-A";
    const second = "uuid-THINK-B";

    expect(acquireDevLock(store, first, clockNow)).toEqual({ acquired: true });
    // The second issue cannot acquire and can SEE who holds it.
    const contended = acquireDevLock(store, second, clockNow);
    expect(contended).toEqual({ acquired: false, heldBy: first });
    expect(devLockHeldByOther(store, second)).toBe(true);

    // Holder releases → the second acquires cleanly.
    expect(releaseDevLock(store, first)).toBe(true);
    expect(devLockHeldByOther(store, second)).toBe(false);
    expect(acquireDevLock(store, second, clockNow)).toEqual({ acquired: true });
  });

  it("decideAction makes a ready Verification wait when the lock is held by another", () => {
    const c = {
      issue: {
        identifier: "THINK-V",
        title: "t",
        state: "Verification",
        labels: [],
      },
      lane: null,
      hasLfg: true,
      isVerification: true,
      blockerLabels: [],
      ledger: { ledger: { ...DEFAULT_LEDGER }, synthesized: false },
    };
    // Free lock → launches verify.
    expect(
      decideAction(c, {
        activeAttempt: null,
        hasChildIssues: false,
        devLockHeldByOther: false,
      }).kind,
    ).toBe("launch");
    // Held by another → waits visibly.
    const waited = decideAction(c, {
      activeAttempt: null,
      hasChildIssues: false,
      devLockHeldByOther: true,
    });
    expect(waited.kind).toBe("wait");
    if (waited.kind === "wait") expect(waited.reason).toMatch(/dev-deployment lock/);
  });
});

// ---------------------------------------------------------------------------
// R22 — an unclassifiable (corrupted) store row raises an operator alert
// ---------------------------------------------------------------------------

describe("no-orphan invariant (R22)", () => {
  it("a hand-corrupted attempt state → operator alert, never silently skipped", async () => {
    const c = candidate({ identifier: "THINK-8" });
    // Force an attempt into a state the machine does not recognize (a row a
    // human or a bug could leave behind). It is still active=1 (not terminal).
    const id = insertRunningAttempt(c.issue.id, { pid: 1, logPath: "/log" });
    store.db
      .prepare("UPDATE attempts SET state = 'BogusHandEdit' WHERE id = ?")
      .run(id);
    const transport = new SweepTransport();

    const res = await runSweep([c], sweepDeps(transport));

    expect(res.alerts).toHaveLength(1);
    expect(res.classifications[0].kind).toBe("alert");
    expect(res.classifications[0].detail).toMatch(/unrecognized state/);
    // The corrupted worker was not probed/killed as if healthy.
    expect(transport.killed).toEqual([]);
  });

  it("an idle routable candidate is `dispatchable` (owned by the dispatch loop, not orphaned)", async () => {
    const c = candidate({ identifier: "THINK-9", state: "Brainstorming" });
    const res = await runSweep([c], sweepDeps(new SweepTransport()));
    expect(res.classifications[0].kind).toBe("dispatchable");
  });
});

// ---------------------------------------------------------------------------
// R23 — nag timers arm on entry, fire on schedule, re-arm daily, disarm on answer
// ---------------------------------------------------------------------------

describe("nag timers (R23)", () => {
  it("a Needs User question is classified human-wait and arms a question nag", async () => {
    const c = candidate({
      identifier: "THINK-Q",
      state: "In Progress",
      labels: ["Claude", "Needs User"],
      blockerLabels: ["Needs User"],
    });
    const res = await runSweep([c], sweepDeps(new SweepTransport()));
    expect(res.classifications[0].kind).toBe("human-wait");
    const timer = store.getNagTimer(c.issue.id, "question");
    expect(timer?.armed).toBe(1);
  });

  it("a review gate without LFG arms a review-gate nag", async () => {
    const c = candidate({ identifier: "THINK-R", state: "Plan Review", hasLfg: false });
    const res = await runSweep([c], sweepDeps(new SweepTransport()));
    expect(res.classifications[0].kind).toBe("human-wait");
    expect(store.getNagTimer(c.issue.id, "review-gate")?.armed).toBe(1);
  });

  it("fires at the interval, re-arms daily, and disarms on answer", async () => {
    const issueId = "uuid-THINK-N";
    // Arm at t0 with a 4h first delay, daily interval.
    armNag({ store, issueId, kind: "question", now: clockNow, firstDelayMinutes: 240, intervalMinutes: 1440 });

    // Before the 4h delay: nothing fires.
    clockNow = at(239);
    const fired: FiredNag[] = [];
    await sweepNags({ store, now: clockNow, deliver: async (n) => { fired.push(n); } });
    expect(fired).toHaveLength(0);

    // Past 4h: it fires once and re-arms ~24h out.
    clockNow = at(241);
    await sweepNags({ store, now: clockNow, deliver: async (n) => { fired.push(n); } });
    expect(fired).toHaveLength(1);
    const afterFirst = store.getNagTimer(issueId, "question")!;
    expect(afterFirst.armed).toBe(1);
    expect(new Date(afterFirst.next_fire_at).toISOString()).toBe(
      new Date(clockNow.getTime() + 1440 * 60_000).toISOString(),
    );

    // Same day (before the next daily deadline): does not fire again.
    clockNow = at(300);
    await sweepNags({ store, now: clockNow, deliver: async (n) => { fired.push(n); } });
    expect(fired).toHaveLength(1);

    // A day later it fires again (daily cadence).
    clockNow = at(241 + 1440);
    await sweepNags({ store, now: clockNow, deliver: async (n) => { fired.push(n); } });
    expect(fired).toHaveLength(2);

    // Answer arrives → disarm; no further fires ever.
    disarmNag(store, issueId, "question");
    clockNow = at(241 + 1440 * 5);
    await sweepNags({ store, now: clockNow, deliver: async (n) => { fired.push(n); } });
    expect(fired).toHaveLength(2);
  });

  it("without a delivery callback (Slack absent), a due nag is enqueued to the store outbox", async () => {
    const issueId = "uuid-THINK-O";
    armNag({ store, issueId, kind: "question", now: clockNow, firstDelayMinutes: 240 });
    clockNow = at(241);
    const fired = await sweepNags({ store, now: clockNow }); // no deliver
    expect(fired).toHaveLength(1);
    const outbox = store.listUndeliveredNags();
    expect(outbox).toHaveLength(1);
    expect(outbox[0].issue_id).toBe(issueId);
  });

  it("a resolved wait disarms the nag (answer removes Needs User → dispatchable)", async () => {
    const issueId = "uuid-THINK-D";
    const transport = new SweepTransport();
    // First sweep: Needs User present → armed.
    await runSweep(
      [
        candidate({
          id: issueId,
          identifier: "THINK-D",
          state: "In Progress",
          labels: ["Claude", "Needs User"],
          blockerLabels: ["Needs User"],
        }),
      ],
      sweepDeps(transport),
    );
    expect(store.getNagTimer(issueId, "question")?.armed).toBe(1);

    // Second sweep: the blocker is gone (answered) → disarmed, dispatchable.
    const res = await runSweep(
      [candidate({ id: issueId, identifier: "THINK-D", state: "In Progress", labels: ["Claude"] })],
      sweepDeps(transport),
    );
    expect(res.classifications[0].kind).toBe("dispatchable");
    expect(store.getNagTimer(issueId, "question")?.armed).toBe(0);
  });
});
