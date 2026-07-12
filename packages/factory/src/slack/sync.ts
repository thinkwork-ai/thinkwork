/**
 * Daemon ↔ Slack coordinator (U8 wiring). Purely additive: when Slack is not
 * configured the daemon never constructs this, and runs exactly as before.
 *
 * Two responsibilities:
 *   - syncCandidate(candidate, action): per tick, per issue — open the thread
 *     (idempotent enrollment), mirror a `Needs User` question as an @mention
 *     escalation, and post phase milestones without an @mention. Every Slack
 *     call is best-effort: a Slack outage logs and continues, NEVER blocking
 *     phase progress (the caller also wraps this, belt and suspenders).
 *   - handleInbound(message): route an inbound Socket Mode message — a bare
 *     `status` keyword answers with the issue's state; anything else goes to
 *     the inbound relay (the answer round-trip).
 *
 * Outbound posts are deduped with idempotency keys persisted on the
 * slack_threads row (last_escalated_key / last_milestone_key), so repeated
 * ticks over an unchanged issue post nothing new.
 */

import type { LinearCommentSnapshot, CommentTrust, LinearGateway } from "../linear/client.js";
import type { Logger } from "../logger.js";
import type { EngineAction } from "../phases/engine.js";
import type { PollCandidate } from "../linear/poller.js";
import type { FactoryStore } from "../store/db.js";
import type { SlackGateway, SlackInboundMessage } from "./client.js";
import { relayInboundMessage, type RelayDeps } from "./relay.js";
import {
  buildIssueStatus,
  formatIssueStatus,
  isStatusKeyword,
} from "./status.js";
import {
  openThreadForIssue,
  postClosingSummary,
  postEscalation,
  postMilestone,
  type ThreadDeps,
  type ThreadRef,
} from "./threads.js";

/** Marker prefixes for daemon-authored comments (never the "question"). */
const DAEMON_MARKER_PREFIXES = [
  "automation-ledger:",
  "handoff:",
  "dispatcher:",
  "factory-preflight:",
  "factory-block:",
  "factory-lane-conflict:",
  "slack-relay:",
];

function isDaemonMarkerComment(body: string): boolean {
  const first = (body.trimStart().split("\n", 1)[0] ?? "").trim();
  return DAEMON_MARKER_PREFIXES.some((p) => first.startsWith(p));
}

/** Newest non-marker comment — the operator-facing question, when blocked. */
function newestQuestion(
  comments: readonly LinearCommentSnapshot[],
): LinearCommentSnapshot | null {
  for (let i = comments.length - 1; i >= 0; i--) {
    if (!isDaemonMarkerComment(comments[i].body)) return comments[i];
  }
  return null;
}

const NEEDS_USER = "Needs User";

/**
 * Review-gate statuses whose `wait` (without LFG) is a genuine HUMAN-wait — an
 * operator must act, so the wait warrants a thread. Every OTHER `wait`
 * (KTD-10 running attempt, duplicate-worker guard, quota cooldown, dev-lock) is
 * an internal/transient wait with no operator ask and MUST NOT enroll a thread.
 * Mirrors the sweep's REVIEW_GATE_STATES human-wait classification.
 */
const REVIEW_GATE_STATES = new Set([
  "Requirements Review",
  "Plan Review",
  "Verification",
  "Review",
]);

/**
 * An issue should be ENROLLED (get a Slack thread) only when the daemon
 * actually works it — i.e. the decided action warrants operator visibility.
 * `launch`/`advance`/`block` always do; a `wait` does only when it is a
 * human-wait review gate (or a `Needs User` question); a `noop` never does
 * (Done+compounded, pre-factory Done via the compound cutoff, not-routable).
 * Net effect: a Done issue the daemon only ever noops never gets a thread.
 */
function actionWarrantsThread(
  candidate: PollCandidate,
  action: EngineAction,
): boolean {
  // Done is TERMINAL. A finished issue never opens a thread or escalates on a
  // stale label — the only Done action that warrants operator visibility is a
  // genuine compound `launch` (the engine launches compound only for a
  // factory-driven, not-yet-compounded Done issue, and the `compounded` flag
  // makes that one-shot). This mirrors the engine's own Done-is-terminal guard
  // (the loop fix): without it, an old Done issue carrying a stale `Needs User`
  // or lane label re-opens a thread + @mention every tick even though the
  // engine correctly noops it — the Done-issue Slack churn.
  if (candidate.issue.state === "Done") return action.kind === "launch";
  // A live `Needs User` question always warrants a thread (the escalation).
  if (candidate.blockerLabels.includes(NEEDS_USER)) return true;
  switch (action.kind) {
    case "launch":
    case "advance":
    case "block":
      return true;
    case "wait":
      return (
        REVIEW_GATE_STATES.has(candidate.issue.state) && !candidate.hasLfg
      );
    case "noop":
      return false;
  }
}

