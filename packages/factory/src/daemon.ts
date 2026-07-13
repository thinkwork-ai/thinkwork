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
import {
  decideAction,
  phaseForStatus,
  type EngineAction,
  type StoreView,
} from "./phases/engine.js";
import { classifyQuota } from "./sweep/quota.js";
import { devLockHeldByOther } from "./sweep/locks.js";
import { runSweep, type SweepResult } from "./sweep/classifier.js";
import type { FiredNag } from "./sweep/nags.js";
import type { SlackSync } from "./slack/sync.js";
import { runUnenrollPass } from "./reconcile/unenroll.js";
import { writeHeartbeat } from "./heartbeat.js";
import { parseWaitingOn } from "./linear/ledger.js";

/** Trailing terminal states that count as a "kill" for the attempt ceiling. */
const KILL_TERMINALS = new Set(["Stalled", "TimedOut", "Failed"]);

/**
 * Default cadence for the INDEPENDENT heartbeat interval (KTD-6). The daemon
 * stamps the heartbeat file on this timer regardless of tick progress, so a
 * long-running worker (implement can run for wallClockSlaMinutes) never lets
 * the file age past the watchdog's overdue threshold. The interval callback
 * fires on the event loop even while a tick is awaiting async worker I/O — so
 * the file stays fresh during a long tick, but goes stale precisely when the
 * event loop genuinely hangs (which is what the watchdog must catch).
 */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

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
  /**
   * Slack surface (U8). Purely additive: when omitted the daemon runs exactly
   * as before (Linear-only). When present, each processed candidate is
   * mirrored to its Slack thread AFTER the real Linear/store work — a Slack
   * failure is caught here and never blocks phase progress.
   */
  slack?: SlackSync;

  // ---- U6 no-orphan sweep wiring (all optional; sensible defaults) --------
  /** Injected clock for every sweep timer/SLA/quota computation (tests fake it). */
  now?: () => Date;
  /** Per-phase silence budget for stall detection (default 10 min when absent). */
  silenceBudgetMinutesFor?: (phase: string) => number;
  /** Quota cooldown window in minutes (default 30). */
  quotaCooldownMinutes?: number;
  /** Lease TTL in minutes (default 15). */
  leaseTtlMinutes?: number;
  /**
   * Nag delivery seam (wired to the Slack surface's postNag). Absent → due nags
   * enqueue to the store outbox for U8 to flush.
   */
  deliverNag?: (nag: FiredNag) => Promise<void>;

  // ---- U7 reboot/crash survival wiring (all optional) ---------------------
  /**
   * Heartbeat file the daemon stamps once per poll cycle (U7, KTD-6). The
   * INDEPENDENT watchdog reads this file's age to detect daemon silence. Absent
   * → no heartbeat is written (tests that don't exercise reboot survival).
   */
  heartbeatPath?: string;
  /**
   * Reconciliation pass (U7, F4/AE6). Run once at boot BEFORE the first tick
   * and then every `reconcileEveryTicks` ticks (see RunDaemonOptions). Repairs
   * orphaned attempts, adopts externally-merged PRs, and rebuilds a deleted
   * store. Absent → no reconciliation (backward compatible with U5/U6).
   */
  reconcile?: () => Promise<unknown>;
}

/** Default per-phase silence budget when the daemon is not given a config lookup. */
const DEFAULT_SILENCE_BUDGET_MINUTES = 10;

/**
 * Run the no-orphan sweep, isolated so a sweep failure never crashes the tick
 * (mirrors the Slack-sync isolation contract). Returns the sweep result on
 * success, or null when the sweep threw.
 */
async function runSweepIsolated(
  deps: DaemonDeps,
  candidates: readonly PollCandidate[],
): Promise<SweepResult | null> {
  try {
    return await runSweep(candidates, {
      store: deps.store,
      transport: deps.transport,
      now: deps.now ?? (() => new Date()),
      silenceBudgetMinutesFor:
        deps.silenceBudgetMinutesFor ??
        (() => DEFAULT_SILENCE_BUDGET_MINUTES),
      quotaCooldownMinutes: deps.quotaCooldownMinutes,
      leaseTtlMinutes: deps.leaseTtlMinutes,
      log: deps.log,
      deliverNag: deps.deliverNag,
    });
  } catch (e) {
    deps.log.error("no-orphan sweep failed — continuing tick", {
      error: String(e),
    });
    return null;
  }
}

