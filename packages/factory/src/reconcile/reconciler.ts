/**
 * Boot + periodic reconciliation (U7, R16/R22, KTD-6; Flow F4).
 *
 * A daemon crash or reboot can leave the store disagreeing with reality: an
 * attempt row still marked active whose worker is gone, a phase whose PR merged
 * while the daemon was down, a Linear write that never landed after the worker
 * launched, or (worst case) a deleted store. The reconciler compares stored
 * expectations against observed reality and repairs partial state so the very
 * next poll tick starts from a consistent world — without ever double-launching
 * a worker.
 *
 * Four repairs (plan §U7):
 *   (a) ORPHANED ATTEMPT — an attempt the store thinks is active but has no live
 *       pid (or never recorded one). Reuses U6 `evaluateLiveness`; before
 *       failing it, checks for phase evidence the dead worker may have left
 *       (baton / externally-merged PR) and ADOPTS it (advance, no relaunch);
 *       otherwise settles it CanceledByReconciliation("orphaned by daemon
 *       restart") + drops the lease, so decide() relaunches a fresh attempt
 *       (AE6). The CanceledByReconciliation terminal state (not Failed) keeps a
 *       daemon-restart expiry OUT of the attempt-ceiling kill count — only the
 *       live sweep counts a genuine worker failure.
 *   (b) EXTERNALLY-MERGED PR — the merged-PR fallback of `detectPhaseEvidence`:
 *       adopt as completion evidence and advance the issue instead of
 *       relaunching implement.
 *   (c) LAUNCH-RECORDING-FAILED — the Symphony case: the worker ran and left
 *       evidence but the daemon died before the Linear ledger write landed
 *       (executor flags this in the attempt detail). Re-apply the ledger/issue
 *       write idempotently and clear the flag.
 *   (d) EMPTY STORE — the operational DB was deleted. Rebuild the issue cache
 *       from a Linear scan (issues + ledger blocks) WITHOUT dispatching. No
 *       attempts are fabricated; surviving external workers are still caught by
 *       the tick's duplicate-worker guard (`git worktree list`), so the rebuild
 *       can never cause a duplicate dispatch.
 *
 * REUSE vs NEW: the liveness verdict + settle/drop-lease mechanics are U6
 * (`evaluateLiveness`, `renewLease`, `store.transitionAttempt`,
 * `store.deleteLease`). The reconciler ADDS: treating a null-pid active attempt
 * as an orphan (the sweep's mid-launch grace does not survive a restart),
 * evidence-adoption BEFORE failing an orphan, the Symphony repair, and the
 * empty-store rebuild.
 */

import type { CommentTrust, LinearGateway } from "../linear/client.js";
import {
  findLedgerComment,
  parseLedgerComment,
  renderLedgerComment,
  type Ledger,
} from "../linear/ledger.js";
import { LANE_LABELS, type LaneLabel } from "../domain/statuses.js";
import type { Logger } from "../logger.js";
import {
  detectPhaseEvidence,
  type GithubGateway,
  type PhaseEvidence,
} from "../phases/evidence.js";
import { PHASE_HANDOFF, type Phase } from "../phases/engine.js";
import type { AttemptRow, FactoryStore } from "../store/db.js";
import { evaluateLiveness, renewLease } from "../sweep/leases.js";
import {
  phaseNeedsDevLock,
  releaseDevLock,
  releaseOrphanedDevLock,
} from "../sweep/locks.js";
import type { HostTransport } from "../workers/transport.js";

/** Sentinel the executor writes into an attempt's detail when the worker ran
 * but the post-run Linear write failed (see executor `launch-recording-failed`). */
export const LAUNCH_RECORDING_FAILED_PREFIX = "launch-recording-failed";

const KNOWN_PHASES = new Set<string>(Object.keys(PHASE_HANDOFF));

export type ReconcileOutcomeKind =
  | "reattached"
  | "host-unreachable"
  | "adopted-evidence"
  | "expired-orphan"
  | "recording-repaired"
  | "skipped";

export interface ReconcileOutcome {
  issue: string;
  attemptId?: number;
  kind: ReconcileOutcomeKind;
  detail?: string;
}

export interface ReconcileResult {
  /** Issues repopulated from Linear because the store was empty (0 otherwise). */
  rebuiltIssues: number;
  /** Every attempt/issue the reconciler touched, in processing order. */
  outcomes: ReconcileOutcome[];
  /** Identifiers whose orphaned attempt was expired — decide() relaunches. */
  relaunchQueued: string[];
}

