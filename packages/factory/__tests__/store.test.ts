import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import Database from "better-sqlite3";

import {
  TERMINAL_ATTEMPT_STATES,
  openStore,
  readDbTerminalAttemptStates,
  type FactoryStore,
} from "../src/store/db.js";

let dir: string;
let store: FactoryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-store-test-"));
  store = openStore(dir);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("schema", () => {
  it("creates the db file under the state dir", () => {
    expect(existsSync(join(dir, "factory.db"))).toBe(true);
  });

  it("applies idempotently (open twice, no error)", () => {
    const second = openStore(dir);
    second.close();
  });

  it("the generated active column's terminal set equals TERMINAL_ATTEMPT_STATES (single source of truth)", () => {
    // schema.sql carries a placeholder, not a list — what the DB treats as
    // terminal must be exactly the TS constant, no drift possible.
    expect(new Set(readDbTerminalAttemptStates(store.db))).toEqual(
      new Set(TERMINAL_ATTEMPT_STATES),
    );
  });

  it("refuses to open a stale DB whose baked-in terminal set drifted from TERMINAL_ATTEMPT_STATES", () => {
    // Simulate a factory.db created under an OLDER terminal list (missing
    // one state). CREATE TABLE IF NOT EXISTS would silently keep it; the
    // startup assertion must fail loudly instead.
    const staleDir = mkdtempSync(join(tmpdir(), "factory-store-stale-"));
    try {
      const stale = new Database(join(staleDir, "factory.db"));
      const outdated = TERMINAL_ATTEMPT_STATES.slice(0, -1)
        .map((s) => `'${s}'`)
        .join(", ");
      stale.exec(`
        CREATE TABLE attempts (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          issue_id       TEXT NOT NULL,
          phase          TEXT NOT NULL,
          attempt_number INTEGER NOT NULL,
          state          TEXT NOT NULL,
          host           TEXT,
          worktree_path  TEXT,
          branch         TEXT,
          pid            INTEGER,
          log_path       TEXT,
          started_at     TEXT NOT NULL,
          ended_at       TEXT,
          detail         TEXT,
          active INTEGER GENERATED ALWAYS AS (
            CASE WHEN state IN (${outdated}) THEN 0 ELSE 1 END
          ) VIRTUAL
        );
      `);
      stale.close();
      expect(() => openStore(staleDir)).toThrow(/terminal-attempt-state drift/);
    } finally {
      rmSync(staleDir, { recursive: true, force: true });
    }
  });
});

describe("issues", () => {
  it("upserts an issue row (insert then update)", () => {
    store.upsertIssue({
      issueId: "iss_1",
      identifier: "THINK-900",
      lane: "claude",
      phase: "implement",
      state: "InProgress",
      compounded: 0,
    });
    store.upsertIssue({
      issueId: "iss_1",
      identifier: "THINK-900",
      lane: "claude",
      phase: "verify",
      state: "InReview",
      compounded: 1,
      slackThreadTs: "123.456",
    });
    const row = store.getIssue("iss_1");
    expect(row).toBeDefined();
    expect(row!.phase).toBe("verify");
    expect(row!.state).toBe("InReview");
    expect(row!.compounded).toBe(1);
    expect(row!.slack_thread_ts).toBe("123.456");
  });
});

