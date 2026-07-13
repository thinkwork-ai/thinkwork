/**
 * Canonical routing-contract vocabulary — the SINGLE source of truth for
 * lane labels, blocker labels, and workflow-status sets shared across the
 * daemon (poller filter, phase engine, ledger enums).
 *
 * Source of truth for the semantics:
 * .agents/skills/thinkwork-linear-dispatcher/references/routing-contract.md
 *
 * Invariant: `ROUTING_STATUSES` is DERIVED as `ACTIVE_STATES ∪
 * VERIFICATION_STATES` — the engine routes exactly what the poller enrolls,
 * by construction. Never re-declare these lists elsewhere; import them.
 */

/** Lane labels the dispatcher routes on. */
export const LANE_LABELS = ["Claude", "Codex"] as const;
export type LaneLabel = (typeof LANE_LABELS)[number];

/** LFG widens what downstream phases may do; it does not widen the filter. */
export const LFG_LABEL = "LFG";

/**
 * Blocker labels that stop automation (routing contract). Also the known
 * ledger `blocker` enum values (`null` in the ledger means unblocked).
 */
export const BLOCKER_LABELS = [
  "Needs User",
  "Needs Credentials",
  "Unsafe Ambiguity",
  "CI Failed",
  "Blocked: Auth",
  // Operator pause (Slack console `pause`/`resume`, KTD6). This entry is what
  // makes the label REAL: the poller filters candidate labels through this
  // list, so without it `pause` would ack success while workers kept
  // launching (the label would never reach candidate.blockerLabels).
  "Paused",
] as const;
export type BlockerLabel = (typeof BLOCKER_LABELS)[number];

/**
 * Workflow states the dispatcher routes for lane-labeled issues.
 *
 * Enrollment floor is **Brainstorming** — the factory kicks off when an
 * operator moves a lane-labeled issue into Brainstorming (or Debug, or any
 * later state). `Todo` is deliberately EXCLUDED: a lane-labeled issue sitting
 * in Todo is ideation the operator still owns (ce-ideate), and the daemon must
 * not touch it until the operator promotes it to Brainstorming. Moving an
 * issue INTO Brainstorming is the manual "start the factory" gesture; the
 * daemon no longer auto-advances Todo → Brainstorming.
 */
export const ACTIVE_STATES = [
  "Brainstorming",
  "Requirements Review",
  "Planning",
  "Debug",
  "Plan Review",
  "Ready to Work",
  "Ready To Work",
  "In Progress",
  // No `Done`: auto-compound is disabled, so a Done issue is TERMINAL and the
  // engine would only ever noop it. Keeping Done enrolled cost ~4 Linear API
  // requests per Done issue per tick (comments + child-issue reads) — with a
  // board's worth of finished lane-labeled issues that alone blew the
  // 2,500 req/hr API-key rate limit. Enrolled issues that REACH Done are wound
  // down by the un-enroll pass ("completed"), which classifies them from its
  // one batched miss-fetch.
] as const;
export type ActiveState = (typeof ACTIVE_STATES)[number];

/** Verification-family states — enrolled regardless of lane label. */
export const VERIFICATION_STATES = ["Verification", "Review"] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

/**
 * Every status the routing contract's table routes. Derived — NOT a third
 * hand-maintained list — so the engine's table can never drift from the
 * poller's enrollment filter.
 */
export const ROUTING_STATUSES = [
  ...ACTIVE_STATES,
  ...VERIFICATION_STATES,
] as const;
export type RoutingStatus = (typeof ROUTING_STATUSES)[number];
