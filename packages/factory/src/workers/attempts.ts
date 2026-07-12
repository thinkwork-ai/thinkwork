/**
 * KTD-4 run-attempt state machine, persisted through the U2 operational
 * store.
 *
 *   PreparingWorkspace → BuildingPrompt → LaunchingAgentProcess → Running
 *     → Finishing → Succeeded
 *
 * with terminals Succeeded / Failed / TimedOut / Stalled / QuotaCooldown /
 * CanceledByReconciliation. Illegal jumps (e.g. Finishing → Running) are
 * rejected before the store is touched. A relaunch is always a NEW attempt
 * (N+1) with its own branch and worktree; attempt N's worktree stays in
 * place for forensics (R15).
 *
 * The store's generated `active` column + partial unique index enforce "at
 * most one active attempt per issue+phase" at the SQLite layer; this module
 * enforces the transition legality on top.
 */

import { join } from "node:path";

import { TERMINAL_ATTEMPT_STATES, type FactoryStore } from "../store/db.js";
import type { ProviderRunner, LaunchOptions } from "./runner.js";

export type AttemptState =
  | "PreparingWorkspace"
  | "BuildingPrompt"
  | "LaunchingAgentProcess"
  | "Running"
  | "Finishing"
  | "HostUnreachable"
  | "Succeeded"
  | "Failed"
  | "TimedOut"
  | "Stalled"
  | "QuotaCooldown"
  | "CanceledByReconciliation";

export { TERMINAL_ATTEMPT_STATES };

/**
 * Legal transitions per the plan's run-attempt lifecycle diagram (KTD-4 +
 * KTD-8/KTD-9 refinements). HostUnreachable is included for U6/U10: the SLA
 * clock pauses there and the attempt resumes or fails when the host returns.
 */
export const ATTEMPT_TRANSITIONS: Record<
  AttemptState,
  readonly AttemptState[]
> = {
  PreparingWorkspace: ["BuildingPrompt", "Failed", "CanceledByReconciliation"],
  BuildingPrompt: [
    "LaunchingAgentProcess",
    "Failed",
    "CanceledByReconciliation",
  ],
  LaunchingAgentProcess: ["Running", "Failed", "CanceledByReconciliation"],
  Running: [
    "Finishing",
    "Stalled",
    "TimedOut",
    "QuotaCooldown",
    "HostUnreachable",
    "Failed",
    "CanceledByReconciliation",
  ],
  HostUnreachable: ["Running", "Failed", "CanceledByReconciliation"],
  Finishing: ["Succeeded", "Failed"],
  Succeeded: [],
  Failed: [],
  TimedOut: [],
  Stalled: [],
  QuotaCooldown: [],
  CanceledByReconciliation: [],
};

