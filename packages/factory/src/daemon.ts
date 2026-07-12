/**
 * Poll loop (U5 wiring slice): one dispatch authority, one issue at a time.
 *
 * Every tick: pollTick (reads first, aborts clean) → per candidate,
 * serialized: enrollment preflight → StoreView (store active attempt + pid
 * liveness + `git worktree list` duplicate guard + child-issue read) →
 * decideAction → executeAction. A stop request (SIGINT/SIGTERM) finishes the
 * CURRENT issue, skips the rest, and exits the loop — running workers are
 * detached and never killed by shutdown.
 */

import type { Logger } from "./logger.js";
import type { CommentTrust, LinearGateway } from "./linear/client.js";
import {
  pollTick,
  PollAbortedError,
  type PollCandidate,
} from "./linear/poller.js";
import {
  applyPreflightBlock,
  evaluatePreflight,
  hasPreflightOverride,
} from "./linear/preflight.js";
import type { FactoryStore, AttemptRow } from "./store/db.js";
import { TERMINAL_ATTEMPT_STATES } from "./store/db.js";
import type { HostTransport } from "./workers/transport.js";
import { decideAction, type EngineAction, type StoreView } from "./phases/engine.js";

export interface DaemonController {
  readonly stopping: boolean;
  stop(): void;
}

export function createDaemonController(): DaemonController {
  let stopping = false;
  return {
    get stopping() {
      return stopping;
    },
    stop() {
      stopping = true;
    },
  };
}

export interface DaemonDeps {
  gateway: LinearGateway;
  store: FactoryStore;
  transport: HostTransport;
  /** Local repo checkout scanned by the duplicate-worker guard. */
  repoPath: string;
  teamKey: string;
  log: Logger;
  /** Action execution seam — cli wires executeAction; tests inject fakes. */
  execute: (
    action: EngineAction,
    candidate: PollCandidate,
  ) => Promise<unknown>;
  /**
   * Author allowlist used to validate the preflight-override marker comment
   * (must be daemon/operator-authored). Optional: without it the marker is
   * accepted from any author.
   */
  trust?: CommentTrust;
  /**
   * Tracer / safe-rollout scope. When set, only issues whose identifier is in
   * this set are processed in a tick; every other candidate is skipped (and
   * logged) without any Linear write. Undefined = process the whole queue.
   */
  onlyIssues?: ReadonlySet<string>;
}

/**
 * Bound for `git worktree list` in the duplicate-worker scan. The daemon
 * loop awaits each tick to completion — an unbounded hung git call would
 * freeze the whole daemon.
 */
export const WORKTREE_LIST_TIMEOUT_MS = 10_000;

/** Any-phase active attempt for an issue (partial index allows ≤1 per phase). */
function getAnyActiveAttempt(
  store: FactoryStore,
  issueId: string,
): AttemptRow | undefined {
  return store.db
    .prepare("SELECT * FROM attempts WHERE issue_id = ? AND active = 1 LIMIT 1")
    .get(issueId) as AttemptRow | undefined;
}

/** Is this worktree path known to the store (any attempt, any state)? R15
 * keeps finished attempts' worktrees on disk for forensics — only worktrees
 * the store has NEVER heard of count as external worker evidence. */
function worktreeKnown(store: FactoryStore, path: string): boolean {
  const row = store.db
    .prepare("SELECT COUNT(*) AS n FROM attempts WHERE worktree_path = ?")
    .get(path) as { n: number };
  return row.n > 0;
}

/**
 * Build the engine's StoreView for one candidate: store attempt + live pid
 * check, `git worktree list` scan for auto-<slug>-* worktrees the store does
 * not know (duplicate-worker guard), and the Linear child-issue read.
 */
export async function buildStoreView(
  deps: Pick<DaemonDeps, "gateway" | "store" | "transport" | "repoPath">,
  candidate: PollCandidate,
): Promise<StoreView> {
  const { issue } = candidate;
  const externalWorkerSignals: string[] = [];

  let activeAttempt: StoreView["activeAttempt"] = null;
  const row = getAnyActiveAttempt(deps.store, issue.id);
  if (row !== undefined) {
    const terminal = (TERMINAL_ATTEMPT_STATES as readonly string[]).includes(
      row.state,
    );
    if (!terminal && row.pid !== null) {
      const alive = await deps.transport.pidAlive(row.pid);
      if (alive) {
        activeAttempt = { phase: row.phase, state: row.state };
      } else {
        // Worker process is gone but the attempt was never settled — the U6
        // sweep reconciles it; until then never launch a duplicate.
        externalWorkerSignals.push(
          `stale-active-attempt:${row.id} pid:${row.pid} dead`,
        );
      }
    } else if (!terminal) {
      // Active but no pid yet (mid-launch) — treat as running.
      activeAttempt = { phase: row.phase, state: row.state };
    }
  }

  // Duplicate-worker guard: auto-<slug>-* worktrees the store cannot account
  // for mean some other dispatcher (or a crashed one) owns a worker.
  // Bounded: on timeout the transport reports a non-zero/null exit and the
  // scan is skipped for this tick (same as any other git failure) instead of
  // hanging the daemon loop.
  const slug = issue.identifier.toLowerCase();
  const worktrees = await deps.transport.exec(
    "git",
    ["-C", deps.repoPath, "worktree", "list", "--porcelain"],
    { timeoutMs: WORKTREE_LIST_TIMEOUT_MS },
  );
  if (worktrees.code === 0) {
    for (const line of worktrees.stdout.split("\n")) {
      if (!line.startsWith("worktree ")) continue;
      const path = line.slice("worktree ".length).trim();
      const base = path.split("/").pop() ?? "";
      if (!base.startsWith(`auto-${slug}-`)) continue;
      if (!worktreeKnown(deps.store, path)) {
        externalWorkerSignals.push(`unknown-worktree:${path}`);
      }
    }
  }

  const hasChildIssues = await deps.gateway.hasChildIssues(issue.id);

  return {
    activeAttempt,
    hasChildIssues,
    externalWorkerSignals,
  };
}

