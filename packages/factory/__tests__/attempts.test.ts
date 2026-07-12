import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openStore, type FactoryStore } from "../src/store/db.js";
import {
  ATTEMPT_TRANSITIONS,
  IllegalTransitionError,
  TERMINAL_ATTEMPT_STATES,
  createAttemptMachine,
  driveAttempt,
  type AttemptMachine,
  type AttemptState,
} from "../src/workers/attempts.js";
import type {
  LaunchContext,
  LaunchOptions,
  ProviderRunner,
  RunnerResult,
  WorkerHandle,
} from "../src/workers/runner.js";

let dir: string;
let store: FactoryStore;
let machine: AttemptMachine;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "factory-attempts-test-"));
  store = openStore(dir);
  machine = createAttemptMachine(store);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const beginInput = {
  issueId: "iss_10",
  phase: "implement",
  slug: "think-999",
  worktreesDir: "/tmp/factory-worktrees",
  host: "local",
};

describe("attempt state machine — transitions", () => {
  it("walks the happy path and persists each state", () => {
    const { attemptId } = machine.begin(beginInput);
    expect(store.getAttempt(attemptId)!.state).toBe("PreparingWorkspace");

    for (const next of [
      "BuildingPrompt",
      "LaunchingAgentProcess",
      "Running",
      "Finishing",
      "Succeeded",
    ] as AttemptState[]) {
      machine.transition(attemptId, next);
      expect(store.getAttempt(attemptId)!.state).toBe(next);
    }
    expect(store.getAttempt(attemptId)!.ended_at).toBeTruthy();
    expect(store.getActiveAttempt("iss_10", "implement")).toBeUndefined();
  });

  it("rejects Finishing → Running (illegal jump) and leaves state unchanged", () => {
    const { attemptId } = machine.begin(beginInput);
    machine.transition(attemptId, "BuildingPrompt");
    machine.transition(attemptId, "LaunchingAgentProcess");
    machine.transition(attemptId, "Running");
    machine.transition(attemptId, "Finishing");
    expect(() => machine.transition(attemptId, "Running")).toThrow(
      IllegalTransitionError,
    );
    expect(store.getAttempt(attemptId)!.state).toBe("Finishing");
  });

  it("rejects any transition out of a terminal state", () => {
    const { attemptId } = machine.begin(beginInput);
    machine.transition(attemptId, "Failed");
    for (const next of Object.keys(ATTEMPT_TRANSITIONS) as AttemptState[]) {
      expect(() => machine.transition(attemptId, next)).toThrow(
        IllegalTransitionError,
      );
    }
  });

  it("rejects skipping states (PreparingWorkspace → Running)", () => {
    const { attemptId } = machine.begin(beginInput);
    expect(() => machine.transition(attemptId, "Running")).toThrow(
      IllegalTransitionError,
    );
  });

  it("Running can divert to Stalled, TimedOut, and QuotaCooldown — all terminal", () => {
    for (const divert of ["Stalled", "TimedOut", "QuotaCooldown"] as const) {
      const issueId = `iss_divert_${divert}`;
      const { attemptId } = machine.begin({ ...beginInput, issueId });
      machine.transition(attemptId, "BuildingPrompt");
      machine.transition(attemptId, "LaunchingAgentProcess");
      machine.transition(attemptId, "Running");
      machine.transition(attemptId, divert);
      expect(store.getAttempt(attemptId)!.ended_at).toBeTruthy();
      // Slot is freed: a fresh attempt may start.
      expect(store.getActiveAttempt(issueId, "implement")).toBeUndefined();
      machine.begin({ ...beginInput, issueId });
    }
  });

  it("every state in TERMINAL_ATTEMPT_STATES has no outgoing transitions", () => {
    for (const state of TERMINAL_ATTEMPT_STATES) {
      expect(ATTEMPT_TRANSITIONS[state]).toEqual([]);
    }
    expect(TERMINAL_ATTEMPT_STATES).toContain("QuotaCooldown");
    expect(TERMINAL_ATTEMPT_STATES).toContain("CanceledByReconciliation");
  });

  it("rejects transitioning an unknown attempt id", () => {
    expect(() => machine.transition(424242, "BuildingPrompt")).toThrow();
  });
});

