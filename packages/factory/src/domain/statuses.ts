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
] as const;
export type BlockerLabel = (typeof BLOCKER_LABELS)[number];

/** Workflow states the dispatcher routes for lane-labeled issues. */
export const ACTIVE_STATES = [
  "Todo",
  "Brainstorming",
  "Requirements Review",
  "Planning",
  "Debug",
  "Plan Review",
  "Ready to Work",
  "Ready To Work",
  "In Progress",
  // Done is routed too: the engine decides compound (LFG + not yet
  // compounded) or noop — excluding it here made the contract's compound
  // row unreachable (fixed in the U5 wiring slice).
  "Done",
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