/**
 * Un-enrollment pass, isolated so a failure never crashes the tick (same
 * contract as the Slack sync / sweep). Runs AFTER the decide/execute pass: the
 * pass only touches enrolled issues that are NOT in this tick's candidate set
 * (abandoned/gone) plus terminally-completed candidates — disjoint from the
 * issues decide/execute launched/advanced, so order is safe either way; after
 * is chosen so an issue completed THIS tick closes its thread the same tick.
 * SKIPPED under a scoped (`onlyIssues`) run, where "not in the candidate set"
 * means "out of scope", not "left the queue".
 */
async function runUnenrollIsolated(
  deps: DaemonDeps,
  candidates: readonly PollCandidate[],
): Promise<void> {
  if (deps.onlyIssues !== undefined) return;
  try {
    await runUnenrollPass(
      {
        store: deps.store,
        gateway: deps.gateway,
        transport: deps.transport,
        log: deps.log,
        slack: deps.slack,
      },
      candidates,
    );
  } catch (e) {
    deps.log.error("un-enroll pass failed — continuing tick", {
      error: String(e),
    });
  }
}

/** Mirror one processed candidate to Slack; swallow + log any failure. */
async function syncSlack(
  deps: DaemonDeps,
  candidate: PollCandidate,
  action: EngineAction,
): Promise<void> {
  if (deps.slack === undefined) return;
  try {
    await deps.slack.syncCandidate(candidate, action);
  } catch (e) {
    deps.log.warn("slack sync failed — continuing (Slack is never load-bearing)", {
      issue: candidate.issue.identifier,
      error: String(e),
    });
  }
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
  deps: Pick<
    DaemonDeps,
    "gateway" | "store" | "transport" | "repoPath" | "now" | "quotaCooldownMinutes"
  >,
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

  // Child issues: children drive parents. States feed the all-finished rule;
  // a fetch failure degrades to "in flight" (fail-safe wait).
  let childStates: string[] | null = null;
  try {
    childStates = await deps.gateway.childIssueStates(issue.id);
  } catch {
    childStates = null;
  }
  // Fetch failure (null) counts as "children in unknown states" — the engine
  // then waits one tick rather than acting on unknown structure.
  const hasChildIssues = childStates === null ? true : childStates.length > 0;

  // Cross-issue dependency (`waiting-on: THINK-x` ledger blocker): resolve the
  // dependency's live state so the engine can wait/resume without a human.
  let dependency: StoreView["dependency"] = null;
  const waitingOn = parseWaitingOn(candidate.ledger.ledger.blocker);
  if (waitingOn !== null) {
    try {
      const [dep] = await deps.gateway.getIssuesByIdentifier([waitingOn]);
      dependency =
        dep === undefined
          ? { identifier: waitingOn, state: "unknown", done: false }
          : { identifier: waitingOn, state: dep.state, done: dep.state === "Done" };
    } catch {
      // Unreachable Linear → keep waiting (never a false resume).
      dependency = { identifier: waitingOn, state: "unknown", done: false };
    }
  }

  // ---- U6 signals: quota cooldown, attempt ceiling, dev-deployment lock. ----
  const now = deps.now?.() ?? new Date();
  const quotaVerdict = classifyQuota(
    deps.store,
    issue.id,
    now,
    deps.quotaCooldownMinutes,
  );
  const quota: StoreView["quota"] =
    quotaVerdict.kind === "cooldown"
      ? { kind: "cooldown", until: quotaVerdict.until.toISOString() }
      : quotaVerdict.kind === "expired"
        ? { kind: "expired" }
        : null;

  // Trailing consecutive kill/stall count for the phase this status would
  // launch (attempts come back newest-first; a non-kill terminal resets it).
  const consecutiveKillsByPhase: Record<string, number> = {};
  const targetPhase = phaseForStatus(issue.state);
  if (targetPhase !== null) {
    let kills = 0;
    for (const a of deps.store.listAttemptsForPhase(issue.id, targetPhase)) {
      if (KILL_TERMINALS.has(a.state)) kills += 1;
      else break;
    }
    consecutiveKillsByPhase[targetPhase] = kills;
  }

  return {
    activeAttempt,
    hasChildIssues,
    childStates,
    dependency,
    externalWorkerSignals,
    quota,
    consecutiveKillsByPhase,
    devLockHeldByOther: devLockHeldByOther(deps.store, issue.id),
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

  // ---- No-orphan sweep (U6): reconcile liveness/leases/quota/nags into the
  // store BEFORE deciding, so decideAction sees post-sweep reality (a settled
  // stalled/dead attempt frees its slot → relaunch this same tick). A sweep
  // failure must never crash the tick — wrap + log, exactly like the Slack
  // sync. ----
  await runSweepIsolated(deps, candidates);

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
          // Mirror the preflight block to Slack (thread + escalation) so the
          // operator sees a credential/ambiguity block the same as any other.
          await syncSlack(deps, candidate, {
            kind: "block",
            label: preflight.label ?? "Needs User",
            reason: preflight.reason ?? "preflight block",
          });
          decisions.push({ issue: id, kind: "block" });
          continue;
        }
      }

      const view = await buildStoreView(deps, candidate);
      // Thread the daemon's trust allowlist so the escalation-override marker
      // check is author-gated (an untrusted commenter must not be able to
      // pre-post a `factory-block:` marker to pre-empt a ceiling/quota
      // escalation). PollCandidate carries comments; trust is added here.
      const action = decideAction({ ...candidate, trust: deps.trust }, view);
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
      // Slack mirror runs AFTER the real work, isolated from it.
      await syncSlack(deps, candidate, action);
      decisions.push({ issue: id, kind: action.kind });
    } catch (e) {
      // One issue's failure never takes down the tick for the others.
      deps.log.error("candidate processing failed", {
        issue: id,
        error: String(e),
      });
    }
  }

  // Un-enrollment pass (enrollment lifecycle): after the decide/execute pass,
  // wind down enrolled issues that left the active work queue (moved to
  // Backlog/Canceled, lost their lane label, deleted) or finished (Done with
  // nothing left to compound). Isolated so a failure never crashes the tick.
  await runUnenrollIsolated(deps, candidates);

  // Pinned live board (U9, KTD4): once per tick, AFTER un-enroll (done-today
  // is recorded there). Best-effort — a Slack outage never fails the tick.
  if (deps.slack !== undefined) {
    try {
      await deps.slack.updateBoard(candidates);
    } catch (e) {
      deps.log.warn("board update failed — continuing (Slack is never load-bearing)", {
        error: String(e),
      });
    }
  }

  return { decisions, stopped: false };
}