describe("attempts", () => {
  const base = {
    issueId: "iss_2",
    phase: "implement",
    attemptNumber: 1,
    host: "local",
    worktreePath: "/tmp/wt",
    branch: "feat/x",
    logPath: "/tmp/log",
  };

  it("insert + state transition round-trips", () => {
    const id = store.insertAttempt(base);
    expect(id).toBeGreaterThan(0);
    const active = store.getActiveAttempt("iss_2", "implement");
    expect(active).toBeDefined();
    expect(active!.id).toBe(id);
    expect(active!.state).toBe("Running");
    expect(active!.issue_id).toBe("iss_2");
    expect(active!.worktree_path).toBe("/tmp/wt");

    store.transitionAttempt(id, "Succeeded", "merged");
    const after = store.getAttempt(id);
    expect(after!.state).toBe("Succeeded");
    expect(after!.detail).toBe("merged");
    expect(after!.ended_at).toBeTruthy();
    expect(store.getActiveAttempt("iss_2", "implement")).toBeUndefined();
  });

  it("transitioning a nonexistent attempt throws", () => {
    expect(() => store.transitionAttempt(9999, "Failed")).toThrow(/attempt/i);
  });

  it("rejects a second active attempt for the same issue+phase", () => {
    store.insertAttempt(base);
    expect(() => store.insertAttempt({ ...base, attemptNumber: 2 })).toThrow(
      /UNIQUE|active/i,
    );
  });

  it("allows a second attempt after the first reaches a terminal state", () => {
    const first = store.insertAttempt(base);
    store.transitionAttempt(first, "TimedOut");
    const second = store.insertAttempt({ ...base, attemptNumber: 2 });
    expect(second).toBeGreaterThan(first);
    const active = store.getActiveAttempt("iss_2", "implement");
    expect(active!.id).toBe(second);
  });

  it("allows concurrent active attempts on different phases of the same issue", () => {
    store.insertAttempt(base);
    store.insertAttempt({ ...base, phase: "verify" });
    expect(store.getActiveAttempt("iss_2", "implement")).toBeDefined();
    expect(store.getActiveAttempt("iss_2", "verify")).toBeDefined();
  });

  it("every terminal state deactivates the attempt", () => {
    // Sweep the authoritative constant itself so a newly added terminal
    // state is exercised here automatically.
    for (const [i, state] of TERMINAL_ATTEMPT_STATES.entries()) {
      const issueId = `iss_t${i}`;
      const id = store.insertAttempt({ ...base, issueId });
      store.transitionAttempt(id, state);
      expect(store.getActiveAttempt(issueId, "implement")).toBeUndefined();
      // A fresh attempt is now allowed.
      store.insertAttempt({ ...base, issueId, attemptNumber: 2 });
    }
  });
});

describe("slack_threads (U8)", () => {
  const input = {
    issueId: "iss_s1",
    identifier: "THINK-800",
    channelId: "C123",
    threadTs: "1700.000100",
  };

  it("upsert is idempotent — one thread per issue, existing row wins", () => {
    const first = store.upsertSlackThread(input);
    expect(first.thread_ts).toBe("1700.000100");
    expect(first.identifier).toBe("THINK-800");
    // A second call with a DIFFERENT ts must NOT overwrite (reuse the thread).
    const second = store.upsertSlackThread({
      ...input,
      threadTs: "9999.999999",
    });
    expect(second.thread_ts).toBe("1700.000100");
  });

  it("reverse lookup by (channel, thread_ts) resolves the issue", () => {
    store.upsertSlackThread(input);
    const row = store.getSlackThreadByThreadTs("C123", "1700.000100");
    expect(row?.issue_id).toBe("iss_s1");
    expect(store.getSlackThreadByThreadTs("C123", "nope")).toBeUndefined();
  });

  it("idempotency markers round-trip and require an existing row", () => {
    store.upsertSlackThread(input);
    store.setSlackThreadMarker("iss_s1", "last_relayed_ts", "1700.000200");
    store.setSlackThreadMarker("iss_s1", "last_escalated_key", "q-1");
    store.setSlackThreadMarker("iss_s1", "last_milestone_key", "launch:implement");
    const row = store.getSlackThreadByIssue("iss_s1");
    expect(row!.last_relayed_ts).toBe("1700.000200");
    expect(row!.last_escalated_key).toBe("q-1");
    expect(row!.last_milestone_key).toBe("launch:implement");
    expect(() =>
      store.setSlackThreadMarker("nope", "last_relayed_ts", "x"),
    ).toThrow(/does not exist/);
  });

  it("listSlackThreads returns every mapping", () => {
    store.upsertSlackThread(input);
    store.upsertSlackThread({ ...input, issueId: "iss_s2", identifier: "THINK-801" });
    expect(store.listSlackThreads()).toHaveLength(2);
  });
});

