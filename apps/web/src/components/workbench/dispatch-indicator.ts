/**
 * Per-message dispatch indicator derivation (THINK-136 U6, R6/R7, KTD3).
 *
 * Pure, presentation-agnostic logic so it is unit-testable independently of
 * the large TaskThreadView render tree. Two truth sources feed the state:
 *
 *   1. The linked turn (paired by `triggering_message_id`) — its lifecycle
 *      status drives running / completed / failed once a turn row exists.
 *   2. `message.metadata.dispatch` — stamped by the server on a synchronous
 *      dispatch failure ({ status: "failed", reason, ... }) or on a retry
 *      acceptance ({ status: "pending", ... }), covering the window before a
 *      turn row exists (or when no turn is ever created).
 *
 * `none` is the resting state: absence of any indicator chrome is itself the
 * signal that the agent was not engaged (R6 by absence).
 */

export type DispatchIndicatorState =
  | "none"
  | "pending"
  | "running"
  | "recovering"
  | "completed"
  | "failed";

/**
 * THINK-301 U6 (parent KTD4): the copy rendered for an exhausted-recovery
 * `timed_out` turn. Keyed off status only — the raw `turn.error` internals
 * ("Stall detected: no activity for 5 minutes") stay in the DB for operators
 * and never reach the DOM. Rendered verbatim (no "Agent dispatch failed:"
 * prefix).
 */
export const TIMED_OUT_FAILURE_COPY =
  "This response took too long to complete.";

export interface DispatchMetadata {
  status: string | null;
  reason: string | null;
  attempt: number | null;
  route: string | null;
}

export interface DispatchIndicatorMessageLike {
  role: string;
  metadata?: unknown;
}

export interface DispatchIndicatorTurnLike {
  status?: string | null;
  error?: string | null;
  /**
   * THINK-301 U6 (parent KTD3): server-derived recovery visibility — true
   * while an open retry row exists for this turn. Never inferred client-side.
   */
  recoveryPending?: boolean | null;
}

export interface DispatchIndicatorDerivation {
  state: DispatchIndicatorState;
  /** Human-readable failure detail; null unless state === "failed". */
  failureReason: string | null;
  /**
   * How `failureReason` should render: "timed_out" copy is status-keyed and
   * renders verbatim; "dispatch" keeps the "Agent dispatch failed:" framing.
   * Null unless state === "failed".
   */
  failureKind: "dispatch" | "timed_out" | null;
}

// Running/active turn statuses — the turn surface shows "Working…"/"Queued…".
const RUNNING_TURN_STATUSES = new Set([
  "running",
  "pending",
  "queued",
  "claimed",
]);
const COMPLETED_TURN_STATUSES = new Set(["completed", "succeeded"]);
// A turn that ended in a failure the sender can act on. `cancelled` is a
// deliberate stop (no retry affordance) and is intentionally excluded — its
// own turn surface renders "Cancelled after …". `timed_out` is handled
// separately (THINK-301 U6): recovery-in-flight renders as working, and
// exhausted recovery renders status-keyed plain copy instead of turn.error.
const FAILED_TURN_STATUSES = new Set(["failed"]);

function toRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeStatus(status: unknown): string {
  return String(status ?? "")
    .toLowerCase()
    .trim();
}

function trimmedOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Read the `dispatch` stamp off a message's metadata (object or AWSJSON
 * string). Returns null when no dispatch stamp is present.
 */
export function readMessageDispatch(
  metadata: unknown,
): DispatchMetadata | null {
  const record = toRecord(metadata);
  const dispatch = toRecord(record.dispatch);
  if (Object.keys(dispatch).length === 0) return null;
  return {
    status: normalizeStatus(dispatch.status) || null,
    reason: trimmedOrNull(dispatch.reason),
    attempt: typeof dispatch.attempt === "number" ? dispatch.attempt : null,
    route: trimmedOrNull(dispatch.route),
  };
}

/**
 * Derive the per-message dispatch indicator state. The linked turn's status
 * (id-paired, immune to timestamp skew) wins for the running/completed/failed
 * lifecycle; the metadata stamp covers pending (retry accepted, no turn yet)
 * and synchronous failure (no turn ever created).
 */
export function deriveDispatchIndicatorState(
  message: DispatchIndicatorMessageLike,
  turn?: DispatchIndicatorTurnLike | null,
): DispatchIndicatorDerivation {
  if (String(message.role ?? "").toUpperCase() !== "USER") {
    return { state: "none", failureReason: null, failureKind: null };
  }

  const dispatch = readMessageDispatch(message.metadata);

  if (turn) {
    const status = normalizeStatus(turn.status);
    if (status === "timed_out") {
      // THINK-301 U6 (parent R9/R10, KTD4): recovery in flight renders as a
      // benign working state; exhausted recovery renders plain status-keyed
      // copy. turn.error never feeds the rendered reason for timed_out.
      if (turn.recoveryPending) {
        return { state: "recovering", failureReason: null, failureKind: null };
      }
      return {
        state: "failed",
        failureReason: TIMED_OUT_FAILURE_COPY,
        failureKind: "timed_out",
      };
    }
    if (FAILED_TURN_STATUSES.has(status)) {
      return {
        state: "failed",
        failureReason: trimmedOrNull(turn.error) ?? dispatch?.reason ?? null,
        failureKind: "dispatch",
      };
    }
    if (COMPLETED_TURN_STATUSES.has(status)) {
      return { state: "completed", failureReason: null, failureKind: null };
    }
    if (RUNNING_TURN_STATUSES.has(status)) {
      return { state: "running", failureReason: null, failureKind: null };
    }
    // skipped / cancelled / unknown turn status → defer to the metadata stamp.
  }

  if (dispatch?.status === "failed") {
    return {
      state: "failed",
      failureReason: dispatch.reason,
      failureKind: "dispatch",
    };
  }
  if (dispatch?.status === "pending") {
    return { state: "pending", failureReason: null, failureKind: null };
  }
  return { state: "none", failureReason: null, failureKind: null };
}
