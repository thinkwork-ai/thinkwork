/**
 * The no-orphan sweep (U6, R22 / KTD-8). Runs every poll tick BEFORE the
 * per-candidate decide/execute pass and reconciles observed reality into the
 * store so that, by construction, every enrolled issue is in exactly ONE owned,
 * deadlined state:
 *
 *   - leased            — a live worker with a fresh heartbeat (lease renewed).
 *   - host-unreachable  — probe failing; SLA clock frozen, no expiry (R11).
 *   - quota-cooldown    — a QuotaCooldown attempt inside its window (R14/AE8).
 *   - quota-expired     — cooldown window exceeded; decide() will escalate.
 *   - human-wait        — question / review-gate-without-LFG; nag timer armed.
 *   - blocked-escalated — a non-question blocker; escalation already sent.
 *   - dispatchable      — no worker yet but routable; owned by the dispatch loop.
 *   - recovered-stalled — silence past budget: killed, tail recorded, settled.
 *   - recovered-dead    — pid confirmed dead: lease expired, attempt settled.
 *   - alert             — UNCLASSIFIABLE (e.g. a corrupted store row): R22 says
 *                         raise an operator alert, never silently skip.
 *
 * Stalled/dead recovery settles the attempt to a terminal state (releasing the
 * issue+phase slot) but does NOT itself relaunch — the very next decide() pass
 * sees no active attempt and launches a fresh attempt from the Progress doc +
 * newest baton (R15), subject to the attempt ceiling. Duplicate-worker guard
 * (AE4): a lease expires only when the host is reachable AND the old pid is
 * confirmed dead; an unreachable host freezes rather than relaunches.
 */

import type { Logger } from "../logger.js";
import type { PollCandidate } from "../linear/poller.js";
import { ATTEMPT_TRANSITIONS } from "../workers/attempts.js";
import type { AttemptRow, FactoryStore } from "../store/db.js";
import type { HostTransport } from "../workers/transport.js";
import { evaluateLiveness, renewLease, type LivenessVerdict } from "./leases.js";
import { classifyQuota, DEFAULT_QUOTA_COOLDOWN_MINUTES } from "./quota.js";
import { armNag, disarmNag, sweepNags, type FiredNag } from "./nags.js";

/** Lines of the worker log tail preserved to the ledger on a stall. */
const STALL_TAIL_LINES = 40;

/** Human-wait / blocker classification for a candidate with no active worker. */
const REVIEW_GATE_STATES = new Set([
  "Requirements Review",
  "Plan Review",
  "Verification",
  "Review",
]);

export type SweepStateKind =
  | "leased"
  | "host-unreachable"
  | "quota-cooldown"
  | "quota-expired"
  | "human-wait"
  | "blocked-escalated"
  | "dispatchable"
  | "recovered-stalled"
  | "recovered-dead"
  | "alert";

export interface IssueClassification {
  issue: string;
  kind: SweepStateKind;
  detail?: string;
}

export interface SweepDeps {
  store: FactoryStore;
  transport: HostTransport;
  /** Injected clock — every timer/SLA computation flows through this (tests fake it). */
  now: () => Date;
  /** Per-phase silence budget (ms is derived here from minutes). */
  silenceBudgetMinutesFor: (phase: string) => number;
  quotaCooldownMinutes?: number;
  leaseTtlMinutes?: number;
  log: Logger;
  /**
   * Nag delivery seam (wired to the Slack surface's postNag by the daemon).
   * Absent → due nags are enqueued to the store outbox for U8 to flush.
   */
  deliverNag?: (nag: FiredNag) => Promise<void>;
}

export interface SweepResult {
  classifications: IssueClassification[];
  /** Unclassifiable issues (R22 operator alerts). */
  alerts: IssueClassification[];
  /** Issues whose dead/stalled attempt was settled this sweep (relaunch next decide). */
  recoveries: IssueClassification[];
  firedNags: FiredNag[];
}

function isRecognizedAttemptState(state: string): boolean {
  return state in ATTEMPT_TRANSITIONS;
}

/**
 * Classify + reconcile one candidate that HAS an active attempt: evaluate
 * host-aware liveness and take the owned action (renew / freeze / kill+settle /
 * settle). Returns the classification.
 */