export class IllegalTransitionError extends Error {
  constructor(
    readonly attemptId: number,
    readonly from: string,
    readonly to: string,
  ) {
    super(`attempt ${attemptId}: illegal transition ${from} → ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export interface AttemptPlanInput {
  issueId: string;
  phase: string;
  /** Issue slug used in branch/worktree names, e.g. "think-999". */
  slug: string;
  /** Directory under which per-attempt worktrees are created. */
  worktreesDir: string;
  host?: string;
}

export interface AttemptPlan {
  attemptId: number;
  attemptNumber: number;
  /** Attempt-suffixed branch: auto/<slug>-<phase>-a<N>. */
  branch: string;
  /** Per-attempt worktree path: <worktreesDir>/auto-<slug>-<phase>-a<N>. */
  worktreePath: string;
}

export interface AttemptMachine {
  /** Create attempt max(N)+1 in PreparingWorkspace with its branch/worktree plan. */
  begin(input: AttemptPlanInput): AttemptPlan;
  /**
   * Create attempt N+1 after a prior attempt ended. Requires at least one
   * prior attempt and no active one; never touches attempt N's worktree.
   */
  relaunch(input: AttemptPlanInput): AttemptPlan;
  /** Validated state transition, persisted via the store. */
  transition(attemptId: number, to: AttemptState, detail?: string): void;
  /** Persist pid/log facts learned at launch time. */
  recordLaunch(attemptId: number, exec: { pid: number; logPath: string }): void;
}

export function attemptBranch(slug: string, phase: string, n: number): string {
  return `auto/${slug}-${phase}-a${n}`;
}

export function attemptWorktreePath(
  worktreesDir: string,
  slug: string,
  phase: string,
  n: number,
): string {
  return join(worktreesDir, `auto-${slug}-${phase}-a${n}`);
}

function isAttemptState(value: string): value is AttemptState {
  return value in ATTEMPT_TRANSITIONS;
}

export function createAttemptMachine(store: FactoryStore): AttemptMachine {
  const maxAttemptStmt = store.db.prepare(
    "SELECT MAX(attempt_number) AS n FROM attempts WHERE issue_id = ? AND phase = ?",
  );

  function nextAttemptNumber(issueId: string, phase: string): number {
    const row = maxAttemptStmt.get(issueId, phase) as { n: number | null };
    return (row.n ?? 0) + 1;
  }

  function create(input: AttemptPlanInput, attemptNumber: number): AttemptPlan {
    const branch = attemptBranch(input.slug, input.phase, attemptNumber);
    const worktreePath = attemptWorktreePath(
      input.worktreesDir,
      input.slug,
      input.phase,
      attemptNumber,
    );
    const attemptId = store.insertAttempt({
      issueId: input.issueId,
      phase: input.phase,
      attemptNumber,
      state: "PreparingWorkspace",
      host: input.host,
      branch,
      worktreePath,
    });
    return { attemptId, attemptNumber, branch, worktreePath };
  }

  return {
    begin(input) {
      return create(input, nextAttemptNumber(input.issueId, input.phase));
    },

    relaunch(input) {
      const active = store.getActiveAttempt(input.issueId, input.phase);
      if (active) {
        throw new Error(
          `attempt ${active.id} for ${input.issueId}/${input.phase} is still active (${active.state}) — kill/settle it before relaunching`,
        );
      }
      const next = nextAttemptNumber(input.issueId, input.phase);
      if (next === 1) {
        throw new Error(
          `no prior attempt for ${input.issueId}/${input.phase} — use begin() for attempt 1`,
        );
      }
      return create(input, next);
    },

    transition(attemptId, to, detail) {
      const row = store.getAttempt(attemptId);
      if (!row) throw new Error(`attempt ${attemptId} does not exist`);
      if (!isAttemptState(to)) {
        throw new IllegalTransitionError(attemptId, row.state, to);
      }
      const from = row.state;
      const allowed = isAttemptState(from) ? ATTEMPT_TRANSITIONS[from] : [];
      if (!allowed.includes(to)) {
        throw new IllegalTransitionError(attemptId, from, to);
      }
      store.transitionAttempt(attemptId, to, detail);
    },

    recordLaunch(attemptId, exec) {
      store.updateAttemptExec(attemptId, {
        pid: exec.pid,
        logPath: exec.logPath,
      });
    },
  };
}

export interface DriveAttemptInput {
  machine: AttemptMachine;
  runner: ProviderRunner;
  /** An attempt already in PreparingWorkspace (from begin/relaunch). */
  attemptId: number;
  /** Workspace bootstrap hook; throw to fail the fixture gate. */
  bootstrap?: () => Promise<void>;
  buildPrompt: () => Promise<string>;
  launchOptions: LaunchOptions;
  /**
   * Evidence check (R8): did the worker leave durable evidence (baton posted,
   * status moved, PR opened)? Succeeded only when this fires; exit without
   * evidence is Failed, never silently advanced.
   */
  checkEvidence: () => Promise<boolean>;
  resultOptions?: { pollMs?: number; timeoutMs?: number };
  /**
   * Phase wall-clock SLA in minutes (KTD-4). When `resultOptions.timeoutMs`
   * is not set, the runner's result wait is bounded to this SLA instead of
   * the runner's own default. WIRING CONTRACT (batch B): the executor/CLI
   * must pass `phaseConfig.wallClockSlaMinutes` here so a 120-minute
   * implement phase is not cut off by the runner's 15-minute default wait.
   */
  wallClockSlaMinutes?: number;
  onTransition?: (state: AttemptState) => void;
  /** Launch context passed to the runner; issueId/phase for log naming. */
  launchContext?: { issueId: string; phase: string; attemptNumber: number };
}

/**
 * Drive one attempt through its lifecycle with a provider runner:
 * bootstrap → prompt → launch (pid recorded) → wait for exit → classify.
 * Returns the terminal state reached (always persisted before returning).
 */
export async function driveAttempt(
  input: DriveAttemptInput,
): Promise<AttemptState> {
  const { machine, runner, attemptId } = input;
  const step = (to: AttemptState, detail?: string): void => {
    machine.transition(attemptId, to, detail);
    input.onTransition?.(to);
  };
  const fail = (detail: string): AttemptState => {
    step("Failed", detail.slice(0, 1000));
    return "Failed";
  };

  try {
    await input.bootstrap?.();
  } catch (e) {
    return fail(`bootstrap failed: ${String(e)}`);
  }
  step("BuildingPrompt");

  let prompt: string;
  try {
    prompt = await input.buildPrompt();
  } catch (e) {
    return fail(`prompt build failed: ${String(e)}`);
  }
  step("LaunchingAgentProcess");

  const context = input.launchContext ?? {
    issueId: `attempt-${attemptId}`,
    phase: "unknown",
    attemptNumber: 1,
  };
  let handle;
  try {
    handle = await runner.launch(
      { attemptId, ...context },
      prompt,
      input.launchOptions,
    );
  } catch (e) {
    return fail(`launch failed: ${String(e)}`);
  }
  machine.recordLaunch(attemptId, { pid: handle.pid, logPath: handle.logPath });
  step("Running");

  // Bound the result wait by the phase wall-clock SLA when the caller did
  // not pin an explicit timeout (see wallClockSlaMinutes wiring contract).
  const timeoutMs =
    input.resultOptions?.timeoutMs ??
    (input.wallClockSlaMinutes !== undefined
      ? input.wallClockSlaMinutes * 60_000
      : undefined);
  const resultOptions =
    timeoutMs !== undefined
      ? { ...input.resultOptions, timeoutMs }
      : input.resultOptions;

  let result;
  try {
    result = await runner.result(handle, resultOptions);
  } catch (e) {
    // A throw here must not strand the attempt in Running (orphaned forever
    // by decideAction) — land it terminal like every other lifecycle step.
    return fail(`result wait failed: ${String(e)}`);
  }

  if (!result.exitObserved) {
    // The wait bound elapsed with the worker potentially still alive. NEVER
    // mark the attempt terminal over a live worker — that frees the
    // issue+phase slot and the next tick would launch a duplicate worker.
    // Kill first, then release the slot as TimedOut.
    let alive = true;
    try {
      alive = await runner.liveness(handle);
    } catch {
      // Liveness probe failed — assume alive and kill best-effort.
    }
    if (alive) {
      try {
        await runner.kill(handle);
      } catch {
        // Best-effort: kill failures must not block the terminal transition.
      }
    }
    step("TimedOut", "wall-clock timeout — worker killed before slot release");
    return "TimedOut";
  }

  // A rate-limit signal only diverts to cooldown when the run did NOT reach
  // a successful completion — incidental quota chatter on a healthy run must
  // not eclipse an observed success.
  if (result.rateLimited && !(result.completed && result.success)) {
    step("QuotaCooldown", "provider rate-limit signal observed");
    return "QuotaCooldown";
  }

  step("Finishing");
  let evidence = false;
  let evidenceError: string | undefined;
  try {
    evidence = await input.checkEvidence();
  } catch (e) {
    evidenceError = String(e);
  }
  if (evidence) {
    step("Succeeded");
    return "Succeeded";
  }
  return fail(
    evidenceError
      ? `evidence check failed: ${evidenceError}`
      : "worker exited without durable evidence",
  );
}
