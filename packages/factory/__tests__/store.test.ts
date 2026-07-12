import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openStore, type FactoryStore } from "../src/store/db.js";

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
    const terminal = [
      "Succeeded",
      "Failed",
      "TimedOut",
      "Stalled",
      "CanceledByReconciliation",
    ];
    for (const [i, state] of terminal.entries()) {
      const issueId = `iss_t${i}`;
      const id = store.insertAttempt({ ...base, issueId });
      store.transitionAttempt(id, state);
      expect(store.getActiveAttempt(issueId, "implement")).toBeUndefined();
      // A fresh attempt is now allowed.
      store.insertAttempt({ ...base, issueId, attemptNumber: 2 });
    }
  });
});
