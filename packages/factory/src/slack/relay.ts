/**
 * The inbound relay (U8's PROOF, R19 + KTD-7): turn an operator's in-thread
 * Slack reply into a resumed run.
 *
 * Contract for one inbound message:
 *   1. Only threaded replies matter — a root-level message is ignored.
 *   2. The thread must map to an enrolled issue (slack_threads); no mapping →
 *      ignore silently (some other thread).
 *   3. Idempotency: a message ts at or below the stored high-water mark was
 *      already processed (Slack redelivers on missed acks) → no-op.
 *   4. Authorization: the replier's Slack id must be on the operator
 *      allowlist. A reply from anyone else is ACKNOWLEDGED but NEVER injected
 *      — the allowlist is the trust boundary, exactly mirroring the Linear
 *      comment-author gate (isTrustedComment).
 *   5. Question state: the issue must actually be blocked on `Needs User`.
 *      Otherwise a polite no-op — there is nothing to resume.
 *   6. Relay (authorized + blocked): append the answer to the relaunch baton
 *      (a fresh, daemon-authored `handoff:<ID>:<readStatus>` comment carrying
 *      the answer verbatim — newest baton wins, so the next tick's relaunch
 *      injects it), clear the `Needs User` blocker, post a marked mirror
 *      comment for Linear-side legibility, advance the high-water mark, and
 *      ack in the thread. The NEXT daemon tick re-launches the phase from the
 *      baton (resume = relaunch-from-baton, never a resurrected worker — R15).
 *
 * Answering the SAME question with a Linear comment works identically: the
 * poller already reads every comment, and a human removing `Needs User` is
 * exactly what step 6 does here — parity by construction.
 *
 * Steps 4–6 are factored out as `relayAnswer` so the answer-form BUTTON path
 * (sync.handleAction) shares them verbatim with the typed-message path —
 * a click and a typed reply must never diverge in what they inject. Steps
 * 1–3 (thread mapping + ts high-water idempotency) stay message-specific:
 * a button click carries no message ts; its idempotency is step 5's
 * no-open-question check (the first relay removes `Needs User`).
 */

import type { CommentTrust, LinearGateway } from "../linear/client.js";
import type { Logger } from "../logger.js";
import { findNewestBaton, handoffMarker } from "../phases/prompts.js";
import { section } from "./blocks.js";
import type { SlackGateway, SlackInboundMessage } from "./client.js";
import type { FactoryStore } from "../store/db.js";

/** Marker prefix for the Linear-side resolution mirror comment. */
export const SLACK_RELAY_MARKER_PREFIX = "slack-relay:";

/** The blocker the question protocol raises and the relay clears. */
const NEEDS_USER = "Needs User";

export interface RelayDeps {
  gateway: LinearGateway;
  slack: SlackGateway;
  store: FactoryStore;
  /** The operator allowlist (config `slack.operatorUserIds`). */
  operatorUserIds: readonly string[];
  log: Logger;
  /** Reserved for future baton carry-forward trust filtering (unused today). */
  trust?: CommentTrust;
}

export type RelayReason =
  | "relayed"
  | "not-a-thread-reply"
  | "no-thread-mapping"
  | "duplicate"
  | "unauthorized"
  | "issue-not-found"
  | "no-open-question";

export interface RelayResult {
  relayed: boolean;
  reason: RelayReason;
  /** Linear issue id, when a mapping was resolved. */
  issueId?: string;
}

/**
 * Map a Linear workflow status to the `handoff:<ID>:<status>` baton the next
 * relaunch of that status READS — mirrors the phase engine's status→phase
 * routing so the operator's answer lands on the exact baton the resumed
 * worker will read. `null` for statuses that launch no worker (review gates).
 */
export function relaunchReadStatus(issueState: string): string | null {
  switch (issueState) {
    case "Brainstorming":
      return "Brainstorming";
    case "Planning":
      return "Planning";
    case "Debug":
      return "Debug";
    case "Ready to Work":
    case "Ready To Work":
    case "In Progress":
      return "Ready to Work";
    case "Verification":
    case "Review":
      return "Verification";
    case "Done":
      return "Done";
    default:
      return null;
  }
}

/** Slack ts values are `epoch.seq` decimals — numeric compare orders them. */
function tsLessOrEqual(a: string, b: string): boolean {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return a <= b; // fail-safe: lexical
  return na <= nb;
}

/** Drop a marker first line so a carried-forward baton isn't double-markered. */
function stripFirstLine(body: string): string {
  const idx = body.indexOf("\n");
  return idx === -1 ? "" : body.slice(idx + 1).trimStart();
}

