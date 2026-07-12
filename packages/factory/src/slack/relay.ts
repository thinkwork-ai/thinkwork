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
 */

import type { CommentTrust, LinearGateway } from "../linear/client.js";
import type { Logger } from "../logger.js";
import { findNewestBaton, handoffMarker } from "../phases/prompts.js";
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
 * Build the fresh relaunch baton: the marker line, the prior baton body
 * carried forward (so no context is lost), then the operator's answer
 * verbatim under a clearly-labeled heading.
 */
function buildAppendedBaton(
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

export async function relayInboundMessage(
  message: SlackInboundMessage,
  deps: RelayDeps,
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

  const advanceHighWater = () =>
    deps.store.setSlackThreadMarker(issueId, "last_relayed_ts", message.ts);
  const ackThread = (text: string) =>
    deps.slack
      .postThreadReply(message.channel, message.threadTs as string, text)
      .catch((e: unknown) =>
        deps.log.warn("slack relay: ack post failed", {
          issue: identifier,
          error: String(e),
        }),
      );

  // (4) Authorization — the allowlist is the trust boundary.
  if (!deps.operatorUserIds.includes(message.userId)) {
    deps.log.warn("slack relay: reply from a non-operator — acknowledged, not injected", {
      issue: identifier,
      replier: message.userId,
    });
    advanceHighWater();
    await ackThread(
      `Thanks <@${message.userId}> — but only an authorized operator can steer this run, so I can't apply that answer. (Ask an operator to reply here.)`,
    );
    return { relayed: false, reason: "unauthorized", issueId };
  }

  // (5) Question-state check — is there anything to resume?
  let issue;
  try {
    [issue] = await deps.gateway.getIssuesByIdentifier([identifier]);
  } catch (e) {
    deps.log.warn("slack relay: issue re-read failed — will retry on redelivery", {
      issue: identifier,
      error: String(e),
    });
    // Do NOT advance the high-water mark: let a redelivery retry.
    await ackThread(
      `Sorry — I couldn't reach Linear to apply your answer just now. Please try again in a moment.`,
    );
    return { relayed: false, reason: "issue-not-found", issueId };
  }
  if (issue === undefined) {
    advanceHighWater();
    await ackThread(
      `I couldn't find ${identifier} in Linear anymore, so there's nothing to resume.`,
    );
    return { relayed: false, reason: "issue-not-found", issueId };
  }
  if (!issue.labels.includes(NEEDS_USER)) {
    deps.log.info("slack relay: no open question — polite no-op", {
      issue: identifier,
      state: issue.state,
    });
    advanceHighWater();
    await ackThread(
      `Thanks — but ${identifier} isn't waiting on an answer right now (no \`${NEEDS_USER}\` blocker), so I left it as-is.`,
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
      message.userId,
      message.text,
    );
    await deps.gateway.createComment(issueId, baton);
  } else {
    // No worker phase maps to this status — still surface the answer as a
    // plain comment (the worker reads all comments) so nothing is lost.
    await deps.gateway.createComment(
      issueId,
      `**Operator answer (relayed from Slack by <@${message.userId}>):**\n\n${message.text.trim()}`,
    );
  }

  await deps.gateway.removeLabel(issueId, NEEDS_USER);
  await deps.gateway.createComment(
    issueId,
    buildMirrorComment(identifier, message.userId, message.text),
  );

  advanceHighWater();
  await ackThread(
    `Got it — relayed your answer to ${identifier} and cleared the \`${NEEDS_USER}\` blocker. It will resume on the next tick.`,
  );

  deps.log.info("slack relay: answer injected and blocker cleared", {
    issue: identifier,
    replier: message.userId,
    readStatus,
  });
  return { relayed: true, reason: "relayed", issueId };
}
