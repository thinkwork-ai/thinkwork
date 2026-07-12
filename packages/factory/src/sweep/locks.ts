/**
 * Single dev-deployment mutex (U6, KTD-11).
 *
 * Phases that touch the SHARED dev stack — Verification (drives deployed dev),
 * and anything that runs `db:push` — must not run concurrently against each
 * other. They acquire one named lock in the operational store; every other
 * phase runs without it. A second contender for a held lock waits VISIBLY (it
 * can read the current holder) rather than racing. The full resource-lock
 * taxonomy is deferred (KTD-11) — this is the one lock v1 needs.
 */

import type { FactoryStore, LockRow } from "../store/db.js";
import type { Phase } from "../phases/engine.js";

/** The one named lock v1 uses. */
export const DEV_DEPLOYMENT_LOCK = "dev-deployment";

/**
 * Phases that must serialize on the dev-deployment lock. Verification always
 * drives the shared deployed dev stack; other phases run concurrently.
 * (Implement phases that run `db:push` are the other theoretical holder, but v1
 * cannot statically know which implement run does so — the plan names
 * Verification explicitly, and this stays the single conservative gate.)
 */
export function phaseNeedsDevLock(phase: Phase): boolean {
  return phase === "verify";
}

export type LockAcquireResult =
  | { acquired: true }
  | { acquired: false; heldBy: string };

/**
 * Try to acquire the dev-deployment lock for `issueId`. Reentrant: an issue
 * that already holds it re-acquires cleanly. Returns the current holder when
 * another issue owns it so the caller can surface a visible wait.
 */
export function acquireDevLock(
  store: FactoryStore,
  issueId: string,
  now: Date,
): LockAcquireResult {
  const got = store.acquireLock(DEV_DEPLOYMENT_LOCK, issueId, now.toISOString());
  if (got) return { acquired: true };
  const holder = store.getLock(DEV_DEPLOYMENT_LOCK);
  return { acquired: false, heldBy: holder?.holder_issue_id ?? "unknown" };
}

/** Release the dev-deployment lock iff `issueId` holds it. */
export function releaseDevLock(store: FactoryStore, issueId: string): boolean {
  return store.releaseLock(DEV_DEPLOYMENT_LOCK, issueId);
}

/** Current holder of the dev-deployment lock, or null when free. */
export function devLockHolder(store: FactoryStore): string | null {
  const row: LockRow | undefined = store.getLock(DEV_DEPLOYMENT_LOCK);
  return row?.holder_issue_id ?? null;
}

/** True when the lock is held by an issue OTHER than `issueId`. */
export function devLockHeldByOther(
  store: FactoryStore,
  issueId: string,
): boolean {
  const holder = devLockHolder(store);
  return holder !== null && holder !== issueId;
}

/**
 * Release the dev-deployment lock if its holder has NO active (non-terminal)
 * attempt (Fix: dev-lock leak on hard crash). The executor releases the lock in
 * an in-process `finally`, so a SIGKILL/panic mid-verify leaves the `locks` row
 * set forever with no TTL — and every future verify phase then waits on a lock
 * whose holder is gone (permanent Verification deadlock). The boot reconciler
 * calls this after settling orphaned attempts: a holder with no live attempt is
 * definitionally gone, so the lock is releasable. A holder whose verify worker
 * survived the restart (reattached → still has an active attempt) keeps its
 * lock. Returns the released holder id, or null when nothing was released.
 */
export function releaseOrphanedDevLock(store: FactoryStore): string | null {
  const holder = devLockHolder(store);
  if (holder === null) return null;
  const holderHasActiveAttempt = store
    .listActiveAttempts()
    .some((a) => a.issue_id === holder);
  if (holderHasActiveAttempt) return null;
  releaseDevLock(store, holder);
  return holder;
}