/**
 * The canned answer both retry surfaces inject (the escalation's retry button
 * and the console's `retry` verb) — one text, byte-identical batons.
 */
export const RETRY_ANSWER_TEXT =
  "Retry: operator cleared the blocker via Slack without additional guidance — re-attempt from the newest baton and prior evidence.";

/**
 * Build the fresh relaunch baton: the marker line, the prior baton body
 * carried forward (so no context is lost), then the operator's answer
 * verbatim under a clearly-labeled heading. Exported for the console's
 * `retry` executor, which writes the same baton shape outside the relay.
 */
export function buildAppendedBaton(
  identifier: string,
  readStatus: string,
  priorBaton: string | null,
  userId: string,
  answer: string,
): string {
  const marker = handoffMarker(identifier, readStatus);
  const parts = [marker, ""];
  if (priorBaton !== null) {
    const carried = stripFirstLine(priorBaton).trimEnd();
    if (carried !== "") parts.push(carried, "");
  }
  parts.push(
    "---",
    "",
    `**Operator answer (relayed from Slack by <@${userId}>).** Treat this as the authoritative answer to the open question(s); the \`${NEEDS_USER}\` blocker has been cleared. Resume from here.`,
    "",
    answer.trim(),
  );
  return parts.join("\n");
}

/** The Linear-side legibility mirror recording the resolution. */
function buildMirrorComment(
  identifier: string,
  userId: string,
  answer: string,
): string {
  return [
    `${SLACK_RELAY_MARKER_PREFIX}${identifier}`,
    "",
    `**Answered via Slack** by <@${userId}>. Cleared the \`${NEEDS_USER}\` blocker and appended the answer to the relaunch baton; the daemon will re-launch this phase on the next tick.`,
    "",
    "> " + answer.trim().replace(/\n/g, "\n> "),
  ].join("\n");
}

export interface RelayAnswerInput {
  channel: string;
  /** The issue thread's root ts (acks are posted into this thread). */
  threadTs: string;
  identifier: string;
  issueId: string;
  /** The answering Slack user (typed reply author or button clicker). */
  userId: string;
  /** The answer text to inject verbatim. */
  answer: string;
  /** Where the answer came from — a typed message or an answer-form button. */
  source: "message" | "button";
  /**
   * Called at every point the message path advances its ts high-water mark
   * (steps 4–6). Message-source only; button clicks have no message ts and
   * lean on the no-open-question check for idempotency instead.
   */
  markProcessed?: () => void;
  /**
   * Override for the no-open-question no-op reply (R4): the typed-message
   * path renders the console help text here so an unknown message never dead-
   * ends at "isn't waiting on an answer". Button clicks keep the default.
   */
  formatNoOpenQuestion?: (
    link: string,
    issue: { state: string; labels: string[] },
  ) => string;
}

/**
 * The shared relay core (steps 4–6): authorization → question-state check →
 * baton append → clear `Needs User` → Linear mirror → thread ack. Both the
 * typed-message path (relayInboundMessage) and the button-click path
 * (sync.handleAction) run EXACTLY this — parity by construction, so a click
 * and a typed reply produce byte-identical batons and mirrors.
 */
