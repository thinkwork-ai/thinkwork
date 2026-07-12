/**
 * Lease renewal + host-aware liveness + expiry (U6, R10/R11/R15, AE4/AE5).
 *
 * Each sweep evaluates the ONE active attempt for a monitored issue and
 * classifies its worker's liveness from host-aware signals gathered through the
 * HostTransport seam (so CI/tests drive it with a fake and a simulated clock):
 *
 *   - host-unreachable — the host probe failed. The worker is neither healthy
 *     nor dead; freeze the SLA clock (R11) and NEVER expire the lease. This is
 *     the distinct laptop-asleep state, not a stall.
 *   - leased — pid alive AND the worker log grew within the phase silence
 *     budget. Renew the lease (advance heartbeat, extend expiry, accumulate
 *     observed-reachable time).
 *   - stalled — host reachable, pid alive, but the log has been silent past the
 *     silence budget (R14). The caller kills the process group, records the log
 *     tail, transitions Running→Stalled, and relaunches (R15).
 *   - dead — host reachable and the pid is gone while the attempt never settled.
 *     The lease has expired: settle the attempt and relaunch a fresh one (R15).
 *
 * The dead/stall verdicts require host reachability AND (for dead) confirmed pid
 * death BEFORE the lease expires — the duplicate-worker guard (AE4): a missed
 * heartbeat over an unreachable host must not relaunch over a still-live worker.
 *
 * SLA accounting (R11): `renewLease` advances `heartbeat_at` to `now` every
 * sweep but adds the elapsed delta to `sla_accumulated_ms` ONLY when the host
 * was reachable, so a host-unreachable window contributes zero — the clock is
 * frozen, not merely paused-and-caught-up.
 */

import type { AttemptRow, FactoryStore, LeaseRow } from "../store/db.js";
import type { HostTransport } from "../workers/transport.js";

/** Default lease time-to-live: a healthy heartbeat extends expiry this far out. */
export const DEFAULT_LEASE_TTL_MINUTES = 15;

export type LivenessVerdict =
  | "host-unreachable"
  | "leased"
  | "stalled"
  | "dead";

export interface LivenessInputs {
  attempt: AttemptRow;
  transport: HostTransport;
  now: Date;
  /** Phase silence budget in ms — log-mtime older than this (while alive) = stalled. */
  silenceBudgetMs: number;
}

/**
 * Probe host reachability, pid liveness, and log-mtime freshness and return the
 * single liveness verdict. Order matters: unreachable short-circuits BEFORE any
 * pid/log read so an asleep host never looks "dead".
 */
export async function evaluateLiveness(
  inputs: LivenessInputs,
): Promise<LivenessVerdict> {
  const { attempt, transport, now, silenceBudgetMs } = inputs;

  const reachable = await transport.probe();
  if (!reachable) return "host-unreachable";

  // A mid-launch attempt (pid not yet recorded) is treated as leased — it has
  // no worker to be dead yet; the next sweep re-evaluates once the pid lands.
  if (attempt.pid === null) return "leased";

  const alive = await transport.pidAlive(attempt.pid);
  if (!alive) return "dead";

  // Alive: healthy vs stalled turns on log growth. No log path yet (or an
  // unreadable log) is treated as fresh — absence of a stall signal is not a
  // stall (the wall-clock SLA still governs via driveAttempt).
  if (attempt.log_path === null) return "leased";
  const mtimeMs = await transport.statMtimeMs(attempt.log_path);
  if (mtimeMs === null) return "leased";
  const silentMs = now.getTime() - mtimeMs;
  return silentMs > silenceBudgetMs ? "stalled" : "leased";
}

export interface RenewInput {
  store: FactoryStore;
  issueId: string;
  attempt: AttemptRow;
  now: Date;
  /** Was the host reachable this sweep? Frozen-clock accounting depends on it. */
  reachable: boolean;
  ttlMinutes?: number;
}

/**
 * Renew (or create) the lease for an active attempt. Advances the heartbeat to
 * `now` and extends expiry by the TTL; accumulates elapsed observed-reachable
 * time into `sla_accumulated_ms` ONLY when `reachable` (R11 frozen clock).
 * Returns the new accumulated SLA in ms (for legibility/tests).
 */
export function renewLease(input: RenewInput): number {
  const { store, issueId, attempt, now, reachable } = input;
  const ttlMinutes = input.ttlMinutes ?? DEFAULT_LEASE_TTL_MINUTES;
  const existing: LeaseRow | undefined = store.getLease(issueId);

  // Baseline for the elapsed delta: the previous heartbeat, or — on the first
  // lease for this attempt — the attempt's start.
  const prevInstant =
    existing !== undefined
      ? new Date(existing.heartbeat_at).getTime()
      : new Date(attempt.started_at).getTime();
  const priorSla = existing?.sla_accumulated_ms ?? 0;
  const delta = reachable ? Math.max(0, now.getTime() - prevInstant) : 0;
  const slaAccumulatedMs = priorSla + delta;

  store.upsertLease({
    issueId,
    attemptId: attempt.id,
    // Always advance the heartbeat so the NEXT sweep measures only the next
    // interval — an unreachable window is thereby excluded from the clock
    // rather than counted when the host returns.
    heartbeatAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
    slaAccumulatedMs,
  });
  return slaAccumulatedMs;
}