/**
 * Cooldown after a tick that failed on a Linear API rate limit (2,500 req/hr
 * per API key, rolling window). Retrying at the normal poll interval keeps the
 * window saturated forever — the 2026-07-13 incident retried every ~35s for
 * 40+ minutes without ever recovering. Fifteen minutes lets a meaningful
 * fraction of the rolling window drain before the next attempt.
 */
export const RATE_LIMIT_COOLDOWN_SECONDS = 900;

/**
 * True when an error (however wrapped) is a Linear API rate-limit rejection.
 * Matched on message text across the cause chain: the SDK surfaces
 * "Rate limit exceeded" for 429s, and raw GraphQL errors carry RATELIMITED
 * extension codes; both arrive here wrapped in PollAbortedError/plain Errors.
 */
export function isRateLimitError(e: unknown): boolean {
  const parts: string[] = [];
  let cursor: unknown = e;
  for (let depth = 0; depth < 5 && cursor !== undefined && cursor !== null; depth++) {
    parts.push(cursor instanceof Error ? cursor.message : String(cursor));
    cursor = cursor instanceof Error ? cursor.cause : undefined;
  }
  const text = parts.join(" ");
  return /rate ?limit/i.test(text) || /RATELIMITED/.test(text);
}

export interface RunDaemonOptions {
  pollIntervalSeconds: number;
  /**
   * Sleep THIS long (instead of `pollIntervalSeconds`) after a tick that
   * failed on a Linear rate limit. Defaults to RATE_LIMIT_COOLDOWN_SECONDS;
   * the effective sleep is never shorter than the normal poll interval.
   */
  rateLimitCooldownSeconds?: number;
  /** Single tick then return (tracer/observability mode). */
  once?: boolean;
  controller?: DaemonController;
  /** Injectable for tests. */
  sleepGranularityMs?: number;
  /**
   * Run `deps.reconcile` every N ticks (in addition to the boot pass). 0 or
   * undefined disables the PERIODIC pass; the boot pass still runs whenever
   * `deps.reconcile` is present.
   */
  reconcileEveryTicks?: number;
  /**
   * Cadence of the independent heartbeat interval (ms). Defaults to
   * `min(pollIntervalSeconds*1000, DEFAULT_HEARTBEAT_INTERVAL_MS)` so it never
   * lags the poll interval. Injectable for deterministic tests.
   */
  heartbeatIntervalMs?: number;
}

