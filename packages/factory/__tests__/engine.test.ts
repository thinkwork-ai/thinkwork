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
  ATTEMPT_CEILING,
  ROUTING_STATUSES,
  blockMarker,
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
  const state = partial.state ?? "Brainstorming";
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
    comments: partial.comments,
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
        // Done is terminal — auto-compound disabled, so ALWAYS noop
        // (regardless of LFG / ledger state).
        return "noop";
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
    ]) {
      expect(ROUTING_STATUSES).toContain(status);
    }
    // Done is TERMINAL and no longer enrolled (auto-compound disabled): keeping
    // it enrolled cost ~4 Linear API requests per Done issue per tick.
    expect(ROUTING_STATUSES).not.toContain("Done");
  });

  it("Todo is BELOW the enrollment floor — not routed at all", () => {
    // Enrollment floor is Brainstorming. A lane-labeled Todo issue is ideation
    // the operator still owns; the daemon must never touch it (no advance, no
    // launch). It is excluded from the routing vocabulary and, if one ever
    // reached the engine, falls through to a noop.
    expect(ROUTING_STATUSES).not.toContain("Todo");
    const action = decideAction(
      makeCandidate({ state: "Todo", labels: ["Claude", "LFG"] }),
      emptyView(),
    );
    expect(action.kind).toBe("noop");
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

  it("Verification ALWAYS launches the Codex runner (computer-use strength), any lane label", () => {
    const action = decideAction(
      makeCandidate({ state: "Verification", labels: ["Claude", "LFG"] }),
      emptyView(),
    );
    expect(action).toMatchObject({
      kind: "launch",
      phase: "verify",
      runner: "codex",
      hostRequirement: "browser-auth",
    });
  });

  it("Verification with no lane label at all still routes to the Codex runner", () => {
    const action = decideAction(
      makeCandidate({ state: "Verification", labels: ["LFG"] }),
      emptyView(),
    );
    expect(action).toMatchObject({
      kind: "launch",
      phase: "verify",
      runner: "codex",
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

describe("Done is terminal — auto-compound disabled", () => {
  it("Done + LFG + not compounded + factory-driven (real ledger) → noop (NOT a compound launch)", () => {
    // Auto-compound is disabled: the factory never launches a worker on a Done
    // issue, even a factory-driven one that was never compounded. (ce-compound
    // is a manual operator action now.) This is what closes the compound
    // retry-loop: an already-compounded issue's re-dispatched worker exited
    // "nothing to compound" without leaving compounded:true, so the executor
    // marked a successful run Failed and relaunched it forever.
    const action = decideAction(
      makeCandidate({
        state: "Done",
        labels: ["Claude", "LFG"],
        synthesized: false,
      }),
      emptyView(),
    );
    expect(action.kind).toBe("noop");
    expect(action).toMatchObject({
      reason: expect.stringContaining("auto-compound disabled"),
    });
  });

  it("Done + LFG but synthesized ledger (pre-factory issue) → noop", () => {
    const action = decideAction(
      makeCandidate({
        state: "Done",
        labels: ["Claude", "LFG"],
        synthesized: true,
      }),
      emptyView(),
    );
    expect(action.kind).toBe("noop");
  });

  it("Done + LFG + compounded=true → noop", () => {
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

  // A Done issue is terminal: stale in-flight blockers must NOT produce a
  // `block` (that would thread + escalate, then un-enroll closes it → a
  // per-tick open/@mention/close loop on old Done issues).
  it("Done + stale blocker label (Needs User / CI Failed) → noop, NOT block", () => {
    for (const blocker of ["Needs User", "CI Failed", "Blocked: Auth"]) {
      const action = decideAction(
        makeCandidate({ state: "Done", labels: ["Claude", blocker] }),
        emptyView(),
      );
      expect(action.kind, `Done + ${blocker}`).toBe("noop");
    }
  });

  it("Done + BOTH lane labels → noop, NOT a lane-conflict block", () => {
    const action = decideAction(
      makeCandidate({ state: "Done", labels: ["Claude", "Codex"] }),
      emptyView(),
    );
    expect(action.kind).toBe("noop");
  });

  it("Done + child issues → noop, NOT a KTD-12 block", () => {
    const action = decideAction(
      makeCandidate({ state: "Done", labels: ["Claude"] }),
      emptyView({ hasChildIssues: true }),
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

  it("child issues in flight → QUIET wait, never a Needs User block (LFG never-stuck)", () => {
    // In Progress parent (a Ready-to-Work parent first ADVANCES there for
    // board legibility — covered in the parent-legibility describe).
    const action = decideAction(
      makeCandidate({ state: "In Progress", labels: ["Claude", "LFG"] }),
      emptyView({ hasChildIssues: true, childStates: ["Done", "In Progress"] }),
    );
    expect(action.kind).toBe("wait");
    expect((action as { reason: string }).reason).toMatch(/child/i);
  });

  it("child states unknown (fetch failed) → wait, never a false resume", () => {
    const action = decideAction(
      makeCandidate({ state: "In Progress", labels: ["Claude", "LFG"] }),
      emptyView({ hasChildIssues: true, childStates: null }),
    );
    expect(action.kind).toBe("wait");
  });

  it("ALL children Done → the parent proceeds normally (launches its phase)", () => {
    const action = decideAction(
      makeCandidate({ state: "Ready to Work", labels: ["Claude", "LFG"] }),
      emptyView({ hasChildIssues: true, childStates: ["Done", "Canceled"] }),
    );
    expect(action.kind).toBe("launch");
  });

  it("waiting-on dependency NOT Done → quiet wait; Done → proceeds", () => {
    const waiting = decideAction(
      makeCandidate({ state: "Ready to Work", labels: ["Claude", "LFG"] }),
      emptyView({
        dependency: { identifier: "THINK-273", state: "Ready to Work", done: false },
      }),
    );
    expect(waiting.kind).toBe("wait");
    expect((waiting as { reason: string }).reason).toContain("THINK-273");

    const resumed = decideAction(
      makeCandidate({ state: "Ready to Work", labels: ["Claude", "LFG"] }),
      emptyView({
        dependency: { identifier: "THINK-273", state: "Done", done: true },
      }),
    );
    expect(resumed.kind).toBe("launch");
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
// escalation wedge: ceiling / quota escalations must be resumable by the
// operator (Fix: escalation wedge — a ceiling/quota escalation can never
// resume because the derived signal is recomputed every tick).
// ---------------------------------------------------------------------------

describe("ceiling/quota escalation is resumable (operator override)", () => {
  const blockComment = (id: string): LinearCommentSnapshot => ({
    id: `c-block-${id}`,
    body: `${blockMarker(id)}\n\nAutomation blocked this issue.`,
    authorId: "viewer-daemon",
  });

  it("ceiling reached with Needs User still present → escalates (block), no launch", () => {
    const action = decideAction(
      makeCandidate({
        identifier: "T-9",
        state: "Ready to Work",
        labels: ["Claude", "LFG", "Needs User"],
      }),
      emptyView({ consecutiveKillsByPhase: { implement: ATTEMPT_CEILING } }),
    );
    // Needs User is itself a blocker label → the block short-circuits first.
    expect(action).toMatchObject({ kind: "block", label: "Needs User" });
  });

  it("ceiling reached, no override marker → escalates to Needs User", () => {
    const action = decideAction(
      makeCandidate({
        identifier: "T-9",
        state: "Ready to Work",
        labels: ["Claude", "LFG"],
      }),
      emptyView({ consecutiveKillsByPhase: { implement: ATTEMPT_CEILING } }),
    );
    expect(action).toMatchObject({ kind: "block", label: "Needs User" });
    expect((action as { reason: string }).reason).toMatch(/consecutive/i);
  });

  it("ceiling reached but operator removed Needs User with the block marker present → fresh launch (override)", () => {
    const action = decideAction(
      makeCandidate({
        identifier: "T-9",
        state: "Ready to Work",
        labels: ["Claude", "LFG"], // Needs User deliberately removed
        comments: [blockComment("T-9")],
      }),
      emptyView({ consecutiveKillsByPhase: { implement: ATTEMPT_CEILING } }),
    );
    // The override launch is ONE-SHOT: it must flag the executor to consume the
    // block marker so a further failure re-escalates instead of looping.
    expect(action).toMatchObject({
      kind: "launch",
      phase: "implement",
      consumesEscalationOverride: true,
    });
  });

  it("a normal launch (below ceiling, no quota) does NOT consume an override", () => {
    const action = decideAction(
      makeCandidate({
        identifier: "T-9",
        state: "Ready to Work",
        labels: ["Claude", "LFG"],
      }),
      emptyView(),
    );
    expect(action).toMatchObject({ kind: "launch", phase: "implement" });
    expect(
      (action as { consumesEscalationOverride?: boolean })
        .consumesEscalationOverride,
    ).toBeUndefined();
  });

  it("quota expired, no override → escalates to Needs User", () => {
    const action = decideAction(
      makeCandidate({
        identifier: "T-9",
        state: "Ready to Work",
        labels: ["Claude", "LFG"],
      }),
      emptyView({ quota: { kind: "expired" } }),
    );
    expect(action).toMatchObject({ kind: "block", label: "Needs User" });
    expect((action as { reason: string }).reason).toMatch(/QuotaCooldown/);
  });

  it("quota expired but operator override (marker present, Needs User absent) → routes normally", () => {
    const action = decideAction(
      makeCandidate({
        identifier: "T-9",
        state: "Ready to Work",
        labels: ["Claude", "LFG"],
        comments: [blockComment("T-9")],
      }),
      emptyView({ quota: { kind: "expired" } }),
    );
    expect(action).toMatchObject({
      kind: "launch",
      phase: "implement",
      consumesEscalationOverride: true,
    });
  });

  it("override marker for a DIFFERENT issue does not enable the override", () => {
    const action = decideAction(
      makeCandidate({
        identifier: "T-9",
        state: "Ready to Work",
        labels: ["Claude", "LFG"],
        comments: [blockComment("T-OTHER")],
      }),
      emptyView({ consecutiveKillsByPhase: { implement: ATTEMPT_CEILING } }),
    );
    expect(action).toMatchObject({ kind: "block", label: "Needs User" });
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

describe("AE1 skeleton — one issue walks label → Done on the Claude lane", () => {
  it("produces the exact action sequence 4 launches → noop (Done is terminal; no compound)", async () => {
    const ID = "T-9";
    const TITLE = "Paper cut: tooltip clipped";
    // Enrollment floor: the operator has moved the issue into Brainstorming
    // (the "start the factory" gesture). The daemon takes over from there.
    let state = "Brainstorming";
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
          post(`${handoffMarker(ID, "Done")}\n\nGoal: done.`);
          state = "Done";
          break;
        default:
          // compound is never auto-launched (Done is terminal); the walk ends
          // at the Done noop after verify.
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
      "launch:brainstorm",
      "launch:plan",
      "launch:implement",
      "launch:verify",
      "noop",
    ]);
  });
});

describe("parent board legibility", () => {
  it("a Ready-to-Work parent with children in flight ADVANCES to In Progress (visible, not idle)", () => {
    const action = decideAction(
      makeCandidate({ state: "Ready to Work", labels: ["Claude", "LFG"] }),
      emptyView({ hasChildIssues: true, childStates: ["In Progress"] }),
    );
    expect(action).toMatchObject({ kind: "advance", toStatus: "In Progress" });
  });

  it("an In-Progress parent with children in flight waits quietly (no advance churn)", () => {
    const action = decideAction(
      makeCandidate({ state: "In Progress", labels: ["Claude", "LFG"] }),
      emptyView({ hasChildIssues: true, childStates: ["In Progress"] }),
    );
    expect(action.kind).toBe("wait");
  });
});