async function classifyActiveAttempt(
  candidate: PollCandidate,
  attempt: AttemptRow,
  deps: SweepDeps,
): Promise<IssueClassification> {
  const id = candidate.issue.identifier;
  const issueId = candidate.issue.id;

  // R22: a store row in a state the attempt machine does not recognize is
  // corrupted — alert, never skip (and never act on it as if live).
  if (!isRecognizedAttemptState(attempt.state)) {
    return {
      issue: id,
      kind: "alert",
      detail: `attempt ${attempt.id} is in unrecognized state "${attempt.state}"`,
    };
  }

  const now = deps.now();
  const silenceBudgetMs =
    deps.silenceBudgetMinutesFor(attempt.phase) * 60_000;
  const verdict: LivenessVerdict = await evaluateLiveness({
    attempt,
    transport: deps.transport,
    now,
    silenceBudgetMs,
  });

  switch (verdict) {
    case "host-unreachable": {
      // Freeze the SLA clock (R11): renew heartbeat but accumulate no time; the
      // lease is NOT expired — the worker may still be alive on the asleep host.
      renewLease({
        store: deps.store,
        issueId,
        attempt,
        now,
        reachable: false,
        ttlMinutes: deps.leaseTtlMinutes,
      });
      return { issue: id, kind: "host-unreachable", detail: `phase ${attempt.phase}` };
    }
    case "leased": {
      const sla = renewLease({
        store: deps.store,
        issueId,
        attempt,
        now,
        reachable: true,
        ttlMinutes: deps.leaseTtlMinutes,
      });
      return { issue: id, kind: "leased", detail: `sla ${Math.round(sla / 1000)}s` };
    }
    case "stalled": {
      // Silence past budget while alive (R14/AE5 first half): kill the process
      // group, record the log tail, settle Running→Stalled, drop the lease. The
      // next decide() relaunches a fresh attempt from the baton (R15).
      let tail = "";
      if (attempt.pid !== null) {
        try {
          await deps.transport.killPidGroup(attempt.pid);
        } catch (e) {
          deps.log.warn("stall kill failed — settling Stalled anyway", {
            issue: id,
            pid: attempt.pid,
            error: String(e),
          });
        }
      }
      if (attempt.log_path !== null) {
        try {
          tail = await deps.transport.readTail(attempt.log_path, STALL_TAIL_LINES);
        } catch {
          tail = "";
        }
      }
      const detail =
        `stalled: log silent past ${attempt.phase} budget` +
        (tail !== "" ? `\n--- log tail ---\n${tail}` : "");
      deps.store.transitionAttempt(attempt.id, "Stalled", detail.slice(0, 1000));
      deps.store.deleteLease(issueId);
      deps.log.warn("worker stalled — killed and settled; relaunch next decide", {
        issue: id,
        attemptId: attempt.id,
        phase: attempt.phase,
      });
      return { issue: id, kind: "recovered-stalled", detail: `attempt ${attempt.id}` };
    }
    case "dead": {
      // Host reachable + pid dead (AE4 guard satisfied): the lease has expired.
      // Settle the orphaned attempt and drop the lease; decide() relaunches.
      deps.store.transitionAttempt(
        attempt.id,
        "Failed",
        `lease expired: worker pid ${attempt.pid ?? "?"} confirmed dead`,
      );
      deps.store.deleteLease(issueId);
      deps.log.warn("lease expired (pid dead) — settled; relaunch next decide", {
        issue: id,
        attemptId: attempt.id,
        phase: attempt.phase,
      });
      return { issue: id, kind: "recovered-dead", detail: `attempt ${attempt.id}` };
    }
  }
}

/**
 * Classify a candidate with NO active attempt: quota cooldown, human-wait
 * (nag armed), a non-question blocker (escalation already sent), or a plain
 * dispatchable issue owned by the imminent launch. Arms/disarms nag timers so
 * the wait is supervised (R23).
 */
