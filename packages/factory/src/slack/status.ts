/**
 * The R18 status view (U8): the daemon's world as the store already knows it —
 * NO new Linear calls. Two shapes:
 *   - buildStatusView   → the whole board: issues by phase, workers by
 *                         host + state (Stalled / HostUnreachable included),
 *                         hosts, and daemon-liveness age.
 *   - buildIssueStatus  → one issue's current phase/state + its live attempts,
 *                         for the in-thread `status` keyword.
 *
 * The `status` CLI command and the in-thread keyword both render these.
 * Liveness is derived from the freshest write the store holds (issue updates,
 * attempt starts/ends) — a store-only proxy for "is the daemon ticking",
 * labeled as such rather than pretending to be a dedicated heartbeat.
 */

import type { FactoryStore, AttemptRow } from "../store/db.js";
import { TERMINAL_ATTEMPT_STATES } from "../store/db.js";

export interface PhaseCount {
  phase: string;
  count: number;
}

export interface WorkerSummary {
  issueId: string;
  identifier: string | null;
  phase: string;
  host: string | null;
  state: string;
  attemptNumber: number;
  startedAt: string;
  detail: string | null;
}

export interface HostSummary {
  name: string;
  state: string;
  lastProbeAt: string | null;
}

export interface StatusView {
  issuesByPhase: PhaseCount[];
  /** Active (non-terminal) attempts, plus any in a Stalled state. */
  workers: WorkerSummary[];
  hosts: HostSummary[];
  liveness: {
    /** Freshest store write we could find (ISO), or null when empty. */
    lastActivityAt: string | null;
    /** Age of that write in whole seconds, or null when unknown. */
    ageSeconds: number | null;
  };
  threadsMapped: number;
}

export interface IssueStatus {
  issueId: string;
  identifier: string;
  phase: string;
  state: string;
  lane: string;
  compounded: boolean;
  /** Non-terminal attempts for this issue right now. */
  activeAttempts: WorkerSummary[];
}

const TERMINAL = new Set<string>(TERMINAL_ATTEMPT_STATES);

function isoAgeSeconds(iso: string, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
}

/** Identifier for an issue id, from the issues table when known. */
function identifierFor(store: FactoryStore, issueId: string): string | null {
  const row = store.getIssue(issueId);
  return row?.identifier ?? null;
}

function toWorker(store: FactoryStore, a: AttemptRow): WorkerSummary {
  return {
    issueId: a.issue_id,
    identifier: identifierFor(store, a.issue_id),
    phase: a.phase,
    host: a.host,
    state: a.state,
    attemptNumber: a.attempt_number,
    startedAt: a.started_at,
    detail: a.detail,
  };
}

export function buildStatusView(
  store: FactoryStore,
  now: Date = new Date(),
): StatusView {
  const issuesByPhase = store.db
    .prepare(
      "SELECT phase, COUNT(*) AS count FROM issues GROUP BY phase ORDER BY phase",
    )
    .all() as PhaseCount[];

  // Workers worth surfacing: everything active, PLUS anything Stalled (a
  // terminal state that still needs an operator's eye). HostUnreachable is
  // surfaced via the host list below; a worker on such a host shows as active
  // with its last-known state.
  const attempts = store.db
    .prepare(
      "SELECT * FROM attempts WHERE active = 1 OR state = 'Stalled' ORDER BY started_at DESC",
    )
    .all() as AttemptRow[];
  const workers = attempts.map((a) => toWorker(store, a));

  const hosts = (
    store.db
      .prepare("SELECT name, state, last_probe_at FROM hosts ORDER BY name")
      .all() as { name: string; state: string; last_probe_at: string | null }[]
  ).map((h) => ({ name: h.name, state: h.state, lastProbeAt: h.last_probe_at }));

  // Liveness proxy: the freshest timestamp anywhere in the store.
  const freshest = store.db
    .prepare(
      `SELECT MAX(t) AS at FROM (
         SELECT MAX(updated_at) AS t FROM issues
         UNION ALL SELECT MAX(started_at) FROM attempts
         UNION ALL SELECT MAX(ended_at) FROM attempts
         UNION ALL SELECT MAX(updated_at) FROM slack_threads
       )`,
    )
    .get() as { at: string | null };
  const lastActivityAt = freshest.at;

  const threadsMapped = (
    store.db.prepare("SELECT COUNT(*) AS n FROM slack_threads").get() as {
      n: number;
    }
  ).n;

  return {
    issuesByPhase,
    workers,
    hosts,
    liveness: {
      lastActivityAt,
      ageSeconds:
        lastActivityAt === null ? null : isoAgeSeconds(lastActivityAt, now),
    },
    threadsMapped,
  };
}

export function buildIssueStatus(
  store: FactoryStore,
  issueId: string,
): IssueStatus | null {
  const issue = store.getIssue(issueId);
  if (issue === undefined) return null;
  const attempts = (
    store.db
      .prepare(
        "SELECT * FROM attempts WHERE issue_id = ? ORDER BY started_at DESC",
      )
      .all(issueId) as AttemptRow[]
  ).filter((a) => !TERMINAL.has(a.state));
  return {
    issueId,
    identifier: issue.identifier,
    phase: issue.phase,
    state: issue.state,
    lane: issue.lane,
    compounded: issue.compounded === 1,
    activeAttempts: attempts.map((a) => toWorker(store, a)),
  };
}

/** Render the board view as plain text (CLI + in-thread `status`). */
export function formatStatusView(view: StatusView): string {
  const lines: string[] = [];
  lines.push("Factory status");
  const phases =
    view.issuesByPhase.length === 0
      ? "  (no issues tracked yet)"
      : view.issuesByPhase
          .map((p) => `  ${p.phase}: ${p.count}`)
          .join("\n");
  lines.push("Issues by phase:", phases);

  if (view.workers.length === 0) {
    lines.push("Workers: none active");
  } else {
    lines.push("Workers:");
    for (const w of view.workers) {
      const who = w.identifier ?? w.issueId;
      lines.push(
        `  ${who} ${w.phase} attempt ${w.attemptNumber} — ${w.state} on ${w.host ?? "?"}`,
      );
    }
  }

  if (view.hosts.length > 0) {
    lines.push("Hosts:");
    for (const h of view.hosts) {
      lines.push(`  ${h.name}: ${h.state}${h.lastProbeAt ? ` (probed ${h.lastProbeAt})` : ""}`);
    }
  }

  lines.push(
    `Threads mapped: ${view.threadsMapped}`,
    view.liveness.ageSeconds === null
      ? "Last store activity: unknown"
      : `Last store activity: ${view.liveness.ageSeconds}s ago`,
  );
  return lines.join("\n");
}

/** Render one issue's status as plain text (in-thread `status`). */
export function formatIssueStatus(status: IssueStatus): string {
  const lines = [
    `${status.identifier} — phase ${status.phase}, status "${status.state}", lane ${status.lane}${status.compounded ? ", compounded" : ""}`,
  ];
  if (status.activeAttempts.length === 0) {
    lines.push("  no active worker");
  } else {
    for (const a of status.activeAttempts) {
      lines.push(
        `  ${a.phase} attempt ${a.attemptNumber} — ${a.state} on ${a.host ?? "?"}`,
      );
    }
  }
  return lines.join("\n");
}

/** True when an in-thread message is a bare `status` request. */
export function isStatusKeyword(text: string): boolean {
  return /^\s*status\s*\??\s*$/i.test(text.replace(/<@[^>]+>/g, "").trim());
}
