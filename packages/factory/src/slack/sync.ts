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
 *   - handleAction(action): route an answer-form button click (block_actions
 *     over the same Socket Mode connection) — option/retry buttons run the
 *     shared relay core; "Other…" posts typing instructions.
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
import type {
  SlackBlockAction,
  SlackGateway,
  SlackInboundMessage,
} from "./client.js";
import {
  buildQuestionBlocks,
  buildRetryBlocks,
  parseAnswerForm,
  OTHER_ACTION_ID,
  RETRY_ACTION_ID,
  type AnswerButtonValue,
} from "./questions.js";
import { relayAnswer, relayInboundMessage, type RelayDeps } from "./relay.js";
import {
  buildIssueStatus,
  formatIssueStatusLive,
  isStatusKeyword,
  type LiveIssueFacts,
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

/**
 * The question-protocol comment prefix workers use when they record a hard
 * blocker with numbered questions (`blocker:<ID>:<phase> — @operator`).
 */
const QUESTION_COMMENT_PREFIX = "blocker:";

/**
 * The operator-facing question for a blocked issue. Comments arrive
 * OLDEST-FIRST (LinearGateway invariant), so scanning from the end finds the
 * newest. A `blocker:` question-protocol comment wins over any other
 * non-marker comment — a worker's later progress note must never be quoted as
 * "the question" (observed live on THINK-274: the escalation quoted a
 * status report that literally said "No user input required" while the real
 * numbered question sat two comments later).
 */
export function newestQuestion(
  comments: readonly LinearCommentSnapshot[],
): LinearCommentSnapshot | null {
  for (let i = comments.length - 1; i >= 0; i--) {
    const first = (comments[i].body.trimStart().split("\n", 1)[0] ?? "").trim();
    if (first.startsWith(QUESTION_COMMENT_PREFIX)) return comments[i];
  }
  for (let i = comments.length - 1; i >= 0; i--) {
    if (!isDaemonMarkerComment(comments[i].body)) return comments[i];
  }
  return null;
}

const NEEDS_USER = "Needs User";

/**
 * Slack-formatted issue reference: a link to the Linear issue when the URL is
 * known, bold text otherwise. Every operator-facing mention of THINK-x should
 * be clickable — the operator steers from Slack and must never need to go
 * hunting for the issue.
 */
export function issueRef(
  identifier: string,
  url?: string | null,
): string {
  return url ? `<${url}|${identifier}>` : `*${identifier}*`;
}

/**
 * When `Needs User` came from the DAEMON (attempt ceiling, quota expiry, lane
 * conflict) there is no worker `blocker:` question — the newest
 * `factory-block:` marker comment carries the actual reason. Surfacing it
 * beats the useless "an answer is needed to resume" (live THINK-275: two
 * failed implements escalated with no question comment, and the operator was
 * told to go check Linear).
 */
export function newestFactoryBlock(
  comments: readonly LinearCommentSnapshot[],
): LinearCommentSnapshot | null {
  for (let i = comments.length - 1; i >= 0; i--) {
    const first = (comments[i].body.trimStart().split("\n", 1)[0] ?? "").trim();
    if (first.startsWith("factory-block:")) return comments[i];
  }
  return null;
}

/** A factory-block comment's body without its marker first line. */
function factoryBlockReason(comment: LinearCommentSnapshot): string {
  const idx = comment.body.indexOf("\n");
  return idx === -1 ? comment.body : comment.body.slice(idx + 1).trim();
}

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
   * Route an answer-form button click (`block_actions` over Socket Mode):
   * option/retry buttons run the shared relay core; "Other…" posts typing
   * instructions. Malformed or unmapped clicks log and are ignored.
   */
  handleAction(action: SlackBlockAction): Promise<void>;
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
        url: candidate.issue.url,
      },
      threadDeps,
    );
  }

  async function maybeEscalate(
    candidate: PollCandidate,
    ref: ThreadRef,
  ): Promise<void> {
    const question = newestQuestion(candidate.comments);
    const block = question === null ? newestFactoryBlock(candidate.comments) : null;
    const key = question?.id ?? block?.id ?? "blocked-no-comment";
    const row = deps.store.getSlackThreadByIssue(candidate.issue.id);
    if (row?.last_escalated_key === key) return; // already mirrored this one
    const link = issueRef(candidate.issue.identifier, candidate.issue.url);
    let body: string;
    if (question !== null) {
      body = question.body;
      if (question.url) body += `\n\n<${question.url}|Open the question in Linear>`;
    } else if (block !== null) {
      body = factoryBlockReason(block);
      if (block.url) body += `\n\n<${block.url}|Open in Linear>`;
    } else {
      body = `Blocked on \`${NEEDS_USER}\` with no recorded question — see ${link} in Linear.`;
    }
    const text = `${link} needs an answer (\`${NEEDS_USER}\`) — reply here to answer, \`question\` to re-show it.\n\n${body}`;
    // Interactive answer form: a worker question carrying a parseable
    // ```answers fence renders as option buttons; everything else (a daemon
    // factory-block ceiling, a fence-less question) gets the retry/Other pair.
    // The plain text stays as the notification fallback either way.
    const form = question !== null ? parseAnswerForm(question.body) : null;
    const blocks =
      form !== null
        ? buildQuestionBlocks(candidate.issue.identifier, key, form, text)
        : buildRetryBlocks(candidate.issue.identifier, key, text);
    const escalationTs = await postEscalation(ref, text, threadDeps, blocks);
    deps.store.setSlackThreadMarker(candidate.issue.id, "last_escalated_key", key);
    // Remember the escalation MESSAGE ts so a button click can chat.update it
    // (strip the buttons once answered — no double-fire surface left behind).
    deps.store.setSlackThreadMarker(
      candidate.issue.id,
      "last_escalated_ts",
      escalationTs,
    );
    deps.log.info("slack escalation posted", {
      issue: candidate.issue.identifier,
      key,
      form: form !== null,
    });
  }

  async function maybeMilestone(
    candidate: PollCandidate,
    action: EngineAction,
    ref: ThreadRef,
  ): Promise<void> {
    let key: string;
    let text: string;
    const link = issueRef(candidate.issue.identifier, candidate.issue.url);
    if (action.kind === "launch") {
      key = `launch:${action.phase}`;
      text = `:rocket: Launched *${action.phase}* on ${link}.`;
    } else if (action.kind === "advance") {
      key = `advance:${action.toStatus}`;
      text = `:arrow_right: ${link} → ${action.toStatus}.`;
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
      // Status/labels come from a LIVE Linear read — the store's issue row
      // only refreshes when a launch settles, and answering from it alone
      // reported "Ready to Work" while Linear showed Verification. The store
      // still supplies worker attempts, and serves as a labeled fallback when
      // Linear is unreachable.
      if (message.threadTs !== null && isStatusKeyword(message.text)) {
        const row = deps.store.getSlackThreadByThreadTs(
          message.channel,
          message.threadTs,
        );
        if (row !== undefined) {
          const stored = buildIssueStatus(deps.store, row.issue_id);
          let live: LiveIssueFacts | null = null;
          try {
            const [snap] = await deps.gateway.getIssuesByIdentifier([
              row.identifier,
            ]);
            if (snap !== undefined && snap.state !== "") {
              live = { state: snap.state, labels: snap.labels, url: snap.url };
            }
          } catch (e) {
            deps.log.warn(
              "slack status: live Linear read failed — answering from the store",
              { issue: row.identifier, error: String(e) },
            );
          }
          const text = formatIssueStatusLive(row.identifier, live, stored);
          await deps.slack
            .postThreadReply(message.channel, message.threadTs, text)
            .catch((e: unknown) =>
              deps.log.warn("slack status reply failed", { error: String(e) }),
            );
          return;
        }
      }
      // A `question` keyword re-shows the open question WITHOUT relaying.
      // Before this existed, an operator asking "what's the question?" in a
      // blocked thread had that message relayed VERBATIM as the answer —
      // clearing the blocker and steering the relaunched worker with garbage
      // (observed live on THINK-274).
      if (message.threadTs !== null && isQuestionKeyword(message.text)) {
        const row = deps.store.getSlackThreadByThreadTs(
          message.channel,
          message.threadTs,
        );
        if (row !== undefined) {
          let text: string;
          try {
            const [snap] = await deps.gateway.getIssuesByIdentifier([
              row.identifier,
            ]);
            const link = issueRef(row.identifier, snap?.url);
            if (snap === undefined) {
              text = `${row.identifier}: not found in Linear.`;
            } else if (!snap.labels.includes(NEEDS_USER)) {
              text = `${link} has no open question (no \`${NEEDS_USER}\` blocker) — current status: ${snap.state}.`;
            } else {
              const comments = await deps.gateway.listComments(row.issue_id);
              const question = newestQuestion(comments);
              const block = question === null ? newestFactoryBlock(comments) : null;
              if (question !== null) {
                text = `Open question on ${link}:\n\n${question.body}`;
                if (question.url)
                  text += `\n\n<${question.url}|Open the question in Linear>`;
              } else if (block !== null) {
                text = `${link} was blocked by the daemon (no worker question):\n\n${factoryBlockReason(block)}`;
                if (block.url) text += `\n\n<${block.url}|Open in Linear>`;
              } else {
                text = `${link} is blocked on \`${NEEDS_USER}\` but has no recorded question or block reason.`;
              }
            }
          } catch (e) {
            deps.log.warn("slack question lookup failed", {
              issue: row.identifier,
              error: String(e),
            });
            text = `Sorry — couldn't reach Linear to look up ${row.identifier}'s open question. Try again in a moment.`;
          }
          await deps.slack
            .postThreadReply(message.channel, message.threadTs, text)
            .catch((e: unknown) =>
              deps.log.warn("slack question reply failed", { error: String(e) }),
            );
          return;
        }
      }
      // Otherwise: the answer round-trip.
      await relayInboundMessage(message, relayDeps);
    },

    async handleAction(action) {
      // A click on an escalation is always inside a mapped thread (escalations
      // are thread replies). No thread ts / no row → some other message; ignore.
      if (action.threadTs === null) {
        deps.log.debug("slack action: no thread ts — ignored", {
          actionId: action.actionId,
        });
        return;
      }
      const row = deps.store.getSlackThreadByThreadTs(
        action.channel,
        action.threadTs,
      );
      if (row === undefined) {
        deps.log.debug("slack action: unmapped thread — ignored", {
          threadTs: action.threadTs,
          actionId: action.actionId,
        });
        return;
      }

      // Button values are OUR JSON — but be tolerant anyway (a stale message
      // from an older build, a re-installed app): malformed → log + ignore.
      let value: AnswerButtonValue;
      try {
        const parsed: unknown = JSON.parse(action.value);
        if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
        value = parsed as AnswerButtonValue;
      } catch {
        deps.log.warn("slack action: malformed button value — ignored", {
          issue: row.identifier,
          actionId: action.actionId,
          value: action.value.slice(0, 200),
        });
        return;
      }

      // "Other…" — the escape hatch: instruct, relay nothing, change nothing.
      if (action.actionId === OTHER_ACTION_ID) {
        await deps.slack
          .postThreadReply(
            action.channel,
            action.threadTs,
            "Reply in this thread with your answer — it will be relayed verbatim as the operator answer.",
          )
          .catch((e: unknown) =>
            deps.log.warn("slack action: other-instruction post failed", {
              issue: row.identifier,
              error: String(e),
            }),
          );
        return;
      }

      // Resolve the answer text for the two relaying buttons.
      let answer: string;
      if (action.actionId === RETRY_ACTION_ID) {
        answer =
          "Retry: operator cleared the blocker via Slack without additional guidance — re-attempt from the newest baton and prior evidence.";
      } else if (typeof value.answer === "string" && value.answer.trim() !== "") {
        answer = value.answer;
      } else {
        deps.log.warn("slack action: option button without an answer value — ignored", {
          issue: row.identifier,
          actionId: action.actionId,
        });
        return;
      }

      // The shared relay core: authorization → question-state → baton →
      // clear blocker → mirror → ack. Its no-open-question check makes a
      // SECOND click a polite no-op (the first relay removed `Needs User`),
      // so clicks need no ts high-water mark of their own.
      const result = await relayAnswer(relayDeps, {
        channel: action.channel,
        threadTs: action.threadTs,
        identifier: row.identifier,
        issueId: row.issue_id,
        userId: action.userId,
        answer,
        source: "button",
      });

      // On success, strip the buttons from the escalation message so the form
      // cannot fire again — replace it with an answered summary. Best-effort:
      // the answer is already injected; a failed edit only leaves stale
      // buttons, and a re-click is a polite no-op anyway.
      if (result.relayed && row.last_escalated_ts !== null) {
        const excerpt = answer.trim().replace(/\s+/g, " ").slice(0, 120);
        const summary = `✅ Answered by <@${action.userId}>: ${excerpt}`;
        await deps.slack
          .updateMessage(action.channel, row.last_escalated_ts, summary, [
            { type: "section", text: { type: "mrkdwn", text: summary } },
          ])
          .catch((e: unknown) =>
            deps.log.warn("slack action: escalation update failed — stale buttons remain", {
              issue: row.identifier,
              ts: row.last_escalated_ts,
              error: String(e),
            }),
          );
      }
    },
  };
}

/**
 * True when an in-thread message asks to SEE the open question rather than
 * answer it. Deliberately covers the natural phrasings an operator actually
 * types ("what's the question?"), not just the bare keyword — relaying a
 * meta-question as the answer is the single most destructive misread this
 * surface can make.
 */
export function isQuestionKeyword(text: string): boolean {
  const t = text
    .replace(/<@[^>]+>/g, "")
    .trim()
    .toLowerCase();
  if (/^(question|q|why)\??$/.test(t)) return true;
  return /^what('|’)?s?\s+(is\s+)?the\s+q(u?e?s?t?i?o?n?)?\??$/.test(t);
}
