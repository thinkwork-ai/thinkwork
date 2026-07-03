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
  | "completed"
  | "failed";

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
}

export interface DispatchIndicatorDerivation {
  state: DispatchIndicatorState;
  /** Human-readable failure detail; null unless state === "failed". */
  failureReason: string | null;
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
// own turn surface renders "Cancelled after …".
const FAILED_TURN_STATUSES = new Set(["failed", "timed_out"]);

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
    return { state: "none", failureReason: null };
  }

  const dispatch = readMessageDispatch(message.metadata);

  if (turn) {
    const status = normalizeStatus(turn.status);
    if (FAILED_TURN_STATUSES.has(status)) {
      return {
        state: "failed",
        failureReason: trimmedOrNull(turn.error) ?? dispatch?.reason ?? null,
      };
    }
    if (COMPLETED_TURN_STATUSES.has(status)) {
      return { state: "completed", failureReason: null };
    }
    if (RUNNING_TURN_STATUSES.has(status)) {
      return { state: "running", failureReason: null };
    }
    // skipped / cancelled / unknown turn status → defer to the metadata stamp.
  }

  if (dispatch?.status === "failed") {
    return { state: "failed", failureReason: dispatch.reason };
  }
  if (dispatch?.status === "pending") {
    return { state: "pending", failureReason: null };
  }
  return { state: "none", failureReason: null };
}
