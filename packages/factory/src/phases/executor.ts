/**
 * Action executor (U5 wiring slice): turns one EngineAction into idempotent
 * Linear/store side effects. The engine DECIDES, this module EXECUTES.
 *
 * Launch is atomic per the routing contract:
 *   1. attempt row created in the store (PreparingWorkspace) — the store
 *      record exists before ANY Linear write, so nothing is ever orphaned;
 *   2. synthesized baton posted (when no handoff comment existed);
 *   3. `dispatcher:<ISSUE_ID>:<PHASE>:<Lane>` launch-marker comment posted;
 *   4. worker-bootstrap.sh (named exit codes — refusal fails the attempt
 *      with the named code in detail, no partial state, runner never runs);
 *   5. driveAttempt: prompt → detached worker → wait → evidence → terminal.
 * If a Linear write fails AFTER the worker process started, the failure is
 * recorded as `launch-recording-failed` on the attempt row for the U6
 * reconciliation sweep — a replacement worker is NEVER created.
 */

import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mkdirSync } from "node:fs";

import { getArtifactsDir } from "../config.js";
import type { FactoryConfig, HostConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { CommentTrust, LinearGateway } from "../linear/client.js";
import {
  findLedgerComment,
  parseLedgerComment,
  renderLedgerComment,
  type Ledger,
} from "../linear/ledger.js";
import { isMarkerComment } from "../linear/markers.js";
import type { PollCandidate } from "../linear/poller.js";
import type { FactoryStore } from "../store/db.js";
import {
  driveAttempt,
  type AttemptMachine,
  type AttemptState,
} from "../workers/attempts.js";
import type { ProviderRunner, ResultOptions } from "../workers/runner.js";
import {
  acquireDevLock,
  phaseNeedsDevLock,
  releaseDevLock,
} from "../sweep/locks.js";
import {
  BLOCK_MARKER_PREFIX,
  blockMarker,
  type EngineAction,
  type RunnerKind,
} from "./engine.js";
import {
  detectPhaseEvidence,
  type GithubGateway,
  type PhaseEvidence,
} from "./evidence.js";
import { assemblePrompt } from "./prompts.js";

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

/** Launch-marker comment: `dispatcher:<ISSUE_ID>:<PHASE>:<Lane>`. */
export function launchMarker(
  issueIdentifier: string,
  phase: string,
  runner: RunnerKind,
): string {
  const lane = runner === "codex" ? "Codex" : "Claude";
  return `dispatcher:${issueIdentifier}:${phase}:${lane}`;
}

/** Block-marker comment (mirrors preflight's `factory-preflight:` pattern).
 * Defined in engine.ts (shared with the escalation-override check) and
 * re-exported here for the executor's block-marker writes and its tests. */
export { BLOCK_MARKER_PREFIX, blockMarker };

// ---------------------------------------------------------------------------
// Bootstrap runner
// ---------------------------------------------------------------------------

/** Named exit codes — keep in sync with scripts/worker-bootstrap.sh. */
export const BOOTSTRAP_EXIT_NAMES: Record<number, string> = {
  64: "usage",
  65: "repo-not-git",
  66: "fetch-failed",
  67: "target-exists",
  68: "branch-exists",
  69: "worktree-add-failed",
  70: "tsbuildinfo-purge-failed",
  71: "env-source-missing",
  72: "env-copy-failed",
  73: "port-busy",
};

export interface BootstrapResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type BootstrapRunner = (
  scriptPath: string,
  args: string[],
) => Promise<BootstrapResult>;

/** Default: run the script via bash with execFile, never throw on non-zero. */
export const defaultRunBootstrap: BootstrapRunner = (scriptPath, args) =>
  new Promise((resolve) => {
    execFile(
      "bash",
      [scriptPath, ...args],
      { maxBuffer: 1024 * 1024, timeout: 5 * 60_000 },
      (error, stdout, stderr) => {
        const code =
          error === null
            ? 0
            : typeof (error as NodeJS.ErrnoException & { code?: unknown })
                  .code === "number"
              ? ((error as unknown as { code: number }).code as number)
              : null;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });

/** Absolute path of the bundled worker-bootstrap.sh. */
export function defaultBootstrapScriptPath(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "scripts",
    "worker-bootstrap.sh",
  );
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export interface ExecutorDeps {
  gateway: LinearGateway;
  store: FactoryStore;
  machine: AttemptMachine;
  config: FactoryConfig;
  /** Local host used for launches (repoPath is the bootstrap --repo). */
  host: HostConfig;
  teamKey: string;
  /** Directory under which per-attempt worktrees are created. */
  worktreesDir: string;
  bootstrapScript: string;
  /** Injectable for tests; defaults to bash execFile. */
  runBootstrap?: BootstrapRunner;
  /** Runner per lane; null = lane not runnable on this daemon (Codex → U9). */
  runnerFor: (kind: RunnerKind) => ProviderRunner | null;
  log: Logger;
  /** Passed through to ProviderRunner.result (tests shrink the timeout). */
  resultOptions?: ResultOptions;
  /**
   * GitHub gateway for the merged-PR evidence fallback. Without it, a worker
   * that merged its PR but died before posting the baton is classified
   * Failed and its phase relaunched over already-merged work.
   */
  github?: GithubGateway;
  /** Author allowlist for batons / baton evidence (security P1). */
  trust?: CommentTrust;
  /**
   * Await the worker run to completion inside executeAction (tests). The
   * PRODUCTION default is DETACHED: the tick returns right after the launch
   * and the run settles in a background continuation — awaiting inside the
   * tick serialized the whole board behind one worker's multi-hour SLA
   * (live 2026-07-13: THINK-274/270 couldn't even get a wait decision while
   * THINK-275's implement worker ran).
   */
  awaitLaunches?: boolean;
}

export interface ExecuteResult {
  kind: EngineAction["kind"];
  /** True when anything was written to Linear or the store this call. */
  wrote: boolean;
  attemptId?: number;
  finalState?: AttemptState;
  detail?: string;
}

function ledgersEqual(a: Ledger, b: Ledger): boolean {
  return (
    a.phase === b.phase &&
    a.lane === b.lane &&
    a.attempt === b.attempt &&
    a.blocker === b.blocker &&
    a.compounded === b.compounded &&
    (a.worker === null) === (b.worker === null) &&
    (a.worker === null ||
      (a.worker.id === b.worker!.id && a.worker.host === b.worker!.host))
  );
}

/**
 * Write the rolling ledger only when it differs from what the candidate's
 * snapshot already carries. Update-in-place when a ledger comment exists.
 */
async function writeLedgerIfChanged(
  deps: ExecutorDeps,
  candidate: PollCandidate,
  next: Ledger,
): Promise<boolean> {
  if (
    !candidate.ledger.synthesized &&
    ledgersEqual(candidate.ledger.ledger, next)
  ) {
    return false;
  }
  const rendered = renderLedgerComment(
    candidate.issue.identifier,
    next,
    candidate.ledger.prose,
  );
  if (candidate.ledgerCommentId !== null) {
    await deps.gateway.updateComment(candidate.ledgerCommentId, rendered);
  } else {
    await deps.gateway.createComment(candidate.issue.id, rendered);
  }
  return true;
}

/** Ledger `phase` value implied by an advance target status. */
const STATUS_TO_LEDGER_PHASE: Record<string, string> = {
  Brainstorming: "brainstorm",
  Planning: "plan",
  "Ready to Work": "implement",
  "Ready To Work": "implement",
  Debug: "plan",
};

async function executeAdvance(
  action: Extract<EngineAction, { kind: "advance" }>,
  candidate: PollCandidate,
  deps: ExecutorDeps,
): Promise<ExecuteResult> {
  const { issue } = candidate;
  let wrote = false;

  if (issue.state !== action.toStatus) {
    await deps.gateway.setState(issue.id, action.toStatus);
    wrote = true;
  }

  const next: Ledger = {
    ...candidate.ledger.ledger,
    phase:
      STATUS_TO_LEDGER_PHASE[action.toStatus] ?? candidate.ledger.ledger.phase,
    blocker: null,
  };
  if (await writeLedgerIfChanged(deps, candidate, next)) wrote = true;

  deps.log.info("advance executed", {
    issue: issue.identifier,
    toStatus: action.toStatus,
    evidence: action.evidence,
    wrote,
  });
  return { kind: "advance", wrote };
}

async function executeBlock(
  action: Extract<EngineAction, { kind: "block" }>,
  candidate: PollCandidate,
  deps: ExecutorDeps,
): Promise<ExecuteResult> {
  const { issue, comments } = candidate;
  let wrote = false;

  if (!issue.labels.includes(action.label)) {
    await deps.gateway.addLabel(issue.id, action.label);
    wrote = true;
  }

  const marker = blockMarker(issue.identifier);
  if (!comments.some((c) => isMarkerComment(c.body, marker))) {
    const body = [
      marker,
      "",
      `**Automation blocked this issue** (\`${action.label}\`).`,
      "",
      action.reason,
      "",
      "No worker was launched. Remove the blocker label after resolving to resume automation.",
    ].join("\n");
    await deps.gateway.createComment(issue.id, body);
    wrote = true;
  }

  const next: Ledger = { ...candidate.ledger.ledger, blocker: action.label };
  if (await writeLedgerIfChanged(deps, candidate, next)) wrote = true;

  deps.log.info("block executed", {
    issue: issue.identifier,
    label: action.label,
    reason: action.reason,
    wrote,
  });
  return { kind: "block", wrote };
}

async function executeLaunch(
  action: Extract<EngineAction, { kind: "launch" }>,
  candidate: PollCandidate,
  deps: ExecutorDeps,
): Promise<ExecuteResult> {
  const { issue } = candidate;
  const id = issue.identifier;
  const runner = deps.runnerFor(action.runner);
  if (runner === null) {
    deps.log.warn("no runner available for lane — skipping launch", {
      issue: id,
      phase: action.phase,
      runner: action.runner,
    });
    return { kind: "launch", wrote: false, detail: "no-runner" };
  }
  const phaseConfig = deps.config.phases[action.phase];
  if (phaseConfig === undefined) {
    deps.log.error("phase missing from config — skipping launch", {
      issue: id,
      phase: action.phase,
    });
    return { kind: "launch", wrote: false, detail: "no-phase-config" };
  }

  // Consume a one-shot escalation override: this launch is only allowed because
  // an operator cleared a ceiling/quota escalation, so supersede the
  // `factory-block:` marker. If this attempt fails too, the next tick sees no
  // active marker → re-escalates (re-adds Needs User + a fresh marker) instead
  // of relaunching forever. Best-effort: a failed supersede must not abort the
  // launch (the store attempt is the source of truth for the kill count).
  if (action.consumesEscalationOverride === true) {
    const marker = blockMarker(id);
    const blockComment = candidate.comments.find((c) =>
      isMarkerComment(c.body, marker),
    );
    if (blockComment !== undefined) {
      try {
        await deps.gateway.updateComment(
          blockComment.id,
          `factory-block-cleared:${id}\n\n_Operator cleared this escalation; a fresh attempt was launched. This override is consumed — a further failure re-escalates._\n\n${blockComment.body}`,
        );
      } catch (e) {
        deps.log.warn(
          "failed to supersede escalation-override marker — continuing launch",
          { issue: id, error: String(e) },
        );
      }
    }
  }

  // ---- 0. Dev-deployment mutex (KTD-11): Verification drives the shared dev
  // stack, so it must hold the single dev-deployment lock for the duration of
  // the run. decideAction already deferred a launch when the lock was held by
  // another issue; this is the belt-and-suspenders acquire (and it also covers
  // the reentrant/self-held case). Contended → defer without creating an
  // attempt; released in the finally below. ----
  const needsDevLock = phaseNeedsDevLock(action.phase);
  if (needsDevLock) {
    const lock = acquireDevLock(deps.store, issue.id, new Date());
    if (!lock.acquired) {
      deps.log.info(
        "dev-deployment lock held by another issue — deferring this launch",
        { issue: id, phase: action.phase, heldBy: lock.heldBy },
      );
      return {
        kind: "launch",
        wrote: false,
        detail: `dev-lock held by ${lock.heldBy}`,
      };
    }
  }

  try {
    return await runLaunch(action, candidate, deps, runner, phaseConfig);
  } finally {
    if (needsDevLock) releaseDevLock(deps.store, issue.id);
  }
}

/** The launch body, wrapped by executeLaunch's dev-deployment lock lifecycle. */
async function runLaunch(
  action: Extract<EngineAction, { kind: "launch" }>,
  candidate: PollCandidate,
  deps: ExecutorDeps,
  runner: ProviderRunner,
  phaseConfig: FactoryConfig["phases"][string],
): Promise<ExecuteResult> {
  const { issue } = candidate;
  const id = issue.identifier;

  // ---- 0. Host capacity gate: detached launches no longer self-limit via
  // tick serialization, so cap live attempts per host explicitly. Deferred
  // launches simply retry on a later tick (the issue stays routable). ----
  const activeOnHost = (
    deps.store.db
      .prepare("SELECT COUNT(*) AS n FROM attempts WHERE active = 1 AND host = ?")
      .get(deps.host.name) as { n: number }
  ).n;
  if (activeOnHost >= deps.host.maxConcurrent) {
    deps.log.info("host at capacity — launch deferred to a later tick", {
      issue: id,
      phase: action.phase,
      host: deps.host.name,
      active: activeOnHost,
      maxConcurrent: deps.host.maxConcurrent,
    });
    return {
      kind: "launch",
      wrote: false,
      detail: `host ${deps.host.name} at capacity (${activeOnHost}/${deps.host.maxConcurrent}) — deferred`,
    };
  }

  // ---- 1. Store record FIRST: attempt N+1 in PreparingWorkspace. ----------
  const slug = id.toLowerCase();
  let plan;
  try {
    plan = deps.machine.begin({
      issueId: issue.id,
      phase: action.phase,
      slug,
      worktreesDir: deps.worktreesDir,
      host: deps.host.name,
    });
  } catch (e) {
    deps.log.error("attempt creation refused — not launching", {
      issue: id,
      phase: action.phase,
      error: String(e),
    });
    return { kind: "launch", wrote: false, detail: `begin failed: ${String(e)}` };
  }

  // ---- 2. Assemble the prompt (Progress doc read for baton synthesis). ----
  const failBeforeSpawn = (detail: string): ExecuteResult => {
    deps.machine.transition(plan.attemptId, "Failed", detail.slice(0, 1000));
    deps.log.error("launch aborted before spawn", {
      issue: id,
      phase: action.phase,
      attemptId: plan.attemptId,
      detail,
    });
    return {
      kind: "launch",
      wrote: true,
      attemptId: plan.attemptId,
      finalState: "Failed",
      detail,
    };
  };

  let assembled;
  try {
    // U7: verify workers persist screenshots to a durable per-issue folder
    // (worktrees are cleaned after the run). Create it at launch so the
    // prompt's mandatory copy step can never fail on a missing parent, and
    // inject the absolute path into the template's <ARTIFACTS_DIR>.
    let artifactsDir: string | undefined;
    if (action.phase === "verify") {
      artifactsDir = getArtifactsDir(id);
      mkdirSync(artifactsDir, { recursive: true });
    }
    const progressDoc =
      (await deps.gateway.getProgressDocument(issue.id, issue.title)) ?? "";
    assembled = assemblePrompt({
      phase: action.phase,
      issueId: id,
      title: issue.title,
      comments: candidate.comments,
      progressDoc,
      repair: action.repair,
      trust: deps.trust,
      artifactsDir,
      project: deps.config.project,
    });
  } catch (e) {
    return failBeforeSpawn(`prompt assembly failed: ${String(e)}`);
  }
  if (assembled.batonToPost !== null) {
    deps.log.info(
      "no trusted baton found for this phase — synthesized one from the Progress document",
      { issue: id, phase: action.phase },
    );
  }

  const statusAtLaunch = issue.state;
  // Freshest Linear status the evidence checks observed. Recording
  // statusAtLaunch in the issue row froze the store one phase behind reality
  // (an implement worker that moved the issue to Verification left the row at
  // "Ready to Work" until the NEXT launch) — the in-thread Slack `status`
  // keyword then answered with that stale state.
  let lastObservedStatus = statusAtLaunch;
  const commentIdsAtLaunch = new Set(candidate.comments.map((c) => c.id));

  // ---- 3. Baton (when synthesized) + launch marker are posted AFTER the
  // bootstrap gate succeeds (see the bootstrap hook below). A refused bootstrap
  // must not spam a launch-marker comment for a worker that never launched —
  // both are still pre-spawn (a Linear failure there fails the attempt with
  // nothing running), just gated on a green bootstrap. ----
  const postBatonAndMarker = async (): Promise<void> => {
    if (assembled.batonToPost !== null) {
      await deps.gateway.createComment(issue.id, assembled.batonToPost);
      commentIdsAtLaunch.add(
        // The fake/real gateway assigns ids server-side; re-reading here just
        // to learn the id is not worth a round-trip — evidence detection also
        // matches on marker text, and a synthesized baton is for THIS phase's
        // READ status, not its completion status, so it can't self-satisfy.
        `synthesized-baton-${plan.attemptId}`,
      );
    }
    const markerBody = [
      launchMarker(id, action.phase, action.runner),
      "",
      `Launching **${action.phase}** worker (attempt ${plan.attemptNumber}) on host \`${deps.host.name}\`.`,
      "",
      `- branch: \`${plan.branch}\``,
      `- worktree: \`${plan.worktreePath}\``,
      `- model: \`${phaseConfig.model}\`${deps.config.enforceBudgetUsd ? ` (budget backstop $${phaseConfig.budgetUsd})` : ` (SLA ${phaseConfig.wallClockSlaMinutes}m; no dollar cap)`}`,
      `- expected stop: durable evidence per the routing contract (baton/status/PR)`,
    ].join("\n");
    await deps.gateway.createComment(issue.id, markerBody);
  };

  // ---- 4+5. Bootstrap gate + drive the attempt lifecycle. -----------------
  const runBootstrap = deps.runBootstrap ?? defaultRunBootstrap;
  let spawned = false;
  let evidence: PhaseEvidence | null = null;
  let freshCommentsForRecording = candidate.comments;
  // Launch-time worker ledger write, kicked off when the attempt reaches
  // Running (pid known) and awaited after driveAttempt returns — the ledger
  // must be able to answer "is anyone working this" while the worker runs.
  let workerLedgerWrite: Promise<void> | null = null;

  const runToCompletion = async (): Promise<AttemptState> => {
  const final = await driveAttempt({
    machine: deps.machine,
    runner,
    attemptId: plan.attemptId,
    bootstrap: async () => {
      const result = await runBootstrap(deps.bootstrapScript, [
        "--repo",
        deps.host.repoPath,
        "--worktree",
        plan.worktreePath,
        "--branch",
        plan.branch,
      ]);
      if (result.code !== 0) {
        const name =
          result.code !== null
            ? (BOOTSTRAP_EXIT_NAMES[result.code] ?? "unknown")
            : "signal";
        throw new Error(
          `worker-bootstrap refused: ${name} (exit ${result.code}): ${result.stderr.trim()}`,
        );
      }
      // Bootstrap gate is green — NOW post the synthesized baton (if any) and
      // the launch marker. A Linear failure here still precedes the spawn, so
      // driveAttempt lands the attempt Failed with nothing running.
      await postBatonAndMarker();
    },
    buildPrompt: async () => assembled.prompt,
    launchOptions: {
      model: phaseConfig.model,
      cwd: plan.worktreePath,
      // Dollar backstop only when explicitly enforced (API-billed hosts). On a
      // subscription the reported cost is notional, so omit the cap and let the
      // wall-clock SLA + stall detection govern the worker.
      budgetUsd: deps.config.enforceBudgetUsd ? phaseConfig.budgetUsd : undefined,
    },
    launchContext: {
      issueId: id,
      phase: action.phase,
      attemptNumber: plan.attemptNumber,
    },
    onTransition: (state) => {
      if (state === "Running") {
        spawned = true;
        // Legibility: record WHO is working this in the rolling ledger. The
        // pid was persisted by recordLaunch just before this transition.
        const pid = deps.store.getAttempt(plan.attemptId)?.pid ?? null;
        const running: Ledger = {
          ...candidate.ledger.ledger,
          phase: action.phase,
          lane: candidate.lane ?? candidate.ledger.ledger.lane,
          worker: {
            id: pid !== null ? String(pid) : `attempt-${plan.attemptId}`,
            host: deps.host.name,
          },
          attempt: plan.attemptNumber,
          blocker: null,
        };
        workerLedgerWrite = writeLedgerIfChanged(deps, candidate, running)
          .then(() => undefined)
          .catch((e: unknown) => {
            deps.log.warn("launch-time worker ledger write failed", {
              issue: id,
              attemptId: plan.attemptId,
              error: String(e),
            });
          });
        // Board legibility: an implement worker actively running is VISIBLE —
        // move Ready to Work → In Progress at spawn. Without this the board
        // shows "Ready to Work" for the worker's whole multi-hour run,
        // indistinguishable from an idle issue (live operator complaint
        // 2026-07-13). In Progress routes implement identically, statusAtLaunch
        // keeps the original status so evidence detection is unaffected, and
        // failures relaunch from In Progress the same as Ready to Work.
        if (
          action.phase === "implement" &&
          (statusAtLaunch === "Ready to Work" || statusAtLaunch === "Ready To Work")
        ) {
          void deps.gateway
            .setState(issue.id, "In Progress")
            .catch((e: unknown) =>
              deps.log.warn("launch-time In Progress move failed — cosmetic only", {
                issue: id,
                error: String(e),
              }),
            );
        }
      }
      deps.log.info("attempt transition", {
        issue: id,
        phase: action.phase,
        attemptId: plan.attemptId,
        state,
      });
    },
    resultOptions: deps.resultOptions,
    // WIRING CONTRACT (batch A): bound the result wait by the phase SLA so a
    // 120-minute implement phase is not cut off by the runner's default.
    wallClockSlaMinutes: phaseConfig.wallClockSlaMinutes,
    checkEvidence: async () => {
      // Re-read ONLY this issue's fresh state — never drain the whole team.
      // listTeamIssues N+1s state+labels over every team issue; running that
      // inside driveAttempt's Finishing step stalls the single-dispatch tick
      // for minutes under Linear rate-limiting (observed live on THINK-265).
      const [fresh] = await deps.gateway.getIssuesByIdentifier([
        issue.identifier,
      ]);
      if (fresh?.state !== undefined && fresh.state !== "") {
        lastObservedStatus = fresh.state;
      }
      const freshComments = await deps.gateway.listComments(issue.id);
      freshCommentsForRecording = freshComments;
      const freshLedgerComment = findLedgerComment(id, freshComments);
      const freshLedger = parseLedgerComment(id, freshLedgerComment?.body);
      evidence = await detectPhaseEvidence({
        phase: action.phase,
        issueIdentifier: id,
        statusAtLaunch,
        currentStatus: fresh?.state ?? statusAtLaunch,
        comments: freshComments,
        commentIdsAtLaunch,
        ledgerCompounded: freshLedger.ledger.compounded,
        ledgerBlocker: freshLedger.ledger.blocker,
        branch: plan.branch,
        github: deps.github,
        trust: deps.trust,
      });
      return evidence.complete;
    },
  });

  // Settle the in-flight launch ledger write before recording outcomes.
  // (Cast for the same closure-write reason as `evidence` below.)
  const pendingWorkerLedgerWrite = workerLedgerWrite as Promise<void> | null;
  if (pendingWorkerLedgerWrite !== null) await pendingWorkerLedgerWrite;

  // ---- 6. Record what the daemon observed (ledger + issue row). -----------
  // (Widen through a cast: TS's flow analysis can't see the closure write
  // inside checkEvidence and would otherwise narrow `evidence` to null.)
  const observed = evidence as PhaseEvidence | null;
  if (final === "Succeeded" && observed !== null && observed.complete) {
    const completed: Extract<PhaseEvidence, { complete: true }> = observed;
    try {
      const freshLedgerComment = findLedgerComment(
        id,
        freshCommentsForRecording,
      );
      const freshParsed = parseLedgerComment(id, freshLedgerComment?.body);
      const next: Ledger = {
        ...freshParsed.ledger,
        phase: action.phase,
        lane: candidate.lane ?? freshParsed.ledger.lane,
        worker: null,
        attempt: plan.attemptNumber,
        // A dependency-wait run's whole point is the `waiting-on:` blocker —
        // clearing it would relaunch immediately and re-hit the gate forever.
        blocker:
          completed.kind === "dependency-wait"
            ? freshParsed.ledger.blocker
            : null,
        compounded:
          action.phase === "compound" ? true : freshParsed.ledger.compounded,
      };
      if (!ledgersEqual(freshParsed.ledger, next)) {
        const rendered = renderLedgerComment(id, next, freshParsed.prose);
        if (freshLedgerComment !== null) {
          await deps.gateway.updateComment(freshLedgerComment.id, rendered);
        } else {
          await deps.gateway.createComment(issue.id, rendered);
        }
      }
      deps.store.upsertIssue({
        issueId: issue.id,
        identifier: id,
        lane: candidate.lane ?? "unassigned",
        phase: action.phase,
        // The freshest status observed by the evidence checks — usually where
        // the worker MOVED the issue, not where it launched from.
        state: lastObservedStatus,
        compounded: next.compounded ? 1 : 0,
      });
      deps.log.info("launch succeeded with evidence", {
        issue: id,
        phase: action.phase,
        attemptId: plan.attemptId,
        evidence: completed.kind,
        detail: completed.detail,
      });
    } catch (e) {
      // Worker already ran — never spawn a replacement; flag for the U6
      // reconciliation sweep instead. store.transitionAttempt keeps the
      // terminal state and appends the flag as detail.
      deps.store.transitionAttempt(
        plan.attemptId,
        final,
        `launch-recording-failed: ${String(e)}`.slice(0, 1000),
      );
      deps.log.error("launch-recording-failed — flagged for reconciliation", {
        issue: id,
        phase: action.phase,
        attemptId: plan.attemptId,
        error: String(e),
      });
    }
  } else if (
    final === "Failed" ||
    final === "TimedOut" ||
    final === "Stalled"
  ) {
    // Legibility: the captured failure detail must be Linear-visible in the
    // rolling ledger, not just a local log line.
    const detail = deps.store.getAttempt(plan.attemptId)?.detail ?? null;
    deps.log.warn("worker ended without durable evidence", {
      issue: id,
      phase: action.phase,
      attemptId: plan.attemptId,
      spawned,
      final,
      detail,
    });
    try {
      // Re-read comments: checkEvidence may never have run (e.g. TimedOut),
      // leaving freshCommentsForRecording at the stale launch snapshot.
      let freshComments = freshCommentsForRecording;
      try {
        freshComments = await deps.gateway.listComments(issue.id);
      } catch {
        // Fall back to the freshest snapshot we already hold.
      }
      const freshLedgerComment = findLedgerComment(id, freshComments);
      const freshParsed = parseLedgerComment(id, freshLedgerComment?.body);
      const failureLine =
        `Attempt ${plan.attemptNumber} (${action.phase}) ${final}` +
        (detail !== null && detail !== "" ? `: ${detail}` : "");
      const next: Ledger = { ...freshParsed.ledger, worker: null };
      const prose =
        freshParsed.prose === ""
          ? failureLine.slice(0, 1000)
          : `${freshParsed.prose}\n\n${failureLine.slice(0, 1000)}`;
      const rendered = renderLedgerComment(id, next, prose);
      if (freshLedgerComment !== null) {
        await deps.gateway.updateComment(freshLedgerComment.id, rendered);
      } else {
        await deps.gateway.createComment(issue.id, rendered);
      }
    } catch (e) {
      deps.log.warn("failure ledger write failed", {
        issue: id,
        attemptId: plan.attemptId,
        error: String(e),
      });
    }
  }

  return final;
  };

  // Tests await the full run for deterministic assertions; production
  // detaches so the tick (and every other issue's decisions) never waits on
  // a worker's wall-clock SLA. KTD-10's active-attempt guard prevents
  // duplicate launches while the detached run is in flight, and the U7
  // reconciler adopts the attempt if the daemon dies mid-run (the worker
  // process is detached either way).
  if (deps.awaitLaunches === true) {
    const final = await runToCompletion();
    return {
      kind: "launch",
      wrote: true,
      attemptId: plan.attemptId,
      finalState: final,
    };
  }

  runToCompletion()
    .then((final) =>
      deps.log.info("detached launch settled", {
        issue: id,
        phase: action.phase,
        attemptId: plan.attemptId,
        finalState: final,
      }),
    )
    .catch((e) => {
      deps.log.error("detached launch crashed — settling attempt Failed", {
        issue: id,
        phase: action.phase,
        attemptId: plan.attemptId,
        error: String(e),
      });
      try {
        deps.store.transitionAttempt(
          plan.attemptId,
          "Failed",
          `detached-run-crashed: ${String(e)}`.slice(0, 1000),
        );
      } catch {
        // Already terminal (or store unavailable) — the sweep/reconciler owns it.
      }
    });

  return {
    kind: "launch",
    wrote: true,
    attemptId: plan.attemptId,
    detail: "detached — worker running in background; the run settles asynchronously",
  };
}

/**
 * Execute one engine decision. Idempotent for advance/block/wait/noop —
 * re-running against an already-applied snapshot writes nothing.
 */
export async function executeAction(
  action: EngineAction,
  candidate: PollCandidate,
  deps: ExecutorDeps,
): Promise<ExecuteResult> {
  switch (action.kind) {
    case "advance":
      return executeAdvance(action, candidate, deps);
    case "block":
      return executeBlock(action, candidate, deps);
    case "launch":
      return executeLaunch(action, candidate, deps);
    case "wait":
    case "noop":
      // Ledger touch only if changed — nothing changes for wait/noop, so
      // this is structurally write-free.
      deps.log.debug(`${action.kind} — no writes`, {
        issue: candidate.issue.identifier,
        reason: action.reason,
      });
      return { kind: action.kind, wrote: false, detail: action.reason };
  }
}
