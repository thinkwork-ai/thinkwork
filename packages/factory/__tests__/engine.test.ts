import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ACTIVE_STATES,
  VERIFICATION_STATES,
} from "../src/domain/statuses.js";
import type { LinearCommentSnapshot } from "../src/linear/client.js";
import { DEFAULT_LEDGER, type Ledger } from "../src/linear/ledger.js";
import {
  ROUTING_STATUSES,
  decideAction,
  type EngineAction,
  type EngineCandidate,
  type Phase,
  type StoreView,
} from "../src/phases/engine.js";
import { assemblePrompt, handoffMarker } from "../src/phases/prompts.js";
import { detectPhaseEvidence } from "../src/phases/evidence.js";
import { createAttemptMachine, driveAttempt } from "../src/workers/attempts.js";
import { openStore, type FactoryStore } from "../src/store/db.js";
import type {
  LaunchContext,
  LaunchOptions,
  ProviderRunner,
  WorkerHandle,
} from "../src/workers/runner.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeCandidate(
  partial: Partial<{
    identifier: string;
    title: string;
    state: string;
    labels: string[];
    ledger: Partial<Ledger>;
    synthesized: boolean;
    comments: LinearCommentSnapshot[];
  }> = {},
): EngineCandidate {
  const labels = partial.labels ?? ["Claude"];
  const state = partial.state ?? "Todo";
  const lanes = (["Claude", "Codex"] as const).filter((l) =>
    labels.includes(l),
  );
  return {
    issue: {
      identifier: partial.identifier ?? "T-1",
      title: partial.title ?? "Fix the paper cut",
      state,
      labels,
    },
    lane: lanes.length === 1 ? lanes[0] : null,
    hasLfg: labels.includes("LFG"),
    isVerification: state === "Verification" || state === "Review",
    blockerLabels: labels.filter((l) =>
      [
        "Needs User",
        "Needs Credentials",
        "Unsafe Ambiguity",
        "CI Failed",
        "Blocked: Auth",
      ].includes(l),
    ),
    ledger: {
      ledger: { ...DEFAULT_LEDGER, ...partial.ledger },
      // Default false: most tests model an issue the factory drove (real
      // block). The compound-cutoff tests set this true for a legacy issue.
      synthesized: partial.synthesized ?? false,
    },
  };
}

