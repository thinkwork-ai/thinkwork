/**
 * Enrollment preflight (R4, AE3).
 *
 * Before any worker launches, issue text is screened for work the factory
 * must not attempt autonomously:
 * - `.github/workflows` changes — the automation's GitHub credentials lack
 *   the `workflow` scope, so pushes would fail late and noisily;
 * - credential-needing work (secrets, API keys, OAuth apps, token rotation)
 *   — requires material a worker must never self-provision.
 *
 * A blocked decision is applied as blocker label + ONE explanatory comment,
 * idempotent across repeated polls via the `factory-preflight:<ISSUE_ID>`
 * marker.
 */

import {
  isTrustedComment,
  type CommentTrust,
  type LinearCommentSnapshot,
  type LinearGateway,
  type LinearIssueSnapshot,
} from "./client.js";
import { isMarkerComment } from "./markers.js";

export const PREFLIGHT_MARKER_PREFIX = "factory-preflight:";

export type PreflightBlockLabel = "Needs Credentials" | "Needs User";

export interface PreflightDecision {
  blocked: boolean;
  label: PreflightBlockLabel | null;
  reason: string | null;
}

const WORKFLOWS_PATTERNS: RegExp[] = [
  /\.github\/workflows/i,
  /\bgithub\s+actions?\s+workflows?\b/i,
  /\bworkflow\s+ya?ml\b/i,
  /\bdeploy\.yml\b/i,
];

const CREDENTIAL_PATTERNS: RegExp[] = [
  /\bcredentials?\b/i,
  /\bsecrets?\s+(manager|rotation|value)\b/i,
  /\brotate\b.*\b(key|token|secret)s?\b/i,
  /\bapi\s+keys?\b/i,
  /\boauth\s+(app|client|token|grant)s?\b/i,
  /\bservice\s+accounts?\b/i,
  /\bpersonal\s+access\s+tokens?\b/i,
];

export function preflightMarker(issueIdentifier: string): string {
  return `${PREFLIGHT_MARKER_PREFIX}${issueIdentifier}`;
}

/**
 * Pure decision from issue text. No I/O — callable on any snapshot.
 */
export function evaluatePreflight(
  issue: Pick<LinearIssueSnapshot, "title" | "description">,
): PreflightDecision {
  const text = `${issue.title}\n${issue.description}`;

  if (WORKFLOWS_PATTERNS.some((re) => re.test(text))) {
    return {
      blocked: true,
      label: "Needs Credentials",
      reason:
        "This issue touches `.github/workflows` — factory workers push with credentials " +
        "that lack the `workflow` scope. A human must make (or credential) the workflow change.",
    };
  }

  if (CREDENTIAL_PATTERNS.some((re) => re.test(text))) {
    return {
      blocked: true,
      label: "Needs Credentials",
      reason:
        "This issue requires credentials/secrets the factory must not self-provision. " +
        "A human must supply or rotate the material before automation proceeds.",
    };
  }

  return { blocked: false, label: null, reason: null };
}

/**
 * Operator override (dead-end fix): the block comment tells the operator
 * they may remove the blocker label to resume automation, but the issue TEXT
 * still matches the preflight patterns forever — without this check the
 * daemon would re-add the label every tick. "A preflight marker comment
 * already exists AND the blocker label is currently absent" therefore means
 * an operator deliberately removed the label: route normally.
 *
 * When trust info is available the marker comment must come from the daemon
 * or a trusted user, so an outside commenter cannot pre-empt the block by
 * posting a fake marker before the daemon ever applied it.
 */
export function hasPreflightOverride(
  issue: LinearIssueSnapshot,
  comments: LinearCommentSnapshot[],
  decision: PreflightDecision,
  trust?: CommentTrust,
): boolean {
  if (!decision.blocked || decision.label === null) return false;
  if (issue.labels.includes(decision.label)) return false;
  const marker = preflightMarker(issue.identifier);
  return comments.some(
    (c) =>
      isMarkerComment(c.body, marker) &&
      (trust === undefined || isTrustedComment(c, trust)),
  );
}

/**
 * Apply a blocked decision: blocker label + one marked comment. Idempotent —
 * repeated polls see the marker/label already present and write nothing.
 * Returns true when anything was written this call.
 */
export async function applyPreflightBlock(
  gateway: LinearGateway,
  issue: LinearIssueSnapshot,
  comments: LinearCommentSnapshot[],
  decision: PreflightDecision,
): Promise<boolean> {
  if (!decision.blocked || decision.label === null) return false;
  let wrote = false;

  if (!issue.labels.includes(decision.label)) {
    await gateway.addLabel(issue.id, decision.label);
    wrote = true;
  }

  const marker = preflightMarker(issue.identifier);
  const alreadyCommented = comments.some((c) =>
    isMarkerComment(c.body, marker),
  );
  if (!alreadyCommented) {
    const body = [
      marker,
      "",
      `**Enrollment preflight blocked this issue** (\`${decision.label}\`).`,
      "",
      decision.reason ?? "",
      "",
      "No worker was launched. Remove the blocker label after resolving to re-enroll.",
    ].join("\n");
    await gateway.createComment(issue.id, body);
    wrote = true;
  }

  return wrote;
}