export interface ReconcileDeps {
  store: FactoryStore;
  gateway: LinearGateway;
  transport: HostTransport;
  /** Merged-PR evidence source (absent → PR adoption is skipped). */
  github?: GithubGateway;
  now: () => Date;
  teamKey: string;
  /** Per-phase silence budget for the liveness stall check (minutes). */
  silenceBudgetMinutesFor: (phase: string) => number;
  leaseTtlMinutes?: number;
  /** Baton-author allowlist for evidence adoption (fail-safe when absent). */
  trust?: CommentTrust;
  log: Logger;
}

function asPhase(phase: string): Phase | null {
  return KNOWN_PHASES.has(phase) ? (phase as Phase) : null;
}

function singleLane(labels: string[]): LaneLabel | null {
  const lanes = LANE_LABELS.filter((l) => labels.includes(l));
  return lanes.length === 1 ? lanes[0] : null;
}

/**
 * Release the dev-deployment lock for an attempt the reconciler just settled
 * out of a verify phase (Fix: dev-lock leak). A verify worker holds the single
 * dev-deployment mutex for its run; if it was orphaned by the daemon's death,
 * the executor's in-process `finally` never ran, so the lock leaked. Dropping
 * it here (belt-and-suspenders alongside the boot-time `releaseOrphanedDevLock`
 * sweep) unblocks the next verify phase immediately.
 */
function releaseVerifyDevLock(deps: ReconcileDeps, attempt: AttemptRow): void {
  const phase = asPhase(attempt.phase);
  if (phase !== null && phaseNeedsDevLock(phase)) {
    releaseDevLock(deps.store, attempt.issue_id);
  }
}

/**
 * Rebuild the issue cache from Linear when the store is empty (KTD-6). Only the
 * `issues` rows are repopulated — NO attempts, NO dispatch. Returns the count.
 */
async function rebuildFromLinear(deps: ReconcileDeps): Promise<number> {
  const issues = await deps.gateway.listTeamIssues(deps.teamKey);
  let rebuilt = 0;
  for (const issue of issues) {
    let compounded = 0;
    let phase = "todo";
    try {
      const comments = await deps.gateway.listComments(issue.id);
      const ledgerComment = findLedgerComment(issue.identifier, comments);
      const parsed = parseLedgerComment(issue.identifier, ledgerComment?.body);
      compounded = parsed.ledger.compounded ? 1 : 0;
      phase = parsed.ledger.phase;
    } catch (e) {
      // A single unreadable issue must not abort the whole rebuild; fall back
      // to defaults (the cache is advisory and re-derived every tick anyway).
      deps.log.warn("rebuild: ledger read failed — using defaults", {
        issue: issue.identifier,
        error: String(e),
      });
    }
    deps.store.upsertIssue({
      issueId: issue.id,
      identifier: issue.identifier,
      lane: singleLane(issue.labels) ?? "unassigned",
      phase,
      state: issue.state,
      compounded,
    });
    rebuilt += 1;
  }
  deps.log.info("store rebuilt from Linear scan (no dispatch)", { rebuilt });
  return rebuilt;
}

/** True when the store holds no issues and no attempts (deleted / fresh DB). */
function storeIsEmpty(store: FactoryStore): boolean {
  const issues = store.db
    .prepare("SELECT COUNT(*) AS n FROM issues")
    .get() as { n: number };
  const attempts = store.db
    .prepare("SELECT COUNT(*) AS n FROM attempts")
    .get() as { n: number };
  return issues.n === 0 && attempts.n === 0;
}

/** The post-completion status a phase advances an issue to, honoring a verify
 * fail rebound. Null when the phase has no forward status (compound). */
function advanceTargetFor(phase: Phase, evidence: PhaseEvidence): string | null {
  if (evidence.complete && phase === "verify") {
    return evidence.outcome === "fail" ? "Ready to Work" : "Done";
  }
  return PHASE_HANDOFF[phase].posts;
}

/**
 * Reconcile ONE orphaned active attempt: adopt phase evidence the dead worker
 * left (advance, no relaunch), else settle Failed + drop lease so decide()
 * relaunches. Returns the outcome and whether a relaunch was queued.
 */
