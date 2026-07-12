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

export interface SlackSync {
  syncCandidate(candidate: PollCandidate, action: EngineAction): Promise<void>;
  handleInbound(message: SlackInboundMessage): Promise<void>;
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
      const ref = await ensureThread(candidate);
      // A live `Needs User` blocker takes priority: escalate the question.
      if (candidate.blockerLabels.includes(NEEDS_USER)) {
        await maybeEscalate(candidate, ref);
        return;
      }
      await maybeMilestone(candidate, action, ref);
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