function emptyView(partial: Partial<StoreView> = {}): StoreView {
  return {
    activeAttempt: null,
    hasChildIssues: false,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// 1. Exhaustive phase-table test (written FIRST, observed red before engine.ts)
// ---------------------------------------------------------------------------

describe("phase table — exhaustive routing-contract coverage", () => {
  /**
   * Independent restatement of the routing contract's status table
   * (.agents/skills/thinkwork-linear-dispatcher/references/routing-contract.md)
   * — NOT derived from the engine. compounded=false, no blockers, no
   * children, no active attempt.
   */
  function expectedKind(
    status: string,
    _lane: "Claude" | "Codex",
    lfg: boolean,
  ): EngineAction["kind"] {
    switch (status) {
      case "Todo":
        return "advance";
      case "Brainstorming":
      case "Planning":
      case "Debug":
      case "Ready to Work":
      case "Ready To Work":
      case "In Progress":
        return "launch";
      case "Requirements Review":
      case "Plan Review":
        return lfg ? "advance" : "wait";
      case "Verification":
      case "Review":
        return lfg ? "launch" : "wait";
      case "Done":
        return lfg ? "launch" : "noop";
      default:
        throw new Error(`unexpected status ${status}`);
    }
  }

  const KINDS = ["launch", "advance", "wait", "block", "noop"];

  it("maps every status × lane × LFG to exactly one action of the expected kind", () => {
    for (const status of ROUTING_STATUSES) {
      for (const lane of ["Claude", "Codex"] as const) {
        for (const lfg of [true, false]) {
          const labels = lfg ? [lane, "LFG"] : [lane];
          const action = decideAction(
            makeCandidate({ state: status, labels }),
            emptyView(),
          );
          const label = `${status} × ${lane} × LFG=${lfg}`;
          expect(KINDS, label).toContain(action.kind);
          expect(action.kind, label).toBe(expectedKind(status, lane, lfg));
        }
      }
    }
  });

  it("covers all routing-contract statuses", () => {
    for (const status of [
      "Todo",
      "Brainstorming",
      "Requirements Review",
      "Planning",
      "Debug",
      "Plan Review",
      "Ready to Work",
      "Ready To Work",
      "In Progress",
      "Verification",
      "Review",
      "Done",
    ]) {
      expect(ROUTING_STATUSES).toContain(status);
    }
  });

  it("ROUTING_STATUSES is exactly the poller vocabulary: ACTIVE_STATES ∪ VERIFICATION_STATES", () => {
    // Single-source guarantee: the engine routes exactly what the enrollment
    // filter enrolls — no independently maintained third list.
    expect(new Set(ROUTING_STATUSES)).toEqual(
      new Set([...ACTIVE_STATES, ...VERIFICATION_STATES]),
    );
    expect(ROUTING_STATUSES.length).toBe(
      ACTIVE_STATES.length + VERIFICATION_STATES.length,
    );
  });

  it("Todo advances to Brainstorming (dispatcher move, no worker)", () => {
    const action = decideAction(makeCandidate({ state: "Todo" }), emptyView());
    expect(action).toMatchObject({ kind: "advance", toStatus: "Brainstorming" });
  });

  it("review gates advance to the contract statuses under LFG", () => {
    const req = decideAction(
      makeCandidate({ state: "Requirements Review", labels: ["Claude", "LFG"] }),
      emptyView(),
    );
    expect(req).toMatchObject({ kind: "advance", toStatus: "Planning" });
    const plan = decideAction(
      makeCandidate({ state: "Plan Review", labels: ["Claude", "LFG"] }),
      emptyView(),
    );
    expect(plan).toMatchObject({ kind: "advance", toStatus: "Ready to Work" });
  });

  it("review-gate statuses without LFG wait — no launch (R2 gate semantics)", () => {
    for (const state of ["Requirements Review", "Plan Review"]) {
      const action = decideAction(
        makeCandidate({ state, labels: ["Claude"] }),
        emptyView(),
      );
      expect(action.kind).toBe("wait");
    }
  });

  it("Verification without LFG waits for human review", () => {
    const action = decideAction(
      makeCandidate({ state: "Verification", labels: ["Claude"] }),
      emptyView(),
    );
    expect(action.kind).toBe("wait");
  });

  it("launch phases carry the expected phase names", () => {
    const cases: Array<[string, Phase]> = [
      ["Brainstorming", "brainstorm"],
      ["Planning", "plan"],
      ["Debug", "debug"],
      ["Ready to Work", "implement"],
      ["Ready To Work", "implement"],
      ["In Progress", "implement"],
    ];
    for (const [state, phase] of cases) {
      const action = decideAction(
        makeCandidate({ state, labels: ["Claude", "LFG"] }),
        emptyView(),
      );
      expect(action, state).toMatchObject({ kind: "launch", phase });
    }
  });

  it("Verification with Codex lane label still launches the Claude runner with browser-auth host requirement", () => {
    const action = decideAction(
      makeCandidate({ state: "Verification", labels: ["Codex", "LFG"] }),
      emptyView(),
    );
    expect(action).toMatchObject({
      kind: "launch",
      phase: "verify",
      runner: "claude",
      hostRequirement: "browser-auth",
    });
  });

  it("Verification with no lane label at all still routes to the Claude runner", () => {
    const action = decideAction(
      makeCandidate({ state: "Verification", labels: ["LFG"] }),
      emptyView(),
    );
    expect(action).toMatchObject({
      kind: "launch",
      phase: "verify",
      runner: "claude",
    });
  });

  it("Codex-lane launches outside Verification select the codex runner", () => {
    const action = decideAction(
      makeCandidate({ state: "Ready to Work", labels: ["Codex"] }),
      emptyView(),
    );
    expect(action).toMatchObject({ kind: "launch", runner: "codex" });
  });

  it("non-Verification issue with no lane label is a noop", () => {
    const action = decideAction(
      makeCandidate({ state: "Ready to Work", labels: ["LFG"] }),
      emptyView(),
    );
    expect(action.kind).toBe("noop");
  });

  it("unknown status is a noop, never a launch", () => {
    const action = decideAction(
      makeCandidate({ state: "Backlog", labels: ["Claude", "LFG"] }),
      emptyView(),
    );
    expect(action.kind).toBe("noop");
  });

  it("Ready to Work with Verification Failed label launches a repair implement", () => {
    const action = decideAction(
      makeCandidate({
        state: "Ready to Work",
        labels: ["Claude", "LFG", "Verification Failed"],
      }),
      emptyView(),
    );
    expect(action).toMatchObject({
      kind: "launch",
      phase: "implement",
      repair: true,
    });
  });
});

// ---------------------------------------------------------------------------
// 5. compounded guard on Done
// ---------------------------------------------------------------------------

describe("Done / compound guard", () => {
  it("Done + LFG + not compounded + factory-driven (real ledger) → launch compound", () => {
    const action = decideAction(
      // synthesized:false = the factory wrote this ledger, i.e. it drove the issue.
      makeCandidate({
        state: "Done",
        labels: ["Claude", "LFG"],
        synthesized: false,
      }),
      emptyView(),
    );
    expect(action).toMatchObject({ kind: "launch", phase: "compound" });
  });

  it("Done + LFG but synthesized ledger (pre-factory issue) → noop, never compound a backlog issue", () => {
    // The compound cutoff: a legacy Done issue the factory never enrolled has
    // no authored ledger (synthesized). Guards the first real poll from
    // mass-dispatching compound workers across the historical Done backlog.
    const action = decideAction(
      makeCandidate({
        state: "Done",
        labels: ["Claude", "LFG"],
        synthesized: true,
      }),
      emptyView(),
    );
    expect(action.kind).toBe("noop");
    expect(action).toMatchObject({
      reason: expect.stringContaining("never drove it"),
    });
  });

  it("Done + LFG + compounded=true → noop, never relaunch compound", () => {
    const action = decideAction(
      makeCandidate({
        state: "Done",
        labels: ["Claude", "LFG"],
        ledger: { compounded: true },
      }),
      emptyView(),
    );
    expect(action.kind).toBe("noop");
  });

  it("Done without LFG → noop (no automated compounding)", () => {
    const action = decideAction(
      makeCandidate({ state: "Done", labels: ["Claude"] }),
      emptyView(),
    );
    expect(action.kind).toBe("noop");
  });
});

// ---------------------------------------------------------------------------
// 6. block decisions: both-lane, blocker labels, child issues — idempotent
// ---------------------------------------------------------------------------

describe("block decisions", () => {
  it("both lane labels → block with Needs User", () => {
    const candidate = makeCandidate({
      state: "Ready to Work",
      labels: ["Claude", "Codex"],
    });
    const action = decideAction(candidate, emptyView());
    expect(action).toMatchObject({ kind: "block", label: "Needs User" });
  });

  it("blocker label present → block re-asserting that label, no launch", () => {
    const action = decideAction(
      makeCandidate({
        state: "Ready to Work",
        labels: ["Claude", "LFG", "CI Failed"],
      }),
      emptyView(),
    );
    expect(action).toMatchObject({ kind: "block", label: "CI Failed" });
  });

  it("child issues present → block with Needs User (KTD-12)", () => {
    const action = decideAction(
      makeCandidate({ state: "Ready to Work", labels: ["Claude", "LFG"] }),
      emptyView({ hasChildIssues: true }),
    );
    expect(action).toMatchObject({ kind: "block", label: "Needs User" });
    expect((action as { reason: string }).reason).toMatch(/child/i);
  });

  it("block decisions are idempotent — same inputs, identical action", () => {
    const candidate = makeCandidate({
      state: "Ready to Work",
      labels: ["Claude", "Codex"],
    });
    const first = decideAction(candidate, emptyView());
    const second = decideAction(candidate, emptyView());
    expect(second).toEqual(first);
  });
});

// ---------------------------------------------------------------------------
// active-attempt guard + KTD-10 mid-flight label changes
// ---------------------------------------------------------------------------

describe("active attempts and mid-run label changes (KTD-10)", () => {
  it("a running attempt → wait; the attempt is never touched", () => {
    const action = decideAction(
      makeCandidate({ state: "In Progress", labels: ["Claude", "LFG"] }),
      emptyView({ activeAttempt: { phase: "implement", state: "Running" } }),
    );
    expect(action.kind).toBe("wait");
  });

  it("LFG removed mid-flight: running attempt untouched (wait), next decision after terminal waits at the gate", () => {
    // Mid-flight: worker still running, LFG already stripped → wait, no kill.
    const during = decideAction(
      makeCandidate({ state: "In Progress", labels: ["Claude"] }),
      emptyView({ activeAttempt: { phase: "implement", state: "Running" } }),
    );
    expect(during.kind).toBe("wait");

    // Worker finished (moved issue to Verification), attempt terminal:
    // next decision applies the CURRENT labels → non-LFG Verification waits.
    const after = decideAction(
      makeCandidate({ state: "Verification", labels: ["Claude"] }),
      emptyView({ activeAttempt: null }),
    );
    expect(after.kind).toBe("wait");
  });

  it("a terminal attempt row does not block a new launch decision", () => {
    const action = decideAction(
      makeCandidate({ state: "Ready to Work", labels: ["Claude"] }),
      emptyView({ activeAttempt: { phase: "implement", state: "Failed" } }),
    );
    expect(action.kind).toBe("launch");
  });

  it("external worker signals (pids/worktrees) → wait, duplicate-worker guard", () => {
    const action = decideAction(
      makeCandidate({ state: "Ready to Work", labels: ["Claude"] }),
      emptyView({ externalWorkerSignals: ["worktree auto-t-1-implement-a1"] }),
    );
    expect(action.kind).toBe("wait");
  });
});

// ---------------------------------------------------------------------------
// 4. Worker exit without evidence → attempt Failed via the U4 machine
// ---------------------------------------------------------------------------

function makeFakeRunner(): {
  runner: ProviderRunner;
  launches: { attempt: LaunchContext; prompt: string; opts: LaunchOptions }[];
} {
  const launches: {
    attempt: LaunchContext;
    prompt: string;
    opts: LaunchOptions;
  }[] = [];
  const runner: ProviderRunner = {
    async launch(attempt, prompt, opts) {
      launches.push({ attempt, prompt, opts });
      return {
        attemptId: attempt.attemptId,
        pid: 4242,
        logPath: "/tmp/fake.log",
        pidPath: "/tmp/fake.pid",
        cwd: opts.cwd,
      } satisfies WorkerHandle;
    },
    async liveness() {
      return false;
    },
    async logTail() {
      return "";
    },
    async kill() {
      return true;
    },
    async result() {
      return {
        exitObserved: true,
        completed: true,
        success: true,
        rateLimited: false,
        events: [],
      };
    },
  };
  return { runner, launches };
}

describe("worker exit without evidence (engine + U4 machine)", () => {
  it("no baton, no status move, no PR → attempt Failed, never silently advanced", async () => {
    const dir = mkdtempSync(join(tmpdir(), "factory-engine-"));
    let store: FactoryStore | undefined;
    try {
      store = openStore(dir);
      const machine = createAttemptMachine(store);
      const { attemptId } = machine.begin({
        issueId: "iss_1",
        phase: "implement",
        slug: "t-1",
        worktreesDir: "/tmp/wts",
      });
      const { runner } = makeFakeRunner();

      const final = await driveAttempt({
        machine,
        runner,
        attemptId,
        buildPrompt: async () => "implement it",
        launchOptions: { model: "sonnet", cwd: "/tmp/wt" },
        checkEvidence: async () => {
          const evidence = await detectPhaseEvidence({
            phase: "implement",
            issueIdentifier: "T-1",
            statusAtLaunch: "In Progress",
            currentStatus: "In Progress", // worker never moved it
            comments: [], // worker never posted a baton
          });
          return evidence.complete;
        },
      });

      expect(final).toBe("Failed");
      const row = store.getAttempt(attemptId)!;
      expect(row.state).toBe("Failed");
      expect(row.detail).toMatch(/evidence/i);
    } finally {
      store?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 7. AE1 (Claude half) skeleton: full walk driven by evidence transitions
// ---------------------------------------------------------------------------

describe("AE1 skeleton — one issue walks label → Done → compound on the Claude lane", () => {
  it("produces the exact action sequence advance → 5 launches → noop", async () => {
    const ID = "T-9";
    const TITLE = "Paper cut: tooltip clipped";
    let state = "Todo";
    const labels = ["Claude", "LFG"];
    const comments: LinearCommentSnapshot[] = [];
    let compounded = false;
    let nextCommentId = 1;
    const post = (body: string) =>
      comments.push({ id: `c-${nextCommentId++}`, body });

    const candidate = (): EngineCandidate =>
      makeCandidate({
        identifier: ID,
        title: TITLE,
        state,
        labels: [...labels],
        ledger: { compounded },
        comments: [...comments],
      });

    const sequence: string[] = [];
    const describeAction = (a: EngineAction): string =>
      a.kind === "launch" ? `launch:${a.phase}` : a.kind;

    // Simulated executor + worker: apply the action, leave the evidence a
    // real worker would leave, and assert evidence detection sees the phase
    // as complete before the next decision.
    for (let step = 0; step < 10; step++) {
      const action = decideAction(candidate(), emptyView());
      sequence.push(describeAction(action));
      if (action.kind === "noop") break;

      if (action.kind === "advance") {
        state = action.toStatus;
        continue;
      }
      if (action.kind !== "launch") {
        throw new Error(`unexpected action in walk: ${action.kind}`);
      }

      // Assemble the worker prompt; post the synthesized baton BEFORE launch
      // when no handoff comment exists yet.
      const assembled = assemblePrompt({
        phase: action.phase,
        issueId: ID,
        title: TITLE,
        comments: [...comments],
        progressDoc: "## Next Steps\n- continue the walk",
      });
      if (assembled.batonToPost !== null) post(assembled.batonToPost);
      expect(assembled.prompt).toContain(ID);

      const statusAtLaunch = state;
      const idsAtLaunch = new Set(comments.map((c) => c.id));

      // Simulated worker leaves the contract-mandated evidence.
      switch (action.phase) {
        case "brainstorm":
          post(`${handoffMarker(ID, "Planning")}\n\nGoal: plan it.`);
          state = "Planning";
          break;
        case "plan":
          post(`${handoffMarker(ID, "Ready to Work")}\n\nGoal: build it.`);
          state = "Ready to Work";
          break;
        case "implement":
          post(`${handoffMarker(ID, "Verification")}\n\nGoal: verify it.`);
          state = "Verification";
          break;
        case "verify":
          expect(action.hostRequirement).toBe("browser-auth");
          post(`${handoffMarker(ID, "Done")}\n\nGoal: compound it.`);
          state = "Done";
          break;
        case "compound":
          compounded = true; // executor sets the ledger flag after compound
          break;
        default:
          throw new Error(`unexpected phase ${action.phase}`);
      }

      const evidence = await detectPhaseEvidence({
        phase: action.phase,
        issueIdentifier: ID,
        statusAtLaunch,
        currentStatus: state,
        comments: [...comments],
        commentIdsAtLaunch: idsAtLaunch,
        ledgerCompounded: compounded,
      });
      expect(evidence.complete, `evidence after ${action.phase}`).toBe(true);
    }

    expect(sequence).toEqual([
      "advance",
      "launch:brainstorm",
      "launch:plan",
      "launch:implement",
      "launch:verify",
      "launch:compound",
      "noop",
    ]);
  });
});
