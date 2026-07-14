/**
 * Phase engine (U5, R7/R2): the routing contract's status table as code.
 *
 * `decideAction(candidate, storeView)` maps every routing-contract status ×
 * (lane label, LFG, blockers, ledger state, active-attempt state) to exactly
 * ONE typed action. The engine only DECIDES — callers execute (launch the
 * worker, move the status, apply the label). Because decisions are pure over
 * a fresh snapshot each tick, mid-run label changes apply at the NEXT
 * decision (KTD-10): a running attempt is never killed by a label edit; the
 * engine just returns `wait` while it runs and re-reads labels afterwards.
 *
 * Source of truth:
 * .agents/skills/thinkwork-linear-dispatcher/references/routing-contract.md
 */

import type { LaneLabel } from "../domain/statuses.js";
import { ROUTING_STATUSES } from "../domain/statuses.js";
import {
  isTrustedComment,
  type CommentTrust,
  type LinearCommentSnapshot,
  type LinearIssueSnapshot,
} from "../linear/client.js";
import type { Ledger } from "../linear/ledger.js";
import { isMarkerComment } from "../linear/markers.js";
import { TERMINAL_ATTEMPT_STATES } from "../store/db.js";

/** Factory pipeline phases a launch action can name. */
export type Phase =
  | "brainstorm"
  | "plan"
  | "debug"
  | "implement"
  | "verify"
  | "compound";

/**
 * Every status the routing contract's table routes — canonical list lives in
 * src/domain/statuses.ts, derived as ACTIVE_STATES ∪ VERIFICATION_STATES so
 * the engine's table can never drift from the poller's enrollment filter.
 * Re-exported for the exhaustive table test.
 */
export { ROUTING_STATUSES };

/**
 * Handoff-baton statuses per phase: which `handoff:<ID>:<STATUS>` comment a
 * phase's worker READS at launch, and which it POSTS on completion (the
 * contract keys batons by the NEXT phase's status name). `posts: null` for
 * compound (pipeline end); debug posts vary by exit routing.
 */
export const PHASE_HANDOFF: Record<
  Phase,
  { reads: string; posts: string | null }
> = {
  brainstorm: { reads: "Brainstorming", posts: "Planning" },
  plan: { reads: "Planning", posts: "Ready to Work" },
  debug: { reads: "Debug", posts: null },
  implement: { reads: "Ready to Work", posts: "Verification" },
  verify: { reads: "Verification", posts: "Done" },
  compound: { reads: "Done", posts: null },
};

/** Which provider runner executes a launched phase. */
export type RunnerKind = "claude" | "codex";

/**
 * Host requirement for a launch. `browser-auth` marks phases that need a
 * real browser + operator auth against deployed dev (Verification — always
 * the Claude lane, regardless of lane label).
 */
export type HostRequirement = "any" | "browser-auth";

export interface LaunchPromptInputs {
  issueIdentifier: string;
  title: string;
  /** Status name of the baton this phase reads (`handoff:<ID>:<this>`). */
  handoffStatus: string;
}

export type EngineAction =
  | {
      kind: "launch";
      phase: Phase;
      runner: RunnerKind;
      hostRequirement: HostRequirement;
      /** True for a Ready to Work repair pass (`Verification Failed`). */
      repair: boolean;
      promptInputs: LaunchPromptInputs;
      /**
       * This launch is proceeding only because an operator override cleared a
       * ceiling/quota escalation. The executor must consume (supersede) the
       * `factory-block:` marker so the override is ONE-SHOT: if this attempt
       * also fails, the next tick re-escalates instead of relaunching forever.
       */
      consumesEscalationOverride?: boolean;
    }
  | { kind: "advance"; toStatus: string; evidence: string }
  /** Review gates without LFG etc. — zero-SLA waiting; nags arrive in U6/U8. */
  | { kind: "wait"; reason: string }
  | { kind: "block"; label: string; reason: string }
  | { kind: "noop"; reason: string };

/**
 * The slice of PollCandidate the engine needs — PollCandidate satisfies this
 * structurally, so `decideAction(candidate, view)` composes directly with
 * `pollTick` output.
 */
