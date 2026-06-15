/**
 * Turn-surface header helpers (plan U2).
 *
 * Pure, presentation-only logic for the consolidated Codex-style turn
 * surface: a single "Working…" / "Worked for Xm Ys" header that replaces
 * the old "Thinking" + "Processing…" stack (wired into the render in U4).
 * Kept in its own module so it is unit-testable independently of the
 * 3,400-line TaskThreadView render tree.
 */

const SECOND_MS = 1000;

/**
 * Human-readable duration. The minutes segment is omitted under a minute,
 * and sub-second durations floor to "1s" (never "0s"), matching Codex.
 *
 *   formatDuration(850)    -> "1s"
 *   formatDuration(12000)  -> "12s"
 *   formatDuration(60000)  -> "1m 0s"
 *   formatDuration(207000) -> "3m 27s"
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const totalSeconds = Math.max(1, Math.round(ms / SECOND_MS));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * Header label for a turn given its status, whether it is currently
 * running, and its duration in ms (null when not yet started or unknown).
 *
 * Returns `null` for `skipped` turns, which are not rendered.
 *
 * Running turns:
 *   - not yet started (durationMs null) -> "Queued…"
 *   - started                          -> "Working…"  (live timer rendered alongside)
 *
 * Terminal turns:
 *   - succeeded/completed -> "Worked for {dur}"
 *   - failed             -> "Failed after {dur}"
 *   - cancelled          -> "Cancelled after {dur}"
 *   - timed_out          -> "Timed out after {dur}"
 */
export function formatTurnHeader(
  status: string | null | undefined,
  isRunning: boolean,
  durationMs: number | null,
): string | null {
  const normalized = (status ?? "").toLowerCase().trim();
  if (normalized === "skipped") return null;

  if (isRunning) {
    return durationMs == null ? "Queued…" : "Working…";
  }

  const dur = durationMs != null ? formatDuration(durationMs) : "";
  switch (normalized) {
    case "failed":
      return dur ? `Failed after ${dur}` : "Failed";
    case "cancelled":
      return dur ? `Cancelled after ${dur}` : "Cancelled";
    case "timed_out":
      return dur ? `Timed out after ${dur}` : "Timed out";
    default:
      return dur ? `Worked for ${dur}` : "Worked";
  }
}

/** Running/active turn statuses — the surface shows "Working…"/"Queued…". */
const RUNNING_STATUSES = new Set(["running", "pending", "queued", "claimed"]);

/** Derive the single source-of-truth "running" signal from turn status alone. */
export function isRunningStatus(status: string | null | undefined): boolean {
  return RUNNING_STATUSES.has((status ?? "").toLowerCase().trim());
}
