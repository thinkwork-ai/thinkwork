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
import { section } from "./blocks.js";
import type { GithubGateway } from "../phases/evidence.js";
import { createBoardUpdater, BOARD_RENDER_KEY } from "./board.js";
import {
  CONSOLE_ACTION_PREFIX,
  REPO_VERBS,
  actionsForState,
  helpText,
  mergedPrNoteActions,
  parseVerb,
  runConsoleAction,
  runRepoAction,
  type ConsoleButtonValue,
  type ConsoleDeps,
  type ConsoleExecutor,
  type ConsoleVerb,
  type RepoExecutor,
} from "./console.js";
import {
  buildQuestionBlocks,
  buildRetryBlocks,
  parseAnswerForm,
  OTHER_ACTION_ID,
  RETRY_ACTION_ID,
  type AnswerButtonValue,
} from "./questions.js";
import { relayAnswer, relayInboundMessage, RETRY_ANSWER_TEXT, type RelayDeps } from "./relay.js";
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
 * The status a launch reads as on the board (R1/AE1): an implement launch's
 * Running hook moves the issue to In Progress at spawn (executor.ts), so its
 * milestone shows the DESTINATION status; every other phase runs inside the
 * status that launched it.
 */
export function milestoneStatusForLaunch(
  phase: string,
  issueState: string,
): string {
  return phase === "implement" ? "In Progress" : issueState;
}

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
   * Refresh the pinned live board from this tick's candidates (R15). Called
   * once per tick after the un-enroll pass (KTD4). Best-effort like every
   * other Slack call.
   */
  updateBoard(candidates: readonly PollCandidate[]): Promise<void>;
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
  /** Console verb executors (U4–U8 fill these); absent verbs ack "not yet". */
  consoleExecutors?: Partial<Record<ConsoleVerb, ConsoleExecutor>>;
  /** Enables the merged-PR note (U5). Absent → the note never posts. */
  github?: GithubGateway;
  /** Repo-scoped executors (release/deploy) — usable without an issue. */
  repoExecutors?: Partial<Record<ConsoleVerb, RepoExecutor>>;
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
  const boardUpdater = createBoardUpdater({
    slack: deps.slack,
    store: deps.store,
    channelId: deps.channelId,
    log: deps.log,
  });
  const consoleDeps: ConsoleDeps = {
    gateway: deps.gateway,
    slack: deps.slack,
    store: deps.store,
    operatorUserIds: deps.operatorUserIds,
    log: deps.log,
    executors: deps.consoleExecutors ?? {},
    repoExecutors: deps.repoExecutors ?? {},
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
        state: candidate.issue.state,
        labels: candidate.issue.labels,
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
    const text = `${link} needs you — tap an option or reply here.\n\n${body}`;
    // Interactive answer form: a worker question carrying a parseable
    // ```answers fence renders as option buttons; everything else (a daemon
    // factory-block ceiling, a fence-less question) gets the retry/Other pair.
    // The plain text stays as the notification fallback either way.
    const form = question !== null ? parseAnswerForm(question.body) : null;
    const blocks =
      form !== null
        ? buildQuestionBlocks(candidate.issue.identifier, key, form, text)
        : buildRetryBlocks(candidate.issue.identifier, key, text);
    // R5: the escalation also carries the state's console buttons — the
    // operator may want `result`/`logs` context before choosing an answer.
    const stateActions = actionsForState(
      candidate.issue.state,
      candidate.issue.labels,
    );
    if (stateActions !== null) blocks.push(stateActions);
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
    // R1: a stage move is ONE short line — `THINK-279 → Verification` — for
    // both launches and advances. A launch that implies a status move (an
    // implement launch's Running hook moves the issue to In Progress) renders
    // only the move, and launch/advance share the `move:<status>` idempotency
    // key so the same transition never posts twice, whichever shape the engine
    // decided first.
    const status =
      action.kind === "launch"
        ? milestoneStatusForLaunch(action.phase, candidate.issue.state)
        : action.kind === "advance"
          ? action.toStatus
          : null;
    if (status === null) return;
    const key = `move:${status}`;
    const row = deps.store.getSlackThreadByIssue(candidate.issue.id);
    if (row?.last_milestone_key === key) return;
    const link = issueRef(candidate.issue.identifier, candidate.issue.url);
    const text = `${link} → ${status}`;
    const milestoneBlocks = [section(text)];
    // R5: every milestone carries the buttons valid for the state it announces.
    const stateActions = actionsForState(status, candidate.issue.labels);
    if (stateActions !== null) milestoneBlocks.push(stateActions);
    await postMilestone(ref, text, threadDeps, milestoneBlocks);
    deps.store.setSlackThreadMarker(
      candidate.issue.id,
      "last_milestone_key",
      key,
    );
  }

  /**
   * U5: the merged-PR note — the routine seam for "a factory PR just merged".
   * When the issue's NEWEST attempt is terminal-successful and its branch's
   * PR shows MERGED, post one note offering Cut release + Result. One GitHub
   * check per attempt branch (marker `<branch>=><pr|none>` on the thread
   * row): the worker's CI-wait chain guarantees the merge precedes the
   * status move, so a single check at settlement is the honest window. The
   * `pr-merged` EVIDENCE kind is not this seam — it only fires for workers
   * that died before posting their baton.
   */
  async function maybeMergedPrNote(
    candidate: PollCandidate,
    ref: ThreadRef,
  ): Promise<void> {
    if (deps.github === undefined) return;
    const row = deps.store.getSlackThreadByIssue(candidate.issue.id);
    if (row === undefined) return;
    const attempt = deps.store.db
      .prepare(
        "SELECT branch, state FROM attempts WHERE issue_id = ? AND branch IS NOT NULL ORDER BY id DESC LIMIT 1",
      )
      .get(candidate.issue.id) as { branch: string; state: string } | undefined;
    if (attempt === undefined || attempt.state !== "Succeeded") return;
    if (row.last_merged_pr_note?.startsWith(`${attempt.branch}=>`) === true) {
      return; // this branch was already checked (and noted, when merged)
    }
    let merged: { number: number; url: string } | undefined;
    try {
      const prs = await deps.github.prsForBranch(attempt.branch);
      merged = prs.find((p) => p.state === "MERGED");
    } catch (e) {
      deps.log.warn("merged-PR note: GitHub check failed — will retry next tick", {
        issue: candidate.issue.identifier,
        branch: attempt.branch,
        error: String(e),
      });
      return;
    }
    if (merged !== undefined) {
      const link = issueRef(candidate.issue.identifier, candidate.issue.url);
      const text = `🔀 <${merged.url}|#${merged.number}> merged for ${link}.`;
      await postMilestone(ref, text, threadDeps, [
        section(text),
        mergedPrNoteActions(),
      ]);
    }
    deps.store.setSlackThreadMarker(
      candidate.issue.id,
      "last_merged_pr_note",
      `${attempt.branch}=>${merged?.number ?? "none"}`,
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
      await maybeMergedPrNote(candidate, ref);
    },

    async updateBoard(candidates) {
      await boardUpdater.updateBoard(candidates);
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
      // THINK-286: repo-scoped verbs (`release`, `deploy <target>`) work at
      // the channel root and from ANY thread — they act on the repo/stacks,
      // not an issue, so no thread mapping is required.
      {
        const parsed = parseVerb(message.text);
        if (parsed !== null && REPO_VERBS.has(parsed.verb)) {
          await runRepoAction(consoleDeps, {
            channel: message.channel,
            threadTs: message.threadTs,
            userId: message.userId,
            verb: parsed.verb,
            arg: parsed.arg,
          });
          return;
        }
      }
      // R16: `status` at the CHANNEL ROOT re-posts a fresh board snapshot
      // (the last tick's render, persisted in meta). Thread `status` keeps
      // its per-issue live behavior below.
      if (message.threadTs === null && isStatusKeyword(message.text)) {
        const raw = deps.store.getMeta(BOARD_RENDER_KEY);
        let text = "No board rendered yet — the daemon hasn't completed a tick since this shipped.";
        let blocks: unknown[] | undefined;
        if (raw !== undefined) {
          try {
            const rendered = JSON.parse(raw) as { text: string; blocks: unknown[] };
            text = rendered.text;
            blocks = rendered.blocks;
          } catch {
            // fall through to the plain notice
          }
        }
        await deps.slack
          .postMessage(message.channel, text, blocks !== undefined ? { blocks } : {})
          .catch((e: unknown) =>
            deps.log.warn("slack board snapshot post failed", { error: String(e) }),
          );
        return;
      }
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
      // A console verb (typed path) — R6: same pipeline as the buttons.
      // Verbs take precedence over the answer relay: `retry` in a blocked
      // thread is a console action, not an answer to the open question.
      if (message.threadTs !== null) {
        const parsed = parseVerb(message.text);
        if (parsed !== null) {
          const row = deps.store.getSlackThreadByThreadTs(
            message.channel,
            message.threadTs,
          );
          if (row !== undefined) {
            await runConsoleAction(consoleDeps, {
              channel: message.channel,
              threadTs: message.threadTs,
              userId: message.userId,
              issueId: row.issue_id,
              identifier: row.identifier,
              verb: parsed.verb,
              arg: parsed.arg,
            });
            return;
          }
          // THINK-286: an ISSUE verb in an unmapped thread must not die
          // silently — this is usually a just-closed (un-enrolled) thread
          // (hit live: `release` typed into THINK-270's thread seconds after
          // it finished). Repo verbs were already routed above.
          await deps.slack
            .postThreadReply(
              message.channel,
              message.threadTs,
              `This thread isn't tracking an issue anymore (finished issues un-enroll). Issue verbs like \`${parsed.verb}\` need a live issue thread — \`release\`/\`deploy\` work right here or at the channel root.`,
            )
            .catch((e: unknown) =>
              deps.log.warn("slack console: closed-thread reply failed", {
                error: String(e),
              }),
            );
          return;
        }
      }
      // Otherwise: the answer round-trip. When there is no open question the
      // relay's no-op reply becomes the R4 help text — the commands valid for
      // the issue's CURRENT state — instead of "isn't waiting on an answer".
      await relayInboundMessage(message, relayDeps, {
        formatNoOpenQuestion: (link, issue) =>
          `That's not a command I know, and ${link} isn't waiting on an answer.\n\n${helpText(
            link,
            issue.state,
            issue.labels,
          )}`,
      });
    },

    async handleAction(action) {
      // THINK-286: repo-scoped console buttons (release/deploy confirm rounds)
      // need no thread mapping — they may sit on channel-root messages or in
      // threads that un-enrolled mid-round. Route them FIRST.
      if (action.actionId.startsWith(CONSOLE_ACTION_PREFIX)) {
        let cv: ConsoleButtonValue | null = null;
        try {
          const parsed: unknown = JSON.parse(action.value);
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            typeof (parsed as { v?: unknown }).v === "string"
          ) {
            cv = parsed as ConsoleButtonValue;
          }
        } catch {
          // handled below with the issue-path malformed log
        }
        if (cv !== null && REPO_VERBS.has(cv.v)) {
          await runRepoAction(consoleDeps, {
            channel: action.channel,
            threadTs: action.threadTs,
            userId: action.userId,
            verb: cv.v,
            arg: cv.arg,
          });
          return;
        }
      }

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

      // Console buttons (`factory-console:*`) run the shared action pipeline;
      // the thread mapping resolved the issue (KTD1) — the button value only
      // names the verb (+ optional arg).
      if (action.actionId.startsWith(CONSOLE_ACTION_PREFIX)) {
        let cv: ConsoleButtonValue;
        try {
          const parsed: unknown = JSON.parse(action.value);
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            typeof (parsed as { v?: unknown }).v !== "string"
          ) {
            throw new Error("not a console value");
          }
          cv = parsed as ConsoleButtonValue;
        } catch {
          deps.log.warn("slack console: malformed button value — ignored", {
            issue: row.identifier,
            actionId: action.actionId,
            value: action.value.slice(0, 200),
          });
          return;
        }
        await runConsoleAction(consoleDeps, {
          channel: action.channel,
          threadTs: action.threadTs,
          userId: action.userId,
          issueId: row.issue_id,
          identifier: row.identifier,
          verb: cv.v,
          arg: cv.arg,
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
        answer = RETRY_ANSWER_TEXT;
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