export interface EngineCandidate {
  issue: Pick<LinearIssueSnapshot, "identifier" | "title" | "state" | "labels">;
  lane: LaneLabel | null;
  hasLfg: boolean;
  isVerification: boolean;
  blockerLabels: string[];
  /**
   * Parsed rolling ledger. `synthesized` is true when no factory-authored
   * block existed and defaults were invented (absent, legacy-prose, or
   * malformed) — it distinguishes an issue the factory actually drove from one
   * it has never touched. Load-bearing for the compound cutoff below.
   */
  ledger: { ledger: Ledger; synthesized: boolean };
  /**
   * The issue's comments — used to detect an operator override of a
   * ceiling/quota escalation (a `factory-block:` marker present while the
   * `Needs User` label has been removed). PollCandidate satisfies this
   * structurally, so the daemon's `decideAction(candidate, view)` supplies it
   * for free. Optional so engine-only callers/tests need not populate it.
   */
  comments?: LinearCommentSnapshot[];
  /**
   * Baton/marker author allowlist. When present, the override marker must come
   * from a trusted author (mirrors the preflight-override trust check); when
   * absent the check is fail-open, exactly as `hasPreflightOverride` is.
   */
  trust?: CommentTrust;
}

/**
 * What the daemon knows locally about this issue. The duplicate-worker guard
 * (routing contract) forbids inferring "no active worker" from Linear
 * comments alone — callers populate this from the store, live pids, and
 * `git worktree list`.
 */
export interface StoreView {
  /** Active (non-terminal) attempt from the KTD-4 store, if any. */
  activeAttempt: { phase: string; state: string } | null;
  /** Child issues exist on the Linear issue (children drive; parent waits). */
  hasChildIssues: boolean;
  /**
   * Workflow-state names of the child issues (present when hasChildIssues).
   * All Done/Canceled/Duplicate -> the parent proceeds normally; anything in
   * flight -> the parent WAITS quietly. null/absent = states unknown (fetch
   * failed) -> treat as in-flight (fail-safe wait, never a false resume).
   */
  childStates?: string[] | null;
  /**
   * Cross-issue dependency from the ledger blocker `waiting-on: THINK-x`
   * (resolved live by buildStoreView). `done` -> the engine proceeds (the
   * relaunched worker clears the blocker); otherwise it WAITS quietly. LFG
   * doctrine: a dependency wait is never a Needs User escalation.
   */
  dependency?: { identifier: string; state: string; done: boolean } | null;
  /**
   * Worker evidence found OUTSIDE the store (stray pids, worktrees, recorded
   * Codex thread ids). Non-empty → never launch; wait for reconciliation.
   */
  externalWorkerSignals?: string[];
  /**
   * Quota-cooldown signal (U6, R14/AE8) from the newest terminal attempt. When
   * the latest attempt is `QuotaCooldown`, `cooldown` (still inside the window)
   * makes decide() wait; `expired` (window exceeded) makes it escalate rather
   * than hammer a throttling provider with an immediate relaunch.
   */
  quota?: { kind: "cooldown" | "expired"; until?: string } | null;
  /**
   * Trailing consecutive kill/stall count per phase (U6, R15/AE5) from
   * MAX(attempt_number) downward. A phase at or above ATTEMPT_CEILING has its
   * next launch converted to an escalation instead of an Nth attempt.
   */
  consecutiveKillsByPhase?: Record<string, number>;
  /**
   * The single dev-deployment mutex (KTD-11) is currently held by ANOTHER
   * issue. Verification (which drives the shared dev stack) waits visibly
   * rather than racing; other phases ignore this.
   */
  devLockHeldByOther?: boolean;
}

const VERIFICATION_FAILED_LABEL = "Verification Failed";

const NEEDS_USER_LABEL = "Needs User";

/** Block-marker comment prefix (`factory-block:<ISSUE_ID>`), posted by the
 * executor whenever it applies a block — including a ceiling/quota escalation.
 * Defined here (not in executor.ts) so both the escalation-override check below
 * and the executor can share ONE source without a circular import. */
export const BLOCK_MARKER_PREFIX = "factory-block:";

export function blockMarker(issueIdentifier: string): string {
  return `${BLOCK_MARKER_PREFIX}${issueIdentifier}`;
}

/**
 * Attempt ceiling (R15/AE5): the SECOND consecutive kill/stall on the same
 * phase escalates instead of launching a third attempt.
 */
export const ATTEMPT_CEILING = 2;

/**
 * The SINGLE status→launch-phase table. `phaseForStatus` and the routing
 * switch's launch rows both read from it, so the two can never drift (a launch
 * that names a different phase than `phaseForStatus` reports would mis-key the
 * attempt-ceiling count). Statuses absent from the table never launch a worker
 * (advance/wait/noop rows).
 */
