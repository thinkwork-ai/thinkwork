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

import type { FactoryConfig, HostConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { LinearGateway } from "../linear/client.js";
import {
  isLedgerComment,
  parseLedgerComment,
  renderLedgerComment,
  type Ledger,
} from "../linear/ledger.js";
import type { PollCandidate } from "../linear/poller.js";
import type { FactoryStore } from "../store/db.js";
import {
  driveAttempt,
  type AttemptMachine,
  type AttemptState,
} from "../workers/attempts.js";
import type { ProviderRunner, ResultOptions } from "../workers/runner.js";
import type { EngineAction, RunnerKind } from "./engine.js";
import { detectPhaseEvidence, type PhaseEvidence } from "./evidence.js";
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

/** Block-marker comment (mirrors preflight's `factory-preflight:` pattern). */
export const BLOCK_MARKER_PREFIX = "factory-block:";

export function blockMarker(issueIdentifier: string): string {
  return `${BLOCK_MARKER_PREFIX}${issueIdentifier}`;
}

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
  if (!comments.some((c) => c.body.includes(marker))) {
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
    const progressDoc =
      (await deps.gateway.getProgressDocument(issue.id, issue.title)) ?? "";
    assembled = assemblePrompt({
      phase: action.phase,
      issueId: id,
      title: issue.title,
      comments: candidate.comments,
      progressDoc,
      repair: action.repair,
    });
  } catch (e) {
    return failBeforeSpawn(`prompt assembly failed: ${String(e)}`);
  }

  const statusAtLaunch = issue.state;
  const commentIdsAtLaunch = new Set(candidate.comments.map((c) => c.id));

  // ---- 3. Baton (when synthesized) then launch marker — both pre-spawn. ---
  try {
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
      `- model: \`${phaseConfig.model}\` (budget backstop $${phaseConfig.budgetUsd})`,
      `- expected stop: durable evidence per the routing contract (baton/status/PR)`,
    ].join("\n");
    await deps.gateway.createComment(issue.id, markerBody);
  } catch (e) {
    // Nothing spawned yet — safe to fail the attempt outright.
    return failBeforeSpawn(`pre-launch Linear write failed: ${String(e)}`);
  }

  // ---- 4+5. Bootstrap gate + drive the attempt lifecycle. -----------------
  const runBootstrap = deps.runBootstrap ?? defaultRunBootstrap;
  let spawned = false;
  let evidence: PhaseEvidence | null = null;
  let freshCommentsForRecording = candidate.comments;

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
    },
    buildPrompt: async () => assembled.prompt,
    launchOptions: {
      model: phaseConfig.model,
      cwd: plan.worktreePath,
      budgetUsd: phaseConfig.budgetUsd,
    },
    launchContext: {
      issueId: id,
      phase: action.phase,
      attemptNumber: plan.attemptNumber,
    },
    onTransition: (state) => {
      if (state === "Running") spawned = true;
      deps.log.info("attempt transition", {
        issue: id,
        phase: action.phase,
        attemptId: plan.attemptId,
        state,
      });
    },
    resultOptions: deps.resultOptions,
    checkEvidence: async () => {
      const issues = await deps.gateway.listTeamIssues(deps.teamKey);
      const fresh = issues.find((i) => i.id === issue.id);
      const freshComments = await deps.gateway.listComments(issue.id);
      freshCommentsForRecording = freshComments;
      const freshLedgerComment = freshComments.find((c) =>
        isLedgerComment(id, c.body),
      );
      const freshLedger = parseLedgerComment(id, freshLedgerComment?.body);
      evidence = await detectPhaseEvidence({
        phase: action.phase,
        issueIdentifier: id,
        statusAtLaunch,
        currentStatus: fresh?.state ?? statusAtLaunch,
        comments: freshComments,
        commentIdsAtLaunch,
        ledgerCompounded: freshLedger.ledger.compounded,
        branch: plan.branch,
      });
      return evidence.complete;
    },
  });

  // ---- 6. Record what the daemon observed (ledger + issue row). -----------
  // (Widen through a cast: TS's flow analysis can't see the closure write
  // inside checkEvidence and would otherwise narrow `evidence` to null.)
  const observed = evidence as PhaseEvidence | null;
  if (final === "Succeeded" && observed !== null && observed.complete) {
    const completed: Extract<PhaseEvidence, { complete: true }> = observed;
    try {
      const freshLedgerComment = freshCommentsForRecording.find((c) =>
        isLedgerComment(id, c.body),
      );
      const freshParsed = parseLedgerComment(id, freshLedgerComment?.body);
      const next: Ledger = {
        ...freshParsed.ledger,
        phase: action.phase,
        lane: candidate.lane ?? freshParsed.ledger.lane,
        worker: null,
        attempt: plan.attemptNumber,
        blocker: null,
        compounded:
          action.phase === "compound" ? true : freshParsed.ledger.compounded,
      };
      if (!ledgersEqual(freshParsed.ledger, next)) {
        const rendered = renderLedgerComment(id, next, freshParsed.prose);
        if (freshLedgerComment !== undefined) {
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
        state: statusAtLaunch,
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
  } else if (spawned && final === "Failed") {
    deps.log.warn("worker exited without durable evidence", {
      issue: id,
      phase: action.phase,
      attemptId: plan.attemptId,
    });
  }

  return {
    kind: "launch",
    wrote: true,
    attemptId: plan.attemptId,
    finalState: final,
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
