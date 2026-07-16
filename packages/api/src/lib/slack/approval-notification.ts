/**
 * Slack approval deep-link notification (THINK-302 U16 — R12 Slack clause).
 *
 * When a gated tool call parks in a Slack-connected thread, the thread gets a
 * notification that deep-links to the web approval card. v1 posts plain text
 * (no Block Kit interactive actions — Scope Boundaries); resolution is done
 * from the web card, and the notification is purely a pointer.
 *
 * The message text is built ONLY from the redacted display summary (U11a's
 * `redact.ts`) — raw arguments never appear in Slack (KTD-5). The deep-link
 * URL is passed in by the caller (U11b resolves the web base URL + thread
 * path); this module stays a pure formatter so it is unit-testable and
 * carries no config/env dependency.
 *
 * Ships pure + inert in this unit: the emit-on-intake caller lands in U11b.
 */

import type { ApprovalAction } from "../tool-approvals/authorize.js";
import {
  formatApprovalSummaryLine,
  type RedactedApprovalSummary,
} from "../tool-approvals/redact.js";

export interface ApprovalRequestNotificationInput {
  summary: RedactedApprovalSummary;
  /** Deep link to the web approval card (caller-built; never a raw arg). */
  deepLinkUrl: string;
}

/**
 * The request notification: names the tool + requester (value-free) and links
 * to the card. No approve/deny controls in v1 — resolution is web-only.
 */
export function formatApprovalRequestSlackText(
  input: ApprovalRequestNotificationInput,
): string {
  const line = formatApprovalSummaryLine(input.summary);
  return [
    ":lock: *Approval needed* — a gated tool call is waiting for a human.",
    line,
    `Review and approve/deny here: ${input.deepLinkUrl}`,
  ].join("\n");
}

export interface ApprovalResolutionNotificationInput {
  action: ApprovalAction;
  /** Display name of the resolver (never an id/email leak). */
  resolverName: string;
  /** Where it was resolved, for the audit trail (e.g. "the web app"). */
  resolvedVia?: string;
  summary: RedactedApprovalSummary;
}

const ACTION_VERB: Record<ApprovalAction, string> = {
  approve: "approved",
  deny: "denied",
  cancel: "cancelled",
};

const ACTION_EMOJI: Record<ApprovalAction, string> = {
  approve: ":white_check_mark:",
  deny: ":no_entry:",
  cancel: ":wastebasket:",
};

/** The resolution follow-up: who resolved it, how, and which tool. */
export function formatApprovalResolutionSlackText(
  input: ApprovalResolutionNotificationInput,
): string {
  const verb = ACTION_VERB[input.action];
  const emoji = ACTION_EMOJI[input.action];
  const where = input.resolvedVia ? ` via ${input.resolvedVia}` : "";
  return `${emoji} ${input.summary.toolName} (${input.summary.class}/${input.summary.slug}) was ${verb} by ${input.resolverName}${where}.`;
}