const STATUS_LAUNCH_PHASE: Readonly<Record<string, Phase>> = {
  Brainstorming: "brainstorm",
  Planning: "plan",
  Debug: "debug",
  "Ready to Work": "implement",
  "Ready To Work": "implement",
  "In Progress": "implement",
  Verification: "verify",
  Review: "verify",
  // No `Done` entry: auto-compound is disabled — Done is terminal and never
  // launches a worker (the `compound` phase remains for a manual ce-compound).
};

/**
 * The pipeline phase a launch would use for a given workflow status, or null
 * for statuses that never launch a worker (advance/wait/noop rows). Used by the
 * daemon to look up the relevant attempt-ceiling count for a candidate.
 */
export function phaseForStatus(state: string): Phase | null {
  return STATUS_LAUNCH_PHASE[state] ?? null;
}

/** The launch phase for a status the routing switch has already proven routes
 * a worker. Throws on drift (a launch row for a status absent from the table). */
function requireLaunchPhase(state: string): Phase {
  const phase = phaseForStatus(state);
  if (phase === null) {
    throw new Error(
      `routing-table drift: status "${state}" launches a worker but has no ` +
        "STATUS_LAUNCH_PHASE entry",
    );
  }
  return phase;
}

/**
 * Operator override of a ceiling/quota escalation (Fix: escalation wedge).
 * Mirrors `hasPreflightOverride`: a ceiling/quota escalation applies the
 * `Needs User` label + a `factory-block:` marker comment, but the derived
 * escalation (immutable attempt rows / an expired quota) never clears on its
 * own — so removing the label would re-block instantly on the next tick. When
 * the marker is present AND the `Needs User` label has been removed, an
 * operator deliberately cleared the block: route normally (a fresh attempt may
 * launch). When trust info is present the marker must be trusted-authored.
 */
function hasEscalationOverride(candidate: EngineCandidate): boolean {
  if (candidate.issue.labels.includes(NEEDS_USER_LABEL)) return false;
  const comments = candidate.comments ?? [];
  const marker = blockMarker(candidate.issue.identifier);
  return comments.some(
    (c) =>
      isMarkerComment(c.body, marker) &&
      (candidate.trust === undefined || isTrustedComment(c, candidate.trust)),
  );
}

function isTerminalAttemptState(state: string): boolean {
  return (TERMINAL_ATTEMPT_STATES as readonly string[]).includes(state);
}

function launch(
  candidate: EngineCandidate,
  phase: Phase,
  opts: { repair?: boolean } = {},
): EngineAction {
  // Verification is ALWAYS the Codex runner (operator decision 2026-07-13:
  // Codex is stronger at computer use, and verification drives a real
  // browser against deployed dev), regardless of the lane label. The exit
  // contract is unchanged: pass → Done, fail → Ready to Work +
  // `Verification Failed`. Every other phase follows the lane label.
  const runner: RunnerKind =
    phase === "verify" ? "codex" : candidate.lane === "Codex" ? "codex" : "claude";
  return {
    kind: "launch",
    phase,
    runner,
    hostRequirement: phase === "verify" ? "browser-auth" : "any",
    repair: opts.repair ?? false,
    promptInputs: {
      issueIdentifier: candidate.issue.identifier,
      title: candidate.issue.title,
      handoffStatus: PHASE_HANDOFF[phase].reads,
    },
  };
}

/**
 * Decide exactly one action for one candidate. Pure: no I/O, no clock. The
 * caller executes the action (idempotently — a `block` whose label already
 * exists writes nothing).
 *
 * Precedence: lane conflict → blocker labels → child issues (KTD-12) →
 * active attempt (KTD-10 wait) → duplicate-worker guard → status table.
 */
