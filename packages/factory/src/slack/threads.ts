/**
 * Slack thread lifecycle (U8): one thread per enrolled issue, plus the
 * outbound posts the daemon makes into it.
 *
 * Thread ↔ issue mapping is persisted in the operational store
 * (slack_threads), so `openThreadForIssue` is idempotent and reuses the same
 * thread across daemon restarts. Posting helpers split by whether they
 * @mention the operator:
 *   - postMilestone      — phase progress; NO @mention (ambient legibility).
 *   - postEscalation     — a question / blocker; @mentions the operators so
 *                          they see it and can answer in-thread (the reply
 *                          drives the inbound relay).
 *   - postClosingSummary — terminal wrap-up; no @mention.
 *   - postNag            — SEAM for U6's timer sweep (nag/escalation
 *                          schedule). Implemented as a normal @mention post so
 *                          U6 can call it; U8 does NOT arm any timer.
 */

import type { Logger } from "../logger.js";
import type { FactoryStore, SlackThreadRow } from "../store/db.js";
import { context, section } from "./blocks.js";
import type { SlackGateway } from "./client.js";
import { actionsForState } from "./console.js";

export interface ThreadRef {
  channel: string;
  threadTs: string;
}

export interface ThreadDeps {
  slack: SlackGateway;
  store: FactoryStore;
  channelId: string;
  operatorUserIds: readonly string[];
  log: Logger;
}

export interface IssueThreadTarget {
  /** Linear internal id (uuid). */
  issueId: string;
  /** Human identifier, e.g. "THINK-123". */
  identifier: string;
  title: string;
  /** Issue web URL — the root message links the identifier when set. */
  url?: string | null;
  /**
   * Current workflow state + labels, when known: the root message carries the
   * state's console buttons (R5). An issue that enrolls directly AT a review
   * gate posts no milestone, so without this its thread starts button-less
   * and the operator has to discover typed verbs (live paper cut, THINK-276's
   * own approval).
   */
  state?: string;
  labels?: readonly string[];
}

function toRef(row: SlackThreadRow): ThreadRef {
  return { channel: row.channel_id, threadTs: row.thread_ts };
}

/**
 * Open (or reuse) the Slack thread for an issue. Idempotent: if a mapping
 * already exists in the store it is returned unchanged — no new root message
 * is posted, so restarts and repeated ticks converge on ONE thread per issue.
 */
export async function openThreadForIssue(
  target: IssueThreadTarget,
  deps: ThreadDeps,
): Promise<ThreadRef> {
  const existing = deps.store.getSlackThreadByIssue(target.issueId);
  if (existing !== undefined) return toRef(existing);

  // No thread yet — post the root message and persist the mapping.
  const ref = target.url
    ? `<${target.url}|${target.identifier}>`
    : `*${target.identifier}*`;
  const rootText = `:factory: ${ref} — ${target.title}`;
  const rootBlocks = [
    section(rootText),
    context("Progress lands in this thread — reply here to steer."),
  ];
  if (target.state !== undefined) {
    const stateActions = actionsForState(target.state, target.labels ?? []);
    if (stateActions !== null) rootBlocks.push(stateActions);
  }
  const rootTs = await deps.slack.postMessage(deps.channelId, rootText, {
    blocks: rootBlocks,
  });
  const row = deps.store.upsertSlackThread({
    issueId: target.issueId,
    identifier: target.identifier,
    channelId: deps.channelId,
    threadTs: rootTs,
  });
  deps.log.info("slack thread opened", {
    issue: target.identifier,
    channel: deps.channelId,
    threadTs: row.thread_ts,
  });
  return toRef(row);
}

/** Post a phase milestone into the issue thread. No @mention. */
export async function postMilestone(
  ref: ThreadRef,
  text: string,
  deps: Pick<ThreadDeps, "slack">,
  blocks?: unknown[],
): Promise<string> {
  return deps.slack.postThreadReply(ref.channel, ref.threadTs, text, {
    ...(blocks !== undefined ? { blocks } : {}),
  });
}

/**
 * Post an escalation (question / blocker) WITH an @mention of the operators.
 * `blocks` (the interactive answer form) rides along when provided; the plain
 * `text` remains the notification fallback Slack requires.
 */
export async function postEscalation(
  ref: ThreadRef,
  text: string,
  deps: Pick<ThreadDeps, "slack" | "operatorUserIds">,
  blocks?: unknown[],
): Promise<string> {
  return deps.slack.postThreadReply(ref.channel, ref.threadTs, text, {
    mentionUserIds: [...deps.operatorUserIds],
    ...(blocks !== undefined ? { blocks } : {}),
  });
}

/** Post the closing summary into the issue thread. No @mention. */
export async function postClosingSummary(
  ref: ThreadRef,
  text: string,
  deps: Pick<ThreadDeps, "slack">,
): Promise<string> {
  return deps.slack.postThreadReply(ref.channel, ref.threadTs, text, {
    blocks: [section(text)],
  });
}

/**
 * SEAM for U6's nag-timer sweep: re-@mention the operators on a still-open
 * question. U8 leaves this callable but arms NO timer — the timer queue is
 * U6's. When U6 lands its sweep it calls this for each overdue escalation.
 */
export async function postNag(
  ref: ThreadRef,
  text: string,
  deps: Pick<ThreadDeps, "slack" | "operatorUserIds">,
): Promise<string> {
  return deps.slack.postThreadReply(ref.channel, ref.threadTs, text, {
    mentionUserIds: [...deps.operatorUserIds],
  });
}
