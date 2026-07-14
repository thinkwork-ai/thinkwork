/**
 * One poll tick (R1–R3): enumerate the queue per the routing contract
 * (.agents/skills/thinkwork-linear-dispatcher/references/routing-contract.md).
 *
 * Candidate filter:
 * - lane-labeled (`Claude`/`Codex`) issues in active workflow states — `LFG`
 *   widens what downstream phases may do, it does not widen the filter;
 * - PLUS every issue in a Verification-family status regardless of lane
 *   (Verification is always owned by the Claude lane).
 *
 * Tick shape: ALL reads happen first; any Linear API failure mid-read aborts
 * the tick with PollAbortedError before a single write, so a retry on the
 * next tick starts from scratch (no partial state). Only after every read
 * succeeds does the tick apply lane-conflict remediation (`Needs User` + one
 * marked comment + ledger blocker), which is idempotent across repeated
 * polls.
 */

import {
  ACTIVE_STATES,
  BLOCKER_LABELS,
  LANE_LABELS,
  LFG_LABEL,
  VERIFICATION_STATES,
  type LaneLabel,
} from "../domain/statuses.js";
import type { Logger } from "../logger.js";
import type {
  LinearCommentSnapshot,
  LinearGateway,
  LinearIssueSnapshot,
} from "./client.js";
import {
  findLedgerComment,
  parseLedgerComment,
  renderLedgerComment,
  type ParsedLedger,
} from "./ledger.js";
import { isMarkerComment } from "./markers.js";

// Canonical vocabulary lives in src/domain/statuses.ts — re-exported here
// for callers that reach the poller first.
export {
  ACTIVE_STATES,
  BLOCKER_LABELS,
  LANE_LABELS,
  LFG_LABEL,
  VERIFICATION_STATES,
};
export type { LaneLabel };

export const LANE_CONFLICT_MARKER_PREFIX = "factory-lane-conflict:";

export function laneConflictMarker(issueIdentifier: string): string {
  return `${LANE_CONFLICT_MARKER_PREFIX}${issueIdentifier}`;
}

export interface PollCandidate {
  issue: LinearIssueSnapshot;
  /** The single lane label, or null (verification issue with no lane). */
  lane: LaneLabel | null;
  /**
   * LFG on the issue itself OR inherited from its direct parent. A plan-phase
   * sub-issue of an LFG parent must never stall at a review gate waiting for
   * human approval — that stops the whole tree (live THINK-282: parent stuck
   * because sub-issue THINK-284 sat at a gate).
   */
  hasLfg: boolean;
  /** True when the issue is in a Verification-family status. */
  isVerification: boolean;
  /** Blocker labels currently on the issue (automation must not launch). */
  blockerLabels: string[];
  /** Parsed (or synthesized) rolling ledger. */
  ledger: ParsedLedger;
  /** Comment id of the ledger comment, or null when none exists yet. */
  ledgerCommentId: string | null;
  comments: LinearCommentSnapshot[];
}

export interface PollTickResult {
  /** Dispatchable candidates (no lane conflict). */
  candidates: PollCandidate[];
  /** Issues carrying BOTH lane labels — never dispatched. */
  laneConflicts: PollCandidate[];
  /** Identifiers remediated (label/comment/ledger written) THIS tick. */
  remediated: string[];
}