function classifyIdle(
  candidate: PollCandidate,
  deps: SweepDeps,
): IssueClassification {
  const id = candidate.issue.identifier;
  const issueId = candidate.issue.id;
  const now = deps.now();

  // Quota cooldown takes precedence — a throttled provider must not be retried.
  const quota = classifyQuota(
    deps.store,
    issueId,
    now,
    deps.quotaCooldownMinutes ?? DEFAULT_QUOTA_COOLDOWN_MINUTES,
  );
  if (quota.kind === "cooldown") {
    return {
      issue: id,
      kind: "quota-cooldown",
      detail: `until ${quota.until.toISOString()}`,
    };
  }
  if (quota.kind === "expired") {
    return { issue: id, kind: "quota-expired" };
  }

  const hasNeedsUser = candidate.blockerLabels.includes("Needs User");
  const otherBlockers = candidate.blockerLabels.filter(
    (l) => l !== "Needs User",
  );

  // A `Needs User` question is a supervised human-wait: arm the question nag.
  if (hasNeedsUser) {
    armNag({ store: deps.store, issueId, kind: "question", now });
    return { issue: id, kind: "human-wait", detail: "question" };
  }
  // Non-question blockers were escalated by the block executor already.
  if (otherBlockers.length > 0) {
    disarmNag(deps.store, issueId, "question");
    return {
      issue: id,
      kind: "blocked-escalated",
      detail: otherBlockers[0],
    };
  }

  // Review gate without LFG is a supervised human-wait: arm the review nag.
  if (REVIEW_GATE_STATES.has(candidate.issue.state) && !candidate.hasLfg) {
    armNag({ store: deps.store, issueId, kind: "review-gate", now });
    return { issue: id, kind: "human-wait", detail: "review-gate" };
  }

  // Otherwise the issue is routable and owned by the dispatch loop — the wait
  // (if any) has resolved, so disarm both nag kinds.
  disarmNag(deps.store, issueId, "question");
  disarmNag(deps.store, issueId, "review-gate");
  return { issue: id, kind: "dispatchable" };
}

/**
 * Sweep every enrolled candidate. Reconciles liveness/leases/quota/nags into
 * the store and returns the per-issue classification. A single candidate's
 * failure is isolated (logged as an alert) so one bad row never aborts the
 * sweep — the daemon additionally wraps the whole sweep (like the Slack sync).
 */
export async function runSweep(
  candidates: readonly PollCandidate[],
  deps: SweepDeps,
): Promise<SweepResult> {
  const classifications: IssueClassification[] = [];

  // Read every active attempt ONCE and index by issue (first/lowest-id wins, to
  // match the previous `.find()` semantics), instead of re-querying inside the
  // per-candidate loop — that was O(candidates × attempts) under Linear-scale
  // boards. listActiveAttempts() is ORDER BY id ASC, so the first insert wins.
  const activeByIssue = new Map<string, AttemptRow>();
  for (const a of deps.store.listActiveAttempts()) {
    if (!activeByIssue.has(a.issue_id)) activeByIssue.set(a.issue_id, a);
  }

  for (const candidate of candidates) {
    const issueId = candidate.issue.id;
    try {
      const active = activeByIssue.get(issueId);
      const classification =
        active !== undefined
          ? await classifyActiveAttempt(candidate, active, deps)
          : classifyIdle(candidate, deps);
      classifications.push(classification);
    } catch (e) {
      classifications.push({
        issue: candidate.issue.identifier,
        kind: "alert",
        detail: `sweep error: ${String(e)}`,
      });
    }
  }

  const alerts = classifications.filter((c) => c.kind === "alert");
  for (const a of alerts) {
    deps.log.error("no-orphan sweep: unclassifiable issue — operator alert (R22)", {
      issue: a.issue,
      detail: a.detail,
    });
  }
  const recoveries = classifications.filter(
    (c) => c.kind === "recovered-stalled" || c.kind === "recovered-dead",
  );

  // Fire any due nag timers (delivery delegated to Slack or the store outbox).
  let firedNags: FiredNag[] = [];
  try {
    firedNags = await sweepNags({
      store: deps.store,
      now: deps.now(),
      deliver: deps.deliverNag,
    });
  } catch (e) {
    deps.log.warn("nag sweep failed — continuing", { error: String(e) });
  }

  return { classifications, alerts, recoveries, firedNags };
}