export function decideAction(
  candidate: EngineCandidate,
  view: StoreView,
): EngineAction {
  const { issue, lane, hasLfg, isVerification } = candidate;
  const id = issue.identifier;

  // A Done issue is TERMINAL: route it straight to the Done handling (compound
  // or noop) via the status table below. The block gates that follow — lane
  // conflict, blocker labels, child issues — are about IN-FLIGHT work; a stale
  // months-old label on a finished issue must NOT produce a `block`. It would
  // open a Slack thread + escalate, then the un-enroll pass closes it as
  // completed, and the next tick repeats — a thread-open/@mention/close loop
  // every poll. The active-attempt / duplicate-worker guards still apply.
  const isDone = issue.state === "Done";

  // Lane conflict: both lane labels → never route (routing contract rule 1).
  if (!isDone && issue.labels.includes("Claude") && issue.labels.includes("Codex")) {
    return {
      kind: "block",
      label: "Needs User",
      reason: `${id} carries BOTH lane labels — the operator must pick a lane`,
    };
  }

  // Blocker labels stop automation. Re-assert the block (idempotent).
  if (!isDone && candidate.blockerLabels.length > 0) {
    const label = candidate.blockerLabels[0];
    return {
      kind: "block",
      label,
      reason: `${id} is blocked by label "${label}" — automation stops until it is removed`,
    };
  }

  // Parent issues: the CHILDREN drive the work (the plan phase created them),
  // so the parent waits QUIETLY while any child is in flight and proceeds
  // normally once every child is finished. Never a Needs User block — the
  // factory created the children itself; escalating its own structure to a
  // human violates the LFG never-stuck doctrine (live THINK-270: the parent
  // was blocked "a human must drive the children" over children the plan
  // worker had just made).
  if (!isDone && view.hasChildIssues) {
    const states = view.childStates ?? null;
    const CHILD_TERMINAL = new Set(["Done", "Canceled", "Duplicate"]);
    const allChildrenFinished =
      states !== null &&
      states.length > 0 &&
      states.every((st) => CHILD_TERMINAL.has(st));
    if (!allChildrenFinished) {
      // Board legibility: a parent sitting in "Ready to Work" while its
      // children run is indistinguishable from an idle issue (live operator
      // escalation, THINK-278). Advance it to In Progress ONCE — In Progress
      // routes identically, and the next tick's children-in-flight check
      // waits there quietly.
      if (issue.state === "Ready to Work" || issue.state === "Ready To Work") {
        return {
          kind: "advance",
          toStatus: "In Progress",
          evidence:
            "child issues in flight — children drive the work; parent shown In Progress for board legibility",
        };
      }
      return {
        kind: "wait",
        reason: `${id} has child issues in flight — children drive the work; the parent resumes automatically when all children are Done`,
      };
    }
    // Every child finished — fall through: the parent routes normally (its
    // next worker verifies the assembled outcome and closes the parent out).
  }

  // KTD-10: a running attempt is untouched; labels re-apply next decision.
  if (
    view.activeAttempt !== null &&
    !isTerminalAttemptState(view.activeAttempt.state)
  ) {
    return {
      kind: "wait",
      reason: `attempt for phase "${view.activeAttempt.phase}" is ${view.activeAttempt.state} — no new action while a worker runs (KTD-10)`,
    };
  }

  // Cross-issue dependency wait (`waiting-on: THINK-x` ledger blocker): the
  // worker recorded a gate on another issue. Wait QUIETLY until the dependency
  // is Done, then fall through and relaunch — the resumed worker re-checks the
  // gate and clears the blocker. Never Needs User, never a Failed attempt.
  if (!isDone && view.dependency != null && !view.dependency.done) {
    return {
      kind: "wait",
      reason: `${id} is waiting on ${view.dependency.identifier} (currently ${view.dependency.state}) — resumes automatically when it reaches Done`,
    };
  }

  // Duplicate-worker guard: worker evidence outside the store → never launch.
  if ((view.externalWorkerSignals ?? []).length > 0) {
    return {
      kind: "wait",
      reason: `external worker signals present (${view.externalWorkerSignals!.join(
        "; ",
      )}) — duplicate-worker guard; reconcile before launching`,
    };
  }

  // Quota cooldown (R14/AE8): the newest terminal attempt hit a provider
  // rate-limit. Wait inside the window; escalate only once it is exceeded —
  // never an immediate relaunch that hammers a throttling provider.
  if (view.quota?.kind === "cooldown") {
    return {
      kind: "wait",
      reason: `latest attempt is in QuotaCooldown${
        view.quota.until ? ` until ${view.quota.until}` : ""
      } — waiting out the rate-limit window before retry (R14/AE8)`,
    };
  }
  const quotaExpired = view.quota?.kind === "expired";
  if (quotaExpired && !hasEscalationOverride(candidate)) {
    return {
      kind: "block",
      label: "Needs User",
      reason: `${id} exceeded its QuotaCooldown window without recovery — escalating instead of retrying (R14/AE8)`,
    };
  }

  // Lane routing: only Verification-family statuses route without a lane.
  if (lane === null && !isVerification) {
    return {
      kind: "noop",
      reason: `${id} has no single lane label and is not in Verification — not routable`,
    };
  }

  // Verification (and Review) drive the shared dev stack (KTD-11): when the
  // single dev-deployment mutex is held by another issue, wait visibly rather
  // than launch a racing Verification worker.
  if (isVerification && hasLfg && view.devLockHeldByOther === true) {
    return {
      kind: "wait",
      reason: `${id} is ready to verify but the dev-deployment lock is held by another issue — waiting for release (KTD-11)`,
    };
  }

  const action = routeByStatus(candidate);

  // Attempt ceiling (R15/AE5): the second consecutive kill/stall on a phase
  // escalates instead of launching a third attempt.
  if (action.kind === "launch") {
    const kills = view.consecutiveKillsByPhase?.[action.phase] ?? 0;
    const atCeiling = kills >= ATTEMPT_CEILING;
    if (atCeiling && !hasEscalationOverride(candidate)) {
      return {
        kind: "block",
        label: "Needs User",
        reason: `${id} phase "${action.phase}" has ${kills} consecutive killed/stalled attempts — escalating to an operator instead of a ${
          kills + 1
        }th attempt (R15/AE5)`,
      };
    }
    // This launch is only allowed because the operator cleared an escalation
    // (ceiling reached, or quota window expired). Mark it so the executor
    // consumes the block marker — the override is one-shot, so if this attempt
    // fails too the next tick re-escalates rather than relaunching forever.
    if (atCeiling || quotaExpired) {
      return { ...action, consumesEscalationOverride: true };
    }
  }
  return action;
}