/** A read failed mid-tick; nothing was written. The next tick retries. */
export class PollAbortedError extends Error {
  constructor(cause: unknown) {
    super(
      `poll tick aborted: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "PollAbortedError";
    this.cause = cause;
  }
}

/**
 * True when an issue is a dispatch candidate under the routing contract:
 * a Verification-family issue (any lane), or a lane-labeled issue in an active
 * workflow state. Exported so the un-enroll pass can ask "is this enrolled
 * issue STILL a valid candidate?" using the exact enrollment predicate (a
 * transient poll miss on a still-valid candidate must never un-enroll it).
 */
export function matchesFilter(issue: LinearIssueSnapshot): boolean {
  const isVerification = (VERIFICATION_STATES as readonly string[]).includes(
    issue.state,
  );
  if (isVerification) return true;
  const hasLane = issue.labels.some((l) =>
    (LANE_LABELS as readonly string[]).includes(l),
  );
  return hasLane && (ACTIVE_STATES as readonly string[]).includes(issue.state);
}

function toCandidate(
  issue: LinearIssueSnapshot,
  comments: LinearCommentSnapshot[],
): PollCandidate {
  const lanes = LANE_LABELS.filter((l) => issue.labels.includes(l));
  // Newest matching comment wins: a daemon-authored ledger is always
  // authoritative over an older comment that happens to parse as one.
  const ledgerComment = findLedgerComment(issue.identifier, comments);
  return {
    issue,
    lane: lanes.length === 1 ? lanes[0] : null,
    hasLfg:
      issue.labels.includes(LFG_LABEL) ||
      (issue.parentLabels ?? []).includes(LFG_LABEL),
    isVerification: (VERIFICATION_STATES as readonly string[]).includes(
      issue.state,
    ),
    blockerLabels: issue.labels.filter((l) =>
      (BLOCKER_LABELS as readonly string[]).includes(l),
    ),
    ledger: parseLedgerComment(issue.identifier, ledgerComment?.body),
    ledgerCommentId: ledgerComment?.id ?? null,
    comments,
  };
}

function hasLaneConflict(issue: LinearIssueSnapshot): boolean {
  return LANE_LABELS.every((l) => issue.labels.includes(l));
}

/**
 * Remediate a lane conflict: `Needs User` label, ONE marked comment, and the
 * rolling ledger's blocker set to `Needs User`. Every write is guarded so
 * repeated polls are no-ops. Returns true when anything was written.
 */
async function remediateLaneConflict(
  gateway: LinearGateway,
  candidate: PollCandidate,
): Promise<boolean> {
  const { issue, comments } = candidate;
  let wrote = false;

  if (!issue.labels.includes("Needs User")) {
    await gateway.addLabel(issue.id, "Needs User");
    wrote = true;
  }

  const marker = laneConflictMarker(issue.identifier);
  if (!comments.some((c) => isMarkerComment(c.body, marker))) {
    const body = [
      marker,
      "",
      "**Lane conflict** — this issue carries BOTH `Claude` and `Codex` lane labels, so no",
      "dispatcher will route it. Please remove one lane label to pick a lane, then remove",
      "`Needs User` to resume automation.",
    ].join("\n");
    await gateway.createComment(issue.id, body);
    wrote = true;
  }

  if (candidate.ledger.ledger.blocker !== "Needs User") {
    const ledger = { ...candidate.ledger.ledger, blocker: "Needs User" };
    const rendered = renderLedgerComment(
      issue.identifier,
      ledger,
      candidate.ledger.prose,
    );
    if (candidate.ledgerCommentId !== null) {
      await gateway.updateComment(candidate.ledgerCommentId, rendered);
    } else {
      await gateway.createComment(issue.id, rendered);
    }
    wrote = true;
  }

  return wrote;
}

/**
 * Execute one poll tick. Throws PollAbortedError (nothing written) when any
 * Linear read fails; the caller just waits for the next tick.
 */
export async function pollTick(
  gateway: LinearGateway,
  teamKey: string,
  log?: Logger,
  onlyIssues?: ReadonlySet<string>,
): Promise<PollTickResult> {
  // ---- Phase 1: reads only. Any failure aborts before any write. ----
  let matched: {
    issue: LinearIssueSnapshot;
    comments: LinearCommentSnapshot[];
  }[];
  try {
    // Scoped run (tracer / safe rollout): fetch only the named issues by
    // identifier instead of draining the whole team (which also N+1s state +
    // labels per issue). Unscoped: the full board.
    const issues = onlyIssues
      ? await gateway.getIssuesByIdentifier([...onlyIssues])
      : await gateway.listTeamIssues(teamKey);
    matched = [];
    for (const issue of issues.filter(matchesFilter)) {
      matched.push({ issue, comments: await gateway.listComments(issue.id) });
    }
  } catch (cause) {
    throw new PollAbortedError(cause);
  }

  const all = matched.map(({ issue, comments }) =>
    toCandidate(issue, comments),
  );
  const laneConflicts = all.filter((c) => hasLaneConflict(c.issue));
  const candidates = all.filter((c) => !hasLaneConflict(c.issue));

  for (const candidate of all) {
    for (const warning of candidate.ledger.warnings) {
      log?.warn("ledger field flagged", {
        issue: candidate.issue.identifier,
        warning,
      });
    }
  }

  // ---- Phase 2: idempotent lane-conflict remediation writes. ----
  const remediated: string[] = [];
  for (const conflict of laneConflicts) {
    if (await remediateLaneConflict(gateway, conflict)) {
      remediated.push(conflict.issue.identifier);
      log?.warn("lane conflict remediated", {
        issue: conflict.issue.identifier,
      });
    }
  }

  return { candidates, laneConflicts, remediated };
}
