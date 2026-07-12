/**
 * Nag timers (U6, R23). Human-wait states — a worker question, or a review gate
 * sitting without `LFG` — are supervised, not silently stalled: a timer arms on
 * entry, fires an @mention re-ping on a schedule (default 4h, then daily),
 * re-arms daily, and disarms the moment the wait resolves.
 *
 * Firing is DELEGATED to the Slack surface's existing `postNag` (U8 owns the
 * transport). This module never talks to Slack directly: `sweepNags` takes an
 * optional `deliver` callback (wired to postNag by the daemon when Slack is
 * present); when it is absent, a fired nag is enqueued in the store outbox so
 * U8 can flush it once Slack comes online. Timer arithmetic is pure over an
 * injected `now` for deterministic simulated-clock tests.
 */

import type { FactoryStore, NagTimerRow } from "../store/db.js";

/** Kinds of human-wait a nag can supervise. */
export type NagKind = "question" | "review-gate";

/** First re-ping after entering a human-wait state: 4 hours (R23). */
export const DEFAULT_NAG_FIRST_DELAY_MINUTES = 4 * 60;
/** Subsequent cadence after the first fire: daily (R23). */
export const DEFAULT_NAG_INTERVAL_MINUTES = 24 * 60;

export interface ArmNagInput {
  store: FactoryStore;
  issueId: string;
  kind: NagKind;
  now: Date;
  firstDelayMinutes?: number;
  intervalMinutes?: number;
}

/**
 * Arm the nag timer for (issue, kind) on ENTRY to a human-wait state. Idempotent
 * across sweeps: an already-armed timer is left exactly as-is (its schedule is
 * preserved), so re-observing the same wait never resets the countdown. A
 * previously-disarmed timer for the same wait is re-armed fresh.
 */
export function armNag(input: ArmNagInput): void {
  const { store, issueId, kind, now } = input;
  const firstDelay = input.firstDelayMinutes ?? DEFAULT_NAG_FIRST_DELAY_MINUTES;
  const interval = input.intervalMinutes ?? DEFAULT_NAG_INTERVAL_MINUTES;
  const existing = store.getNagTimer(issueId, kind);
  if (existing !== undefined && existing.armed === 1) return; // already armed
  store.upsertNagTimer({
    issueId,
    kind,
    nextFireAt: new Date(now.getTime() + firstDelay * 60_000).toISOString(),
    intervalMinutes: interval,
    armed: true,
  });
}

/** Disarm the nag timer for (issue, kind) — the wait resolved (answer/LFG). */
export function disarmNag(
  store: FactoryStore,
  issueId: string,
  kind: NagKind,
): void {
  if (store.getNagTimer(issueId, kind) !== undefined) {
    store.setNagArmed(issueId, kind, false);
  }
}

/** A nag ready to deliver, with the store row it came from. */
export interface FiredNag {
  timer: NagTimerRow;
  text: string;
}

export interface SweepNagsInput {
  store: FactoryStore;
  now: Date;
  /**
   * Delivery seam. When present (Slack online), each due nag is delivered
   * through it; a delivery throw does not stop the sweep — the nag is enqueued
   * to the outbox instead. When absent, every due nag is enqueued.
   */
  deliver?: (nag: FiredNag) => Promise<void>;
  /** Renders the @mention text for a due timer (defaults to a generic re-ping). */
  renderText?: (timer: NagTimerRow) => string;
}

function defaultText(timer: NagTimerRow): string {
  const what =
    timer.kind === "question"
      ? "still needs an answer"
      : "is still waiting for review";
  return `Reminder: this issue ${what} — reply in this thread to resume.`;
}

/**
 * Fire every armed timer whose deadline has passed: deliver (or enqueue) it and
 * re-arm at `now + interval` (daily cadence). Returns the fired nags. Disarmed
 * and not-yet-due timers are untouched.
 */
export async function sweepNags(input: SweepNagsInput): Promise<FiredNag[]> {
  const { store, now } = input;
  const render = input.renderText ?? defaultText;
  const due = store.listDueNagTimers(now.toISOString());
  const fired: FiredNag[] = [];

  for (const timer of due) {
    const nag: FiredNag = { timer, text: render(timer) };
    let delivered = false;
    if (input.deliver !== undefined) {
      try {
        await input.deliver(nag);
        delivered = true;
      } catch {
        delivered = false; // fall through to the outbox
      }
    }
    if (!delivered) {
      store.enqueueNag({
        issueId: timer.issue_id,
        kind: timer.kind,
        text: nag.text,
      });
    }
    // Re-arm at the daily cadence regardless of delivery path so an outage does
    // not collapse into a fire-every-sweep loop.
    store.setNagNextFire(
      timer.issue_id,
      timer.kind,
      new Date(now.getTime() + timer.interval_minutes * 60_000).toISOString(),
    );
    fired.push(nag);
  }
  return fired;
}