/**
 * The routing contract's status table. Extracted so `decideAction` can wrap its
 * launch results with the attempt-ceiling escalation.
 */
function routeByStatus(candidate: EngineCandidate): EngineAction {
  const { issue, hasLfg } = candidate;
  const id = issue.identifier;
  switch (issue.state) {
    // No `Todo` case: the enrollment floor is Brainstorming (see ACTIVE_STATES).
    // A lane-labeled Todo issue is ideation the operator still owns; the daemon
    // no longer auto-advances Todo → Brainstorming. Moving an issue INTO
    // Brainstorming is the operator's "start the factory" gesture. A stray Todo
    // reaching here (it cannot, the poller filters it out) falls through to the
    // default noop.
    case "Brainstorming":
      return launch(candidate, requireLaunchPhase(issue.state));

    case "Requirements Review":
      return hasLfg
        ? {
            kind: "advance",
            toStatus: "Planning",
            evidence: "LFG present at Requirements Review gate",
          }
        : {
            kind: "wait",
            reason: "Requirements Review without LFG — waiting for human review (zero SLA)",
          };

    case "Planning":
      return launch(candidate, requireLaunchPhase(issue.state));

    case "Debug":
      return launch(candidate, requireLaunchPhase(issue.state));

    case "Plan Review":
      return hasLfg
        ? {
            kind: "advance",
            toStatus: "Ready to Work",
            evidence: "LFG present at Plan Review gate",
          }
        : {
            kind: "wait",
            reason: "Plan Review without LFG — waiting for human review (zero SLA)",
          };

    case "Ready to Work":
    case "Ready To Work":
      return launch(candidate, requireLaunchPhase(issue.state), {
        repair: issue.labels.includes(VERIFICATION_FAILED_LABEL),
      });

    case "In Progress":
      // No valid recorded worker (checked above) → create implementation/repair.
      return launch(candidate, requireLaunchPhase(issue.state), {
        repair: issue.labels.includes(VERIFICATION_FAILED_LABEL),
      });

    case "Verification":
    case "Review":
      return hasLfg
        ? launch(candidate, requireLaunchPhase(issue.state))
        : {
            kind: "wait",
            reason: "Verification without LFG — waiting for human review (zero SLA)",
          };

    case "Done":
      // Done is TERMINAL — the factory NEVER launches a worker on a Done issue.
      // Auto-compound is disabled (operator decision): the daemon must be fully
      // hands-off on finished work, so `ce-compound` is a manual/operator
      // action, not an autonomous phase. This also closes the compound
      // retry-loop class of bug — an already-compounded issue's re-dispatched
      // worker exits "nothing to compound" but leaves no `compounded: true`
      // evidence, so the executor marked a SUCCESSFUL run as Failed and
      // re-dispatched it every tick forever. With Done always a noop, a Done
      // issue produces zero activity (no thread, no worker, no escalation — the
      // Slack layer's Done-is-terminal guard already suppresses everything but a
      // launch, and there is no longer any launch).
      //
      // Done is also no longer ENROLLED (removed from ACTIVE_STATES so finished
      // issues stop burning ~4 Linear API requests per tick each), so this case
      // is defense-in-depth: it only fires under a scoped run or filter drift.
      return {
        kind: "noop",
        reason: `${id} is Done — terminal (auto-compound disabled; run ce-compound manually)`,
      };

    default:
      return {
        kind: "noop",
        reason: `status "${issue.state}" is not in the routing contract's table`,
      };
  }
}