export interface SlackSync {
  syncCandidate(candidate: PollCandidate, action: EngineAction): Promise<void>;
  handleInbound(message: SlackInboundMessage): Promise<void>;
  /**
   * Post a terminal closing note into an issue's thread and nothing else — the
   * store-side un-enrollment (deleting the thread row + winding down workers)
   * is the daemon's job. No-op when the issue has no mapped thread. Best-effort:
   * the caller isolates any Slack failure from the store cleanup.
   */
  closeThread(issueId: string, text: string): Promise<void>;
}

export interface SlackSyncDeps {
  slack: SlackGateway;
  store: FactoryStore;
  gateway: LinearGateway;
  channelId: string;
  operatorUserIds: readonly string[];
  log: Logger;
  trust?: CommentTrust;
}

export function createSlackSync(deps: SlackSyncDeps): SlackSync {
  const threadDeps: ThreadDeps = {
    slack: deps.slack,
    store: deps.store,
    channelId: deps.channelId,
    operatorUserIds: deps.operatorUserIds,
    log: deps.log,
  };
  const relayDeps: RelayDeps = {
    gateway: deps.gateway,
    slack: deps.slack,
    store: deps.store,
    operatorUserIds: deps.operatorUserIds,
    log: deps.log,
    trust: deps.trust,
  };

  async function ensureThread(
    candidate: PollCandidate,
  ): Promise<ThreadRef> {
    return openThreadForIssue(
      {
        issueId: candidate.issue.id,
        identifier: candidate.issue.identifier,
        title: candidate.issue.title,
      },
      threadDeps,
    );
  }

  async function maybeEscalate(
    candidate: PollCandidate,
    ref: ThreadRef,
  ): Promise<void> {
    const question = newestQuestion(candidate.comments);
    const key = question?.id ?? "blocked-no-comment";
    const row = deps.store.getSlackThreadByIssue(candidate.issue.id);
    if (row?.last_escalated_key === key) return; // already mirrored this one
    const questionText =
      question?.body ??
      `${candidate.issue.identifier} is blocked on \`${NEEDS_USER}\` — an answer is needed to resume.`;
    await postEscalation(
      ref,
      `*${candidate.issue.identifier}* needs an answer (\`${NEEDS_USER}\`). Reply in this thread to resume:\n\n${questionText}`,
      threadDeps,
    );
    deps.store.setSlackThreadMarker(candidate.issue.id, "last_escalated_key", key);
    deps.log.info("slack escalation posted", {
      issue: candidate.issue.identifier,
      key,
    });
  }

  async function maybeMilestone(
    candidate: PollCandidate,
    action: EngineAction,
    ref: ThreadRef,
  ): Promise<void> {
    let key: string;
    let text: string;
    if (action.kind === "launch") {
      key = `launch:${action.phase}`;
      text = `:rocket: Launched *${action.phase}* on *${candidate.issue.identifier}*.`;
    } else if (action.kind === "advance") {
      key = `advance:${action.toStatus}`;
      text = `:arrow_right: *${candidate.issue.identifier}* → ${action.toStatus}.`;
    } else {
      return;
    }
    const row = deps.store.getSlackThreadByIssue(candidate.issue.id);
    if (row?.last_milestone_key === key) return;
    await postMilestone(ref, text, threadDeps);
    deps.store.setSlackThreadMarker(
      candidate.issue.id,
      "last_milestone_key",
      key,
    );
  }

  return {
    async syncCandidate(candidate, action) {
      // Enroll (open/track a thread) ONLY when the daemon actually works this
      // issue — a bare `noop` gets no thread, no post.
      if (!actionWarrantsThread(candidate, action)) return;
      const ref = await ensureThread(candidate);
      // A live `Needs User` blocker takes priority: escalate the question — but
      // NEVER for a Done issue (a stale label on a finished issue is not a live
      // question; the only Done thread here is a one-shot compound launch).
      if (
        candidate.issue.state !== "Done" &&
        candidate.blockerLabels.includes(NEEDS_USER)
      ) {
        await maybeEscalate(candidate, ref);
        return;
      }
      await maybeMilestone(candidate, action, ref);
    },

    async closeThread(issueId, text) {
      const row = deps.store.getSlackThreadByIssue(issueId);
      if (row === undefined) return; // no thread mapped — nothing to close
      await postClosingSummary(
        { channel: row.channel_id, threadTs: row.thread_ts },
        text,
        threadDeps,
      );
    },

    async handleInbound(message) {
      // A bare `status` in a mapped thread answers with that issue's state.
      if (message.threadTs !== null && isStatusKeyword(message.text)) {
        const row = deps.store.getSlackThreadByThreadTs(
          message.channel,
          message.threadTs,
        );
        if (row !== undefined) {
          const status = buildIssueStatus(deps.store, row.issue_id);
          const text =
            status === null
              ? `${row.identifier}: not tracked in the store yet.`
              : formatIssueStatus(status);
          await deps.slack
            .postThreadReply(message.channel, message.threadTs, text)
            .catch((e: unknown) =>
              deps.log.warn("slack status reply failed", { error: String(e) }),
            );
          return;
        }
      }
      // Otherwise: the answer round-trip.
      await relayInboundMessage(message, relayDeps);
    },
  };
}