async function reconcileOrphan(
  deps: ReconcileDeps,
  attempt: AttemptRow,
): Promise<{ outcome: ReconcileOutcome; relaunch: boolean }> {
  const issueRow = deps.store.getIssue(attempt.issue_id);
  const identifier = issueRow?.identifier ?? attempt.issue_id;
  const phase = asPhase(attempt.phase);

  // Try to adopt evidence the worker may have left before dying. Needs the
  // human identifier + a fresh Linear read; when any of that is unavailable we
  // fall through to a plain expiry (never a silent advance).
  if (phase !== null && issueRow !== undefined) {
    let evidence: PhaseEvidence = {
      complete: false,
      reason: "evidence not checked",
    };
    // Hoisted so the adopt path below can reuse it for the advance target —
    // nothing moves the status between here and the settle, so a second Linear
    // read would be redundant.
    let currentStatus = issueRow.state;
    try {
      const [fresh] = await deps.gateway.getIssuesByIdentifier([identifier]);
      currentStatus = fresh?.state ?? issueRow.state;
      const comments = await deps.gateway.listComments(attempt.issue_id);
      evidence = await detectPhaseEvidence({
        phase,
        issueIdentifier: identifier,
        // The worker launched from this phase's read-status; anything the
        // worker moved it to (or a merged PR) counts as completion evidence.
        statusAtLaunch: PHASE_HANDOFF[phase].reads,
        currentStatus,
        comments,
        branch: attempt.branch ?? undefined,
        github: deps.github,
        trust: deps.trust,
      });
    } catch (e) {
      deps.log.warn("reconcile: evidence check failed — expiring orphan", {
        issue: identifier,
        attemptId: attempt.id,
        error: String(e),
      });
    }

    if (evidence.complete) {
      // The phase actually finished while the daemon was down. Settle the
      // attempt Succeeded in the STORE FIRST — this is the idempotent commit
      // point: once the attempt is terminal it is out of listActiveAttempts(),
      // so even if the Linear advance below throws, the NEXT reconcile finds it
      // already Succeeded and never relaunches the already-completed work
      // (Fix: adoption write-failure must not relaunch completed work).
      deps.store.transitionAttempt(
        attempt.id,
        "Succeeded",
        `adopted ${evidence.kind}: ${evidence.detail}`.slice(0, 1000),
      );
      deps.store.deleteLease(attempt.issue_id);
      releaseVerifyDevLock(deps, attempt);
      if (evidence.kind !== "status-moved") {
        // Advance the issue if the worker died before moving the status itself
        // (baton / merged-PR evidence). Reuse the status already read for
        // evidence detection — nothing has moved it since. A failure here is
        // best-effort: the attempt is already Succeeded (no relaunch), and the
        // dead worker's worktree guards the daemon against a duplicate launch
        // until the advance is re-driven.
        const target = advanceTargetFor(phase, evidence);
        if (target !== null && currentStatus !== target) {
          try {
            await deps.gateway.setState(attempt.issue_id, target);
          } catch (e) {
            deps.log.error(
              "reconcile: adopted-evidence advance write failed — attempt already Succeeded, no relaunch",
              {
                issue: identifier,
                attemptId: attempt.id,
                target,
                error: String(e),
              },
            );
          }
        }
      }
      deps.log.info("reconcile: adopted externally-completed phase evidence", {
        issue: identifier,
        attemptId: attempt.id,
        phase,
        evidence: evidence.kind,
      });
      return {
        outcome: {
          issue: identifier,
          attemptId: attempt.id,
          kind: "adopted-evidence",
          detail: evidence.detail,
        },
        relaunch: false,
      };
    }
  }

  // No evidence — the attempt was orphaned by the daemon's death. Settle it as
  // CanceledByReconciliation (NOT Failed) and drop the lease; the next decide()
  // relaunches a fresh attempt (AE6). The distinct terminal state keeps a
  // restart-expiry OUT of the attempt-ceiling kill count (the daemon counts
  // only Stalled/TimedOut/Failed): otherwise two daemon restarts mid-implement
  // would settle two attempts and falsely escalate a healthy phase to Needs
  // User (Fix: restart must not count as a genuine worker kill). The live sweep
  // — not the reconciler — is what counts a genuine worker failure.
  deps.store.transitionAttempt(
    attempt.id,
    "CanceledByReconciliation",
    "orphaned by daemon restart",
  );
  deps.store.deleteLease(attempt.issue_id);
  releaseVerifyDevLock(deps, attempt);
  deps.log.warn("reconcile: expired orphaned attempt — relaunch next decide", {
    issue: identifier,
    attemptId: attempt.id,
    phase: attempt.phase,
  });
  return {
    outcome: {
      issue: identifier,
      attemptId: attempt.id,
      kind: "expired-orphan",
      detail: "orphaned by daemon restart",
    },
    relaunch: true,
  };
}