describe("begin / relaunch — attempt numbering, branches, worktrees", () => {
  it("begin creates attempt 1 with the attempt-suffixed branch and worktree", () => {
    const plan = machine.begin(beginInput);
    expect(plan.attemptNumber).toBe(1);
    expect(plan.branch).toBe("auto/think-999-implement-a1");
    expect(plan.worktreePath).toBe(
      join("/tmp/factory-worktrees", "auto-think-999-implement-a1"),
    );
    const row = store.getAttempt(plan.attemptId)!;
    expect(row.branch).toBe(plan.branch);
    expect(row.worktree_path).toBe(plan.worktreePath);
    expect(row.attempt_number).toBe(1);
    expect(row.host).toBe("local");
  });

  it("relaunch creates attempt N+1 with a new branch/worktree, leaving attempt N's row intact", () => {
    const first = machine.begin(beginInput);
    machine.transition(first.attemptId, "Failed", "worker died");

    const second = machine.relaunch(beginInput);
    expect(second.attemptNumber).toBe(2);
    expect(second.branch).toBe("auto/think-999-implement-a2");
    expect(second.worktreePath).not.toBe(first.worktreePath);

    // Attempt N is untouched: same worktree path recorded, terminal state kept.
    const firstRow = store.getAttempt(first.attemptId)!;
    expect(firstRow.state).toBe("Failed");
    expect(firstRow.worktree_path).toBe(first.worktreePath);
    expect(firstRow.detail).toBe("worker died");

    const active = store.getActiveAttempt("iss_10", "implement")!;
    expect(active.id).toBe(second.attemptId);
  });

  it("relaunch refuses while a previous attempt is still active", () => {
    machine.begin(beginInput);
    expect(() => machine.relaunch(beginInput)).toThrow(/active/i);
  });

  it("relaunch refuses when no prior attempt exists", () => {
    expect(() =>
      machine.relaunch({ ...beginInput, issueId: "iss_never" }),
    ).toThrow(/no prior attempt/i);
  });

  it("attempt numbering keeps increasing across multiple relaunches", () => {
    const a1 = machine.begin(beginInput);
    machine.transition(a1.attemptId, "Failed");
    const a2 = machine.relaunch(beginInput);
    machine.transition(a2.attemptId, "Failed");
    const a3 = machine.relaunch(beginInput);
    expect(a3.attemptNumber).toBe(3);
    expect(a3.branch).toBe("auto/think-999-implement-a3");
  });
});

/** Fake provider runner for lifecycle-driver tests. */
function makeFakeRunner(result: Partial<RunnerResult> = {}): {
  runner: ProviderRunner;
  launches: { attempt: LaunchContext; prompt: string; opts: LaunchOptions }[];
  killed: WorkerHandle[];
} {
  const launches: {
    attempt: LaunchContext;
    prompt: string;
    opts: LaunchOptions;
  }[] = [];
  const killed: WorkerHandle[] = [];
  const runner: ProviderRunner = {
    async launch(attempt, prompt, opts) {
      launches.push({ attempt, prompt, opts });
      return {
        attemptId: attempt.attemptId,
        pid: 54321,
        logPath: "/tmp/fake.log",
        pidPath: "/tmp/fake.pid",
        cwd: opts.cwd,
      };
    },
    async liveness() {
      return false;
    },
    async logTail() {
      return "";
    },
    async kill(handle) {
      killed.push(handle);
      return true;
    },
    async result() {
      return {
        exitObserved: true,
        completed: true,
        success: true,
        rateLimited: false,
        events: [],
        ...result,
      };
    },
  };
  return { runner, launches, killed };
}

describe("driveAttempt — fake-runner integration", () => {
  it("launch → pid recorded → exit → Finishing → Succeeded when evidence fires", async () => {
    const { attemptId } = machine.begin(beginInput);
    const { runner, launches } = makeFakeRunner();
    const seen: string[] = [];

    const final = await driveAttempt({
      machine,
      runner,
      attemptId,
      buildPrompt: async () => "do the phase",
      launchOptions: { model: "sonnet", cwd: "/tmp/wt" },
      checkEvidence: async () => true,
      onTransition: (s) => seen.push(s),
    });

    expect(final).toBe("Succeeded");
    expect(launches).toHaveLength(1);
    expect(launches[0].prompt).toBe("do the phase");
    const row = store.getAttempt(attemptId)!;
    expect(row.pid).toBe(54321);
    expect(row.log_path).toBe("/tmp/fake.log");
    expect(row.state).toBe("Succeeded");
    expect(seen).toEqual([
      "BuildingPrompt",
      "LaunchingAgentProcess",
      "Running",
      "Finishing",
      "Succeeded",
    ]);
  });

  it("ends Failed when the evidence callback does not fire", async () => {
    const { attemptId } = machine.begin(beginInput);
    const { runner } = makeFakeRunner();
    const final = await driveAttempt({
      machine,
      runner,
      attemptId,
      buildPrompt: async () => "p",
      launchOptions: { model: "sonnet", cwd: "/tmp/wt" },
      checkEvidence: async () => false,
    });
    expect(final).toBe("Failed");
    expect(store.getAttempt(attemptId)!.state).toBe("Failed");
  });

  it("classifies a rate-limit signal as QuotaCooldown, not Failed", async () => {
    const { attemptId } = machine.begin(beginInput);
    const { runner } = makeFakeRunner({ rateLimited: true, success: false });
    const final = await driveAttempt({
      machine,
      runner,
      attemptId,
      buildPrompt: async () => "p",
      launchOptions: { model: "sonnet", cwd: "/tmp/wt" },
      checkEvidence: async () => false,
    });
    expect(final).toBe("QuotaCooldown");
    expect(store.getAttempt(attemptId)!.state).toBe("QuotaCooldown");
  });

  it("a failing launch marks the attempt Failed with detail", async () => {
    const { attemptId } = machine.begin(beginInput);
    const { runner } = makeFakeRunner();
    runner.launch = async () => {
      throw new Error("spawn ENOENT");
    };
    const final = await driveAttempt({
      machine,
      runner,
      attemptId,
      buildPrompt: async () => "p",
      launchOptions: { model: "sonnet", cwd: "/tmp/wt" },
      checkEvidence: async () => true,
    });
    expect(final).toBe("Failed");
    const row = store.getAttempt(attemptId)!;
    expect(row.state).toBe("Failed");
    expect(row.detail).toMatch(/ENOENT/);
  });
});