export async function relayAnswer(
  deps: RelayDeps,
  input: RelayAnswerInput,
): Promise<RelayResult> {
  const { identifier, issueId } = input;
  const markProcessed = () => input.markProcessed?.();
  const ackThread = (text: string) =>
    deps.slack
      .postThreadReply(input.channel, input.threadTs, text, {
        blocks: [section(text)],
      })
      .catch((e: unknown) =>
        deps.log.warn("slack relay: ack post failed", {
          issue: identifier,
          error: String(e),
        }),
      );

  // (4) Authorization — the allowlist is the trust boundary. Covers button
  // clicks too: anyone in the channel can see (and click) the form, so the
  // click is acknowledged but never injected. The ack text works for both
  // sources — "reply here" is also how a non-operator would escalate a click.
  if (!deps.operatorUserIds.includes(input.userId)) {
    deps.log.warn("slack relay: answer from a non-operator — acknowledged, not injected", {
      issue: identifier,
      replier: input.userId,
      source: input.source,
    });
    markProcessed();
    await ackThread(
      `Thanks <@${input.userId}> — only an authorized operator can steer this run. Ask an operator to reply here.`,
    );
    return { relayed: false, reason: "unauthorized", issueId };
  }

  // (5) Question-state check — is there anything to resume? This is also the
  // button idempotency guard: a second click lands after the first relay
  // removed `Needs User`, so it exits here as a polite no-op.
  let issue;
  try {
    [issue] = await deps.gateway.getIssuesByIdentifier([identifier]);
  } catch (e) {
    deps.log.warn("slack relay: issue re-read failed — will retry on redelivery", {
      issue: identifier,
      error: String(e),
    });
    // Do NOT mark processed: let a redelivery (or a re-click) retry.
    await ackThread(
      `Sorry — I couldn't reach Linear to apply your answer just now. Please try again in a moment.`,
    );
    return { relayed: false, reason: "issue-not-found", issueId };
  }
  if (issue === undefined) {
    markProcessed();
    await ackThread(
      `I couldn't find ${identifier} in Linear anymore, so there's nothing to resume.`,
    );
    return { relayed: false, reason: "issue-not-found", issueId };
  }
  const link = issue.url ? `<${issue.url}|${identifier}>` : identifier;
  if (!issue.labels.includes(NEEDS_USER)) {
    deps.log.info("slack relay: no open question — polite no-op", {
      issue: identifier,
      state: issue.state,
    });
    markProcessed();
    await ackThread(
      input.formatNoOpenQuestion?.(link, {
        state: issue.state,
        labels: issue.labels,
      }) ??
        `${link} isn't waiting on an answer (no \`${NEEDS_USER}\` blocker) — nothing relayed.`,
    );
    return { relayed: false, reason: "no-open-question", issueId };
  }

  // (6) Relay: append to the baton, clear the blocker, mirror, ack.
  const readStatus = relaunchReadStatus(issue.state);
  const comments = await deps.gateway.listComments(issueId).catch(() => []);

  if (readStatus !== null) {
    const prior = findNewestBaton(identifier, readStatus, comments);
    const baton = buildAppendedBaton(
      identifier,
      readStatus,
      prior?.body ?? null,
      input.userId,
      input.answer,
    );
    await deps.gateway.createComment(issueId, baton);
  } else {
    // No worker phase maps to this status — still surface the answer as a
    // plain comment (the worker reads all comments) so nothing is lost.
    await deps.gateway.createComment(
      issueId,
      `**Operator answer (relayed from Slack by <@${input.userId}>):**\n\n${input.answer.trim()}`,
    );
  }

  await deps.gateway.removeLabel(issueId, NEEDS_USER);
  await deps.gateway.createComment(
    issueId,
    buildMirrorComment(identifier, input.userId, input.answer),
  );

  markProcessed();
  const excerpt = input.answer.trim().replace(/\s+/g, " ").slice(0, 120);
  await ackThread(
    `✅ Relayed to ${link}: "${excerpt}" — resumes next tick. Wrong? Re-add \`${NEEDS_USER}\` in Linear before then.`,
  );

  deps.log.info("slack relay: answer injected and blocker cleared", {
    issue: identifier,
    replier: input.userId,
    source: input.source,
    readStatus,
  });
  return { relayed: true, reason: "relayed", issueId };
}

export async function relayInboundMessage(
  message: SlackInboundMessage,
  deps: RelayDeps,
  opts: Pick<RelayAnswerInput, "formatNoOpenQuestion"> = {},
): Promise<RelayResult> {
  // (1) Only in-thread replies carry answers.
  if (message.threadTs === null) {
    return { relayed: false, reason: "not-a-thread-reply" };
  }

  // (2) Resolve the issue from the thread mapping.
  const thread = deps.store.getSlackThreadByThreadTs(
    message.channel,
    message.threadTs,
  );
  if (thread === undefined) {
    return { relayed: false, reason: "no-thread-mapping" };
  }
  const { issue_id: issueId, identifier } = thread;

  // (3) Idempotency: already processed this (or a newer) message.
  if (
    thread.last_relayed_ts !== null &&
    tsLessOrEqual(message.ts, thread.last_relayed_ts)
  ) {
    deps.log.debug("slack relay: duplicate delivery ignored", {
      issue: identifier,
      ts: message.ts,
      highWater: thread.last_relayed_ts,
    });
    return { relayed: false, reason: "duplicate", issueId };
  }

  // (4)–(6) are the shared core.
  return relayAnswer(deps, {
    channel: message.channel,
    threadTs: message.threadTs,
    identifier,
    issueId,
    userId: message.userId,
    answer: message.text,
    source: "message",
    markProcessed: () =>
      deps.store.setSlackThreadMarker(issueId, "last_relayed_ts", message.ts),
    formatNoOpenQuestion: opts.formatNoOpenQuestion,
  });
}