/**
 * Reconcile ONE active attempt: probe liveness, and either leave a genuinely
 * live worker alone (reattach), freeze an unreachable host, or hand an orphan
 * to `reconcileOrphan`. A null-pid active attempt at reconcile time is ALWAYS
 * an orphan — unlike the sweep, a restart cancels the mid-launch grace.
 */
async function reconcileActiveAttempt(
  deps: ReconcileDeps,
  attempt: AttemptRow,
): Promise<{ outcome: ReconcileOutcome; relaunch: boolean }> {
  const identifier =
    deps.store.getIssue(attempt.issue_id)?.identifier ?? attempt.issue_id;
  const now = deps.now();

  // A null pid means the launch never got far enough to record a process. On a
  // fresh boot that is a crash-orphan by definition (no worker to reattach to).
  if (attempt.pid === null) {
    return reconcileOrphan(deps, attempt);
  }

  const silenceBudgetMs =
    deps.silenceBudgetMinutesFor(attempt.phase) * 60_000;
  const verdict = await evaluateLiveness({
    attempt,
    transport: deps.transport,
    now,
    silenceBudgetMs,
  });

  switch (verdict) {
    case "host-unreachable": {
      // Freeze the SLA clock; never expire over an unreachable host (AE4).
      renewLease({
        store: deps.store,
        issueId: attempt.issue_id,
        attempt,
        now,
        reachable: false,
        ttlMinutes: deps.leaseTtlMinutes,
      });
      return {
        outcome: {
          issue: identifier,
          attemptId: attempt.id,
          kind: "host-unreachable",
          detail: `phase ${attempt.phase}`,
        },
        relaunch: false,
      };
    }
    case "leased": {
      // The worker survived the daemon restart (detached process group). Renew
      // the lease and leave it running — reattachment, not relaunch.
      renewLease({
        store: deps.store,
        issueId: attempt.issue_id,
        attempt,
        now,
        reachable: true,
        ttlMinutes: deps.leaseTtlMinutes,
      });
      return {
        outcome: {
          issue: identifier,
          attemptId: attempt.id,
          kind: "reattached",
          detail: `phase ${attempt.phase}`,
        },
        relaunch: false,
      };
    }
    case "stalled": {
      // `evaluateLiveness` returns "stalled" ONLY when the host is reachable,
      // the pid is confirmed ALIVE, and the log has been silent past the
      // budget — i.e. a wedged-but-RUNNING worker. Settling + relaunching (or
      // adopting a merged PR and advancing) WITHOUT first killing it would
      // duplicate the worker / adopt-while-alive — the exact race this feature
      // prevents, and the worktree guard misses it because the survivor's
      // worktree_path is on the row we are about to settle. Mirror the sweep:
      // kill the process group BEFORE reconcileOrphan. (Fix: stalled-but-alive.)
      if (attempt.pid !== null) {
        try {
          await deps.transport.killPidGroup(attempt.pid);
        } catch (e) {
          deps.log.warn("reconcile stall kill failed — settling anyway", {
            issue: identifier,
            attemptId: attempt.id,
            pid: attempt.pid,
            error: String(e),
          });
        }
      }
      return reconcileOrphan(deps, attempt);
    }
    case "dead":
      // pid confirmed dead → orphan repair path (no live process to kill).
      return reconcileOrphan(deps, attempt);
  }
}

/**
 * Repair the Symphony `launch-recording-failed` case: the worker ran and left
 * durable evidence, but the daemon died before the ledger/issue-row write
 * landed (the executor flagged it in the attempt detail). Re-apply the ledger
 * write idempotently and clear the flag.
 */
