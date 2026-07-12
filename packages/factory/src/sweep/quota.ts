/**
 * Quota classifier + cooldown window (U6, R14 / AE8 / KTD-9).
 *
 * A provider rate-limit signal lands an attempt in the terminal `QuotaCooldown`
 * state (classified by the runner adapter — driveAttempt in workers/attempts.ts
 * — NOT here; this module never kills a worker). Once cooled, the naive engine
 * would relaunch on the very next tick — a 30s retry hammer against a
 * throttling provider. This module surfaces the most-recent terminal attempt's
 * state + `ended_at` so `decideAction` can:
 *
 *   - return `wait` while the latest attempt is `QuotaCooldown` AND now is still
 *     inside the cooldown window (default 30 min); and
 *   - escalate (block) only once the window is EXCEEDED (AE8: "no kill/relaunch
 *     escalation fires unless the cooldown window is exceeded").
 *
 * Pure over an injected `now` — no clock, no I/O beyond the one store read.
 */

import type { AttemptRow, FactoryStore } from "../store/db.js";

/** Default cooldown window: wait this long after a QuotaCooldown before escalating. */
export const DEFAULT_QUOTA_COOLDOWN_MINUTES = 30;

export type QuotaVerdict =
  /** Latest attempt is not a quota cooldown — quota does not constrain routing. */
  | { kind: "clear" }
  /** Cooling down: still inside the window. decideAction should `wait`. */
  | { kind: "cooldown"; until: Date; endedAt: Date }
  /** Window exceeded: decideAction should escalate rather than relaunch. */
  | { kind: "expired"; endedAt: Date };

/**
 * The most-recent terminal attempt for an issue, or undefined when the issue
 * has no settled attempts yet. Exposed for the sweep classifier and tests.
 */
export function latestTerminalAttempt(
  store: FactoryStore,
  issueId: string,
): AttemptRow | undefined {
  return store.getLatestTerminalAttempt(issueId);
}

/**
 * Classify quota state for an issue from its newest terminal attempt.
 * `now`/`windowMinutes` are injected so timer behaviour is deterministic under
 * a simulated clock.
 */
export function classifyQuota(
  store: FactoryStore,
  issueId: string,
  now: Date,
  windowMinutes: number = DEFAULT_QUOTA_COOLDOWN_MINUTES,
): QuotaVerdict {
  const latest = store.getLatestTerminalAttempt(issueId);
  if (latest === undefined || latest.state !== "QuotaCooldown") {
    return { kind: "clear" };
  }
  // A QuotaCooldown attempt always stamps ended_at (terminal transition), but
  // treat a missing timestamp as "just now" (fail toward waiting, never toward
  // an immediate retry hammer).
  const endedAt = latest.ended_at !== null ? new Date(latest.ended_at) : now;
  const until = new Date(endedAt.getTime() + windowMinutes * 60_000);
  if (now.getTime() < until.getTime()) {
    return { kind: "cooldown", until, endedAt };
  }
  return { kind: "expired", endedAt };
}