describe("attempts — sweep queries (U6)", () => {
  it("listActiveAttempts / listAttemptsForPhase / getLatestTerminalAttempt", () => {
    const a1 = store.insertAttempt({
      issueId: "iss_a",
      phase: "implement",
      attemptNumber: 1,
      state: "Running",
    });
    store.transitionAttempt(a1, "Failed", "kill 1");
    const a2 = store.insertAttempt({
      issueId: "iss_a",
      phase: "implement",
      attemptNumber: 2,
      state: "Running",
    });
    store.insertAttempt({
      issueId: "iss_b",
      phase: "verify",
      attemptNumber: 1,
      state: "Running",
    });

    // Only the two Running attempts are active.
    expect(store.listActiveAttempts().map((a) => a.id).sort()).toEqual(
      [a2, store.getActiveAttempt("iss_b", "verify")!.id].sort(),
    );
    // Newest-first per phase.
    expect(
      store.listAttemptsForPhase("iss_a", "implement").map((a) => a.attempt_number),
    ).toEqual([2, 1]);
    // Latest terminal ignores the still-running a2.
    expect(store.getLatestTerminalAttempt("iss_a")!.id).toBe(a1);
    expect(store.getLatestTerminalAttempt("iss_none")).toBeUndefined();
  });
});

describe("leases (U6)", () => {
  it("upsert/get/delete round-trips and accumulates the SLA field", () => {
    store.upsertLease({
      issueId: "iss_l",
      attemptId: 3,
      expiresAt: "2026-07-12T00:15:00.000Z",
      heartbeatAt: "2026-07-12T00:00:00.000Z",
      slaAccumulatedMs: 5000,
    });
    const row = store.getLease("iss_l");
    expect(row!.attempt_id).toBe(3);
    expect(row!.sla_accumulated_ms).toBe(5000);
    // Upsert overwrites (advancing heartbeat + SLA).
    store.upsertLease({
      issueId: "iss_l",
      attemptId: 3,
      expiresAt: "2026-07-12T00:30:00.000Z",
      heartbeatAt: "2026-07-12T00:15:00.000Z",
      slaAccumulatedMs: 9000,
    });
    expect(store.getLease("iss_l")!.sla_accumulated_ms).toBe(9000);
    expect(store.listLeases()).toHaveLength(1);
    store.deleteLease("iss_l");
    expect(store.getLease("iss_l")).toBeUndefined();
  });
});

describe("nag timers + outbox (U6)", () => {
  it("upsert is idempotent per (issue, kind); armed toggles; due filter respects the clock", () => {
    store.upsertNagTimer({
      issueId: "iss_n",
      kind: "question",
      nextFireAt: "2026-07-12T04:00:00.000Z",
      intervalMinutes: 1440,
    });
    // Same (issue, kind) upserts in place — one row.
    store.upsertNagTimer({
      issueId: "iss_n",
      kind: "question",
      nextFireAt: "2026-07-12T05:00:00.000Z",
      intervalMinutes: 1440,
    });
    expect(store.listNagTimers()).toHaveLength(1);
    expect(store.getNagTimer("iss_n", "question")!.next_fire_at).toBe(
      "2026-07-12T05:00:00.000Z",
    );

    // Not due before the deadline; due after.
    expect(store.listDueNagTimers("2026-07-12T04:30:00.000Z")).toHaveLength(0);
    expect(store.listDueNagTimers("2026-07-12T06:00:00.000Z")).toHaveLength(1);

    // Disarmed timers never surface as due.
    store.setNagArmed("iss_n", "question", false);
    expect(store.listDueNagTimers("2026-07-12T06:00:00.000Z")).toHaveLength(0);
  });

  it("outbox enqueue → list undelivered → mark delivered", () => {
    store.enqueueNag({ issueId: "iss_o", kind: "question", text: "ping" });
    const rows = store.listUndeliveredNags();
    expect(rows).toHaveLength(1);
    store.markNagDelivered(rows[0].id);
    expect(store.listUndeliveredNags()).toHaveLength(0);
  });
});

describe("locks (U6, KTD-11)", () => {
  it("acquire is exclusive + reentrant; release is holder-scoped", () => {
    const t = "2026-07-12T00:00:00.000Z";
    expect(store.acquireLock("dev-deployment", "iss_1", t)).toBe(true);
    // Reentrant for the same holder.
    expect(store.acquireLock("dev-deployment", "iss_1", t)).toBe(true);
    // Exclusive against another.
    expect(store.acquireLock("dev-deployment", "iss_2", t)).toBe(false);
    expect(store.getLock("dev-deployment")!.holder_issue_id).toBe("iss_1");
    // A non-holder cannot release it.
    expect(store.releaseLock("dev-deployment", "iss_2")).toBe(false);
    expect(store.releaseLock("dev-deployment", "iss_1")).toBe(true);
    // Now free for the other issue.
    expect(store.acquireLock("dev-deployment", "iss_2", t)).toBe(true);
  });
});
