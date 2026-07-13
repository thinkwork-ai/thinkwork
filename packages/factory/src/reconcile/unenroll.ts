/**
 * Un-enrollment pass (enrollment-lifecycle refinement).
 *
 * An issue is ENROLLED only while it is real, active work; it must be
 * UN-ENROLLED the moment it leaves. Two directives:
 *
 *   1. Abandoned — an enrolled issue moved back below the enrollment floor
 *      (Backlog / Todo / Canceled), or which lost its lane label, drops out of
 *      the poller's candidate set silently (Backlog and Todo ∉ ACTIVE_STATES —
 *      the floor is Brainstorming). The poller just stops seeing it, but the
 *      Slack thread, lease, attempt, and worker linger. This pass detects the
 *      drop-out and winds everything down: closing note, cancel the active
 *      attempt (CanceledByReconciliation), kill the worker process group, and
 *      delete the lease / nag timers / locks / thread row.
 *
 *   2. Completed — an enrolled issue whose current state is Done (terminal:
 *      auto-compound is disabled, so nothing is ever left to automate) gets a
 *      closing SUMMARY and its store rows cleaned, WITHOUT killing anything
 *      (the work is finished). This closes finished issues' threads instead of
 *      leaving them open forever. Done is NOT in the poller's enrollment
 *      filter, so a finished issue normally arrives here as a candidate-set
 *      MISS and is classified from the batched verification fetch.
 *
 * Cost: the pass only fetches CURRENT state+labels for enrolled ids MISSING
 * from this tick's candidate set (usually zero) — ONE batched
 * getIssuesByIdentifier call. An enrolled id that is still a valid candidate is
 * NEVER un-enrolled (transient-poll-miss guard). It runs each tick, isolated so
 * a failure never crashes the tick, and is SKIPPED under a scoped
 * (`onlyIssues`) run where "not in the candidate set" no longer means "left the
 * queue".
 */

import { recordDoneToday } from "../slack/board.js";
import type { LinearGateway, LinearIssueSnapshot } from "../linear/client.js";
import type { Logger } from "../logger.js";
import { matchesFilter } from "../linear/poller.js";
import type { PollCandidate } from "../linear/poller.js";
import type { SlackSync } from "../slack/sync.js";
import type { FactoryStore } from "../store/db.js";
import type { HostTransport } from "../workers/transport.js";

/** Both lane labels present → a lane conflict, still active work (never un-enroll). */
const LANE_LABELS = ["Claude", "Codex"] as const;

/** One-line note posted to an abandoned issue's thread before winding it down. */
export const ABANDONED_NOTE =
  "Un-enrolled — moved out of the active work queue (Backlog/Todo/Canceled/lane " +
  "removed); automation stopped. Re-add a lane label + move to Brainstorming to resume.";

export type UnenrollVerdict = "abandoned" | "completed" | "gone";

export interface UnenrollOutcome {
  issue: string;
  verdict: UnenrollVerdict;
}

export interface UnenrollResult {
  outcomes: UnenrollOutcome[];
}

export interface UnenrollDeps {
  store: FactoryStore;
  gateway: LinearGateway;
  transport: HostTransport;
  log: Logger;
  /** Slack surface (optional): closing posts. Absent → store cleanup only. */
  slack?: SlackSync;
}

/**
 * A Done issue is finished — auto-compound is disabled, so there is never
 * anything left to automate. Close its thread and clean its rows. (Done is no
 * longer enrolled by the poller, so the in-candidate path only fires under a
 * scoped run or a stale filter; the normal path is the miss classification.)
 */
function isCompleted(candidate: PollCandidate): boolean {
  return candidate.issue.state === "Done";
}

/** True when a lane conflict (both labels) — still active work needing a human. */
function hasLaneConflict(snapshot: LinearIssueSnapshot): boolean {
  return LANE_LABELS.every((l) => snapshot.labels.includes(l));
}

/**
 * A fetched snapshot is STILL a valid candidate when it matches the poller's
 * enrollment filter (or is a lane conflict — a both-lane issue is active work
 * the operator must resolve, never a drop-out). Used to spare a transient poll
 * miss from un-enrollment.
 */
function stillValidCandidate(snapshot: LinearIssueSnapshot): boolean {
  return matchesFilter(snapshot) || hasLaneConflict(snapshot);
}

/**
 * Wind down one issue's enrollment. `abandoned`/`gone` cancel + kill any live
 * worker; `completed` leaves the (finished) work untouched. Every step is
 * best-effort so a single failure never leaves the issue half-enrolled.
 */