/** Run a reconciliation pass, isolated so a failure never crashes the loop. */
async function runReconcileIsolated(
  deps: DaemonDeps,
  phase: "boot" | "periodic",
): Promise<void> {
  if (deps.reconcile === undefined) return;
  try {
    await deps.reconcile();
  } catch (e) {
    deps.log.error(`${phase} reconcile failed — continuing`, {
      error: String(e),
    });
  }
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

  // Independent heartbeat interval (KTD-6). DECOUPLED from the tick: the tick
  // awaits driveAttempt for the worker's entire run (up to wallClockSlaMinutes),
  // so a heartbeat stamped only per-cycle would go stale for the whole run and
  // trip the watchdog's overdue threshold on EVERY worker >5min. Stamping on a
  // self-scheduling interval keeps the file fresh while the loop is merely
  // awaiting async worker I/O, yet lets it go stale if the event loop genuinely
  // hangs — exactly the condition the watchdog should catch. Unref'd so the
  // timer alone never keeps the process alive.
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  const stampHeartbeat = (): void => {
    if (deps.heartbeatPath === undefined) return;
    try {
      writeHeartbeat(deps.heartbeatPath, new Date());
    } catch (e) {
      deps.log.warn("heartbeat write failed", { error: String(e) });
    }
  };
  if (deps.heartbeatPath !== undefined) {
    // Stamp once immediately so the watchdog sees liveness before the first
    // (possibly long) tick, then let the interval carry it.
    stampHeartbeat();
    const intervalMs = Math.max(
      1,
      Math.min(
        options.heartbeatIntervalMs ??
          Math.min(
            options.pollIntervalSeconds * 1000,
            DEFAULT_HEARTBEAT_INTERVAL_MS,
          ),
        DEFAULT_HEARTBEAT_INTERVAL_MS,
      ),
    );
    heartbeatTimer = setInterval(stampHeartbeat, intervalMs);
    // Node's Timeout has unref(); guard for exotic timer shims in tests.
    heartbeatTimer.unref?.();
  }

  try {
    // Boot reconciliation (U7, F4): repair partial state left by a crash/reboot
    // BEFORE the first tick, so decide() sees a consistent world (an orphaned
    // attempt is expired here → the first tick relaunches it; a merged PR is
    // adopted here → the first tick advances instead of relaunching).
    await runReconcileIsolated(deps, "boot");

    let tickCount = 0;
    for (;;) {
      // Rate-limit backoff: a rate-limited tick extends THIS iteration's sleep
      // to the cooldown so the daemon stops hammering a saturated window.
      let sleepSeconds = options.pollIntervalSeconds;
      try {
        const tick = await runTick(deps, () => controller.stopping);
        deps.log.info("tick complete", {
          decided: tick.decisions.length,
          stopped: tick.stopped,
        });
      } catch (e) {
        if (isRateLimitError(e)) {
          sleepSeconds = Math.max(
            options.pollIntervalSeconds,
            options.rateLimitCooldownSeconds ?? RATE_LIMIT_COOLDOWN_SECONDS,
          );
          deps.log.warn(
            "tick hit the Linear API rate limit — cooling down before retry",
            { cooldownSeconds: sleepSeconds, error: String(e) },
          );
        } else if (e instanceof PollAbortedError) {
          deps.log.warn("poll tick aborted — retrying next interval", {
            error: e.message,
          });
        } else {
          deps.log.error("tick failed", { error: String(e) });
        }
      }

      tickCount += 1;
      // Periodic reconciliation (U7): routinely re-repair drift while running.
      if (
        options.reconcileEveryTicks !== undefined &&
        options.reconcileEveryTicks > 0 &&
        tickCount % options.reconcileEveryTicks === 0
      ) {
        await runReconcileIsolated(deps, "periodic");
      }

      if (options.once === true || controller.stopping) return;

      const deadline = Date.now() + sleepSeconds * 1000;
      while (Date.now() < deadline) {
        if (controller.stopping) return;
        await new Promise((r) =>
          setTimeout(r, Math.min(granularity, deadline - Date.now())),
        );
      }
    }
  } finally {
    if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
  }
}