export interface TickResult {
  /** Identifier → decided action kind, in processing order. */
  decisions: { issue: string; kind: EngineAction["kind"] }[];
  /** True when a stop request cut the candidate loop short. */
  stopped: boolean;
}

/**
 * One poll tick. Candidates are processed strictly serially (single dispatch
 * authority); `shouldStop` is consulted BETWEEN issues so the current issue
 * always finishes.
 */
export async function runTick(
  deps: DaemonDeps,
  shouldStop: () => boolean = () => false,
): Promise<TickResult> {
  const result = await pollTick(
    deps.gateway,
    deps.teamKey,
    deps.log,
    deps.onlyIssues,
  );
  const decisions: TickResult["decisions"] = [];

  // pollTick already restricted reads to the scope; this second filter is a
  // belt-and-suspenders guard so a scoped run can never act on an issue the
  // poller surfaced through some other path (e.g. lane-conflict remediation).
  const candidates = deps.onlyIssues
    ? result.candidates.filter((c) => deps.onlyIssues!.has(c.issue.identifier))
    : result.candidates;
  if (deps.onlyIssues) {
    deps.log.info("issue scope active", {
      scope: [...deps.onlyIssues],
      inScope: candidates.length,
    });
  }

  for (const candidate of candidates) {
    if (shouldStop()) {
      deps.log.info("stop requested — skipping remaining candidates", {
        remaining: candidates.length - decisions.length,
      });
      return { decisions, stopped: true };
    }
    const id = candidate.issue.identifier;

    try {
      const preflight = evaluatePreflight(candidate.issue);
      if (preflight.blocked) {
        if (
          hasPreflightOverride(
            candidate.issue,
            candidate.comments,
            preflight,
            deps.trust,
          )
        ) {
          // Operator override: the daemon blocked this once (marker comment
          // exists) and someone removed the blocker label — never re-block,
          // route normally.
          deps.log.info(
            "preflight override — marker present and blocker label removed; routing normally",
            { issue: id, label: preflight.label },
          );
        } else {
          const wrote = await applyPreflightBlock(
            deps.gateway,
            candidate.issue,
            candidate.comments,
            preflight,
          );
          deps.log.info("preflight blocked", {
            issue: id,
            label: preflight.label,
            reason: preflight.reason,
            wrote,
          });
          decisions.push({ issue: id, kind: "block" });
          continue;
        }
      }

      const view = await buildStoreView(deps, candidate);
      const action = decideAction(candidate, view);
      deps.log.info("decision", {
        issue: id,
        state: candidate.issue.state,
        lane: candidate.lane,
        kind: action.kind,
        ...(action.kind === "launch"
          ? { phase: action.phase, runner: action.runner, repair: action.repair }
          : {}),
        ...(action.kind === "advance" ? { toStatus: action.toStatus } : {}),
        ...(action.kind === "block" ? { label: action.label } : {}),
        ...("reason" in action ? { reason: action.reason } : {}),
        externalWorkerSignals: view.externalWorkerSignals,
      });
      await deps.execute(action, candidate);
      decisions.push({ issue: id, kind: action.kind });
    } catch (e) {
      // One issue's failure never takes down the tick for the others.
      deps.log.error("candidate processing failed", {
        issue: id,
        error: String(e),
      });
    }
  }

  return { decisions, stopped: false };
}

export interface RunDaemonOptions {
  pollIntervalSeconds: number;
  /** Single tick then return (tracer/observability mode). */
  once?: boolean;
  controller?: DaemonController;
  /** Injectable for tests. */
  sleepGranularityMs?: number;
}

/**
 * The daemon loop: tick, sleep, repeat until stopped. PollAbortedError is a
 * clean skip (nothing was written); anything else is logged and the loop
 * continues. Shutdown finishes the current issue and leaves detached workers
 * running.
 */
export async function runDaemon(
  deps: DaemonDeps,
  options: RunDaemonOptions,
): Promise<void> {
  const controller = options.controller ?? createDaemonController();
  const granularity = options.sleepGranularityMs ?? 200;

  for (;;) {
    try {
      const tick = await runTick(deps, () => controller.stopping);
      deps.log.info("tick complete", {
        decided: tick.decisions.length,
        stopped: tick.stopped,
      });
    } catch (e) {
      if (e instanceof PollAbortedError) {
        deps.log.warn("poll tick aborted — retrying next interval", {
          error: e.message,
        });
      } else {
        deps.log.error("tick failed", { error: String(e) });
      }
    }

    if (options.once === true || controller.stopping) return;

    const deadline = Date.now() + options.pollIntervalSeconds * 1000;
    while (Date.now() < deadline) {
      if (controller.stopping) return;
      await new Promise((r) =>
        setTimeout(r, Math.min(granularity, deadline - Date.now())),
      );
    }
  }
}