async function windDown(
  deps: UnenrollDeps,
  issueId: string,
  identifier: string,
  verdict: UnenrollVerdict,
): Promise<void> {
  const { store, transport, log, slack } = deps;

  // 1) Closing post (best-effort; isolated so it never blocks store cleanup).
  if (slack !== undefined) {
    const text =
      verdict === "completed"
        ? `:checkered_flag: *${identifier}* is Done — nothing left to automate. ` +
          "Un-enrolling and closing this thread."
        : ABANDONED_NOTE;
    try {
      await slack.closeThread(issueId, text);
    } catch (e) {
      log.warn("un-enroll: closing thread post failed — continuing cleanup", {
        issue: identifier,
        error: String(e),
      });
    }
  }

  // 2) Wind down a running worker (abandoned/gone only; completed is finished).
  if (verdict !== "completed") {
    const active = store
      .listActiveAttempts()
      .find((a) => a.issue_id === issueId);
    if (active !== undefined) {
      if (active.pid !== null) {
        // Best-effort kill. The operator deprioritized this issue, so killing a
        // running worker is acceptable — killPidGroup is a no-op when the group
        // is already gone.
        try {
          const alive = await transport.pidAlive(active.pid);
          if (alive) await transport.killPidGroup(active.pid);
        } catch (e) {
          log.warn("un-enroll: worker kill failed — settling attempt anyway", {
            issue: identifier,
            pid: active.pid,
            error: String(e),
          });
        }
      }
      try {
        store.transitionAttempt(
          active.id,
          "CanceledByReconciliation",
          `un-enrolled (${verdict}): issue left the active work queue`,
        );
      } catch (e) {
        log.warn("un-enroll: attempt transition failed — continuing cleanup", {
          issue: identifier,
          error: String(e),
        });
      }
    }
  }

  // 3) Release every store row so the issue is FULLY un-enrolled.
  store.deleteLease(issueId);
  store.deleteNagTimersForIssue(issueId);
  store.releaseLocksHeldBy(issueId);
  store.deleteSlackThread(issueId);

  if (verdict === "completed") {
    // Board memory (U9): Done issues leave the poll set, so the pinned
    // board's done-today group is fed from here, persisted in meta.
    try {
      recordDoneToday(store, identifier);
    } catch (e) {
      log.warn("un-enroll: done-today record failed — board only", {
        issue: identifier,
        error: String(e),
      });
    }
  }

  log.info("un-enrolled issue", { issue: identifier, verdict });
}

/**
 * Run the un-enrollment pass for one tick. `candidates` is THIS tick's poller
 * result (post lane-conflict filter). Cheap: fetches state only for enrolled
 * ids absent from the candidate set (one batched call).
 */
export async function runUnenrollPass(
  deps: UnenrollDeps,
  candidates: readonly PollCandidate[],
): Promise<UnenrollResult> {
  const { store, gateway, log } = deps;

  const candidateById = new Map<string, PollCandidate>();
  for (const c of candidates) candidateById.set(c.issue.id, c);

  // Enrolled = issues the daemon holds a thread for ∪ issues with an active
  // (non-terminal) attempt ∪ issues holding a lease. identifier resolved from
  // the thread row, else the issues table.
  const enrolled = new Map<string, { identifier: string | null }>();
  for (const t of store.listSlackThreads()) {
    enrolled.set(t.issue_id, { identifier: t.identifier });
  }
  for (const a of store.listActiveAttempts()) {
    if (!enrolled.has(a.issue_id)) enrolled.set(a.issue_id, { identifier: null });
  }
  for (const l of store.listLeases()) {
    if (!enrolled.has(l.issue_id)) enrolled.set(l.issue_id, { identifier: null });
  }
  for (const [id, meta] of enrolled) {
    if (meta.identifier === null) {
      meta.identifier = store.getIssue(id)?.identifier ?? null;
    }
  }

  const outcomes: UnenrollOutcome[] = [];

  // Enrolled ids MISSING from the candidate set → need a current-state fetch.
  const missIds: string[] = [];
  const missIdentifiers: string[] = [];

  for (const [id, meta] of enrolled) {
    const candidate = candidateById.get(id);
    if (candidate !== undefined) {
      // Still a candidate this tick. The only un-enroll here is terminal
      // completion (a Done+compounded issue is still returned by the poller).
      if (isCompleted(candidate)) {
        await windDown(deps, id, candidate.issue.identifier, "completed");
        outcomes.push({ issue: candidate.issue.identifier, verdict: "completed" });
      }
      continue;
    }
    // Not a candidate this tick, and no identifier to verify it against Linear
    // (an orphaned attempt/lease with no thread or issues row). We must NOT
    // kill/clean on an unverifiable entry — the U7 reconciler owns orphaned
    // store state. Defer.
    if (meta.identifier === null) {
      deps.log.info(
        "un-enroll: enrolled entry has no identifier to verify — deferring to the reconciler",
        { issueId: id },
      );
      continue;
    }
    missIds.push(id);
    missIdentifiers.push(meta.identifier);
  }

  if (missIdentifiers.length > 0) {
    let fetched: LinearIssueSnapshot[];
    try {
      fetched = await gateway.getIssuesByIdentifier(missIdentifiers);
    } catch (e) {
      // A fetch failure must not un-enroll anyone (fail-safe): skip the misses
      // this tick and retry next tick.
      log.warn(
        "un-enroll: getIssuesByIdentifier failed — deferring miss classification",
        { error: String(e) },
      );
      return { outcomes };
    }
    const byIdentifier = new Map(fetched.map((s) => [s.identifier, s]));
    for (let i = 0; i < missIds.length; i++) {
      const id = missIds[i];
      const identifier = missIdentifiers[i];
      const snapshot = byIdentifier.get(identifier);
      if (snapshot === undefined) {
        // Requested but NOT returned. This is indistinguishable from a transient
        // per-issue fetch failure (throttle/429/network — getIssuesByIdentifier
        // silently omits an issue it could not fetch), so we must NOT treat it
        // as deleted and kill the worker. Only a POSITIVELY-confirmed
        // out-of-queue state un-enrolls; an unverifiable absence defers.
        deps.log.info(
          "un-enroll: enrolled issue not returned by the verification fetch — deferring (unverifiable, never kill on absence)",
          { issue: identifier },
        );
        continue;
      }
      if (stillValidCandidate(snapshot)) {
        // Transient poll miss — the issue is still valid work. Never un-enroll.
        continue;
      }
      if (snapshot.state === "Done") {
        // Finished work (Done is terminal and not enrolled): completed
        // wind-down — closing summary, kill nothing.
        await windDown(deps, id, identifier, "completed");
        outcomes.push({ issue: identifier, verdict: "completed" });
        continue;
      }
      // Backlog / Canceled / lane label removed → abandoned.
      await windDown(deps, id, identifier, "abandoned");
      outcomes.push({ issue: identifier, verdict: "abandoned" });
    }
  }

  return { outcomes };
}