async function repairLaunchRecording(
  deps: ReconcileDeps,
  attempt: AttemptRow,
): Promise<ReconcileOutcome> {
  const issueRow = deps.store.getIssue(attempt.issue_id);
  const identifier = issueRow?.identifier ?? attempt.issue_id;
  try {
    const comments = await deps.gateway.listComments(attempt.issue_id);
    const ledgerComment = findLedgerComment(identifier, comments);
    const parsed = parseLedgerComment(identifier, ledgerComment?.body);
    const next: Ledger = {
      ...parsed.ledger,
      phase: attempt.phase,
      worker: null,
      attempt: attempt.attempt_number,
      blocker: null,
      compounded:
        attempt.phase === "compound" ? true : parsed.ledger.compounded,
    };
    const rendered = renderLedgerComment(identifier, next, parsed.prose);
    if (ledgerComment !== null) {
      await deps.gateway.updateComment(ledgerComment.id, rendered);
    } else {
      await deps.gateway.createComment(attempt.issue_id, rendered);
    }
    deps.store.upsertIssue({
      issueId: attempt.issue_id,
      identifier,
      lane: issueRow?.lane ?? "unassigned",
      phase: attempt.phase,
      state: issueRow?.state ?? "",
      compounded: next.compounded ? 1 : 0,
    });
    // Clear the flag so the repair is not retried every reconcile (the state is
    // preserved — store.transitionAttempt only rewrites detail here).
    deps.store.transitionAttempt(
      attempt.id,
      attempt.state,
      "launch-recording repaired by reconciler",
    );
    deps.log.info("reconcile: repaired launch-recording-failed", {
      issue: identifier,
      attemptId: attempt.id,
      phase: attempt.phase,
    });
    return {
      issue: identifier,
      attemptId: attempt.id,
      kind: "recording-repaired",
      detail: `phase ${attempt.phase}`,
    };
  } catch (e) {
    deps.log.error("reconcile: launch-recording repair failed — will retry", {
      issue: identifier,
      attemptId: attempt.id,
      error: String(e),
    });
    return {
      issue: identifier,
      attemptId: attempt.id,
      kind: "skipped",
      detail: `recording repair failed: ${String(e)}`,
    };
  }
}

/** Attempts (any state) flagged launch-recording-failed by the executor. */
function flaggedRecordingAttempts(store: FactoryStore): AttemptRow[] {
  return store.db
    .prepare(
      "SELECT * FROM attempts WHERE detail LIKE ? ORDER BY id ASC",
    )
    .all(`${LAUNCH_RECORDING_FAILED_PREFIX}%`) as AttemptRow[];
}

/**
 * Run one reconciliation pass. Idempotent: a second pass over an
 * already-consistent store touches nothing. Isolated per attempt — one bad row
 * never aborts the pass (mirrors the sweep's isolation contract).
 */
export async function reconcile(deps: ReconcileDeps): Promise<ReconcileResult> {
  const outcomes: ReconcileOutcome[] = [];
  const relaunchQueued: string[] = [];

  // (d) Empty store → rebuild from Linear BEFORE anything else, so the repairs
  // below have issue rows to resolve identifiers against.
  let rebuiltIssues = 0;
  if (storeIsEmpty(deps.store)) {
    try {
      rebuiltIssues = await rebuildFromLinear(deps);
    } catch (e) {
      deps.log.error("reconcile: store rebuild failed", { error: String(e) });
    }
    // A just-rebuilt store has no attempts to reconcile — return early.
    return { rebuiltIssues, outcomes, relaunchQueued };
  }

  // (c) Symphony repair: re-apply Linear writes that never landed.
  for (const attempt of flaggedRecordingAttempts(deps.store)) {
    outcomes.push(await repairLaunchRecording(deps, attempt));
  }

  // (a)/(b) Orphaned-attempt + externally-merged-PR reconciliation.
  for (const attempt of deps.store.listActiveAttempts()) {
    try {
      const { outcome, relaunch } = await reconcileActiveAttempt(deps, attempt);
      outcomes.push(outcome);
      if (relaunch) relaunchQueued.push(outcome.issue);
    } catch (e) {
      const identifier =
        deps.store.getIssue(attempt.issue_id)?.identifier ?? attempt.issue_id;
      deps.log.error("reconcile: attempt reconciliation failed — skipped", {
        issue: identifier,
        attemptId: attempt.id,
        error: String(e),
      });
      outcomes.push({
        issue: identifier,
        attemptId: attempt.id,
        kind: "skipped",
        detail: String(e),
      });
    }
  }

  // Clear a leaked dev-deployment lock (Fix: dev-lock leak on hard crash). The
  // executor releases the lock in an in-process `finally`, so a SIGKILL/panic
  // mid-verify leaves the `locks` row set forever — and there is no TTL. Run
  // this AFTER the attempt loop so any holder whose orphaned attempt was just
  // settled now reads as having no active attempt and is released; a holder
  // whose verify worker was reattached keeps its lock.
  try {
    const released = releaseOrphanedDevLock(deps.store);
    if (released !== null) {
      deps.log.warn(
        "reconcile: released orphaned dev-deployment lock (holder had no active attempt)",
        { holder: released },
      );
    }
  } catch (e) {
    deps.log.error("reconcile: orphaned dev-lock release failed — continuing", {
      error: String(e),
    });
  }

  deps.log.info("reconcile pass complete", {
    rebuiltIssues,
    outcomes: outcomes.length,
    relaunchQueued: relaunchQueued.length,
  });
  return { rebuiltIssues, outcomes, relaunchQueued };
}
