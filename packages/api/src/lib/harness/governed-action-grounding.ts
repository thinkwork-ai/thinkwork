import type { FinalizePayload } from "../chat-finalize/types.js";

type FinalizeResponse = NonNullable<FinalizePayload["response"]>;

type EmailEvidence =
  | { status: "sent"; approvalUrl: null }
  | { status: "pending_review"; approvalUrl: string | null }
  | { status: "failed" | "unknown"; approvalUrl: null };

const EMAIL_SENT_CLAIM =
  /\b(?:email|message)\s+(?:has\s+been\s+|was\s+)?(?:sent|submitted|queued|delivered)\b/i;
const EMAIL_PENDING_CLAIM =
  /\b(?:pending|awaiting)\s+(?:human\s+)?(?:review|approval)\b/i;
const EMAIL_NEGATED_CLAIM =
  /\b(?:email|message)\s+(?:was\s+|has\s+)?not\s+(?:sent|submitted|queued|delivered)\b/i;

/**
 * Make user-visible side-effect claims subordinate to the governed ledger.
 *
 * Agent prose is never evidence that an email was sent or that an approval was
 * created. The exact-turn Gateway target is the authority. If the model claims
 * a state that the append-only tool ledger cannot prove, replace the prose with
 * a deterministic, truthful status before processFinalize persists it.
 */
export function enforceGovernedActionGrounding(
  response: FinalizeResponse | undefined,
  governedInvocations: Array<Record<string, unknown>>,
): void {
  if (!response) return;
  const content = response.content ?? response.output ?? response.text ?? "";
  if (!content || !claimsEmailSideEffect(content)) return;

  const evidence = emailEvidence(governedInvocations);
  if (evidence?.status === "sent" && !EMAIL_PENDING_CLAIM.test(content)) {
    return;
  }
  if (
    evidence?.status === "pending_review" &&
    EMAIL_PENDING_CLAIM.test(content) &&
    !EMAIL_SENT_CLAIM.test(content)
  ) {
    return;
  }

  const correction = groundedEmailStatus(evidence);
  response.content = correction;
  delete response.output;
  delete response.text;
  response.diagnostics = {
    ...(response.diagnostics ?? {}),
    governed_action_grounding: {
      corrected: true,
      operation: "email.send",
      evidence_status: evidence?.status ?? "missing",
    },
  };
}

function claimsEmailSideEffect(content: string): boolean {
  if (EMAIL_NEGATED_CLAIM.test(content)) return false;
  return EMAIL_SENT_CLAIM.test(content) || EMAIL_PENDING_CLAIM.test(content);
}

function emailEvidence(
  invocations: Array<Record<string, unknown>>,
): EmailEvidence | null {
  const invocation = [...invocations]
    .reverse()
    .find(
      (candidate) =>
        candidate.operation === "email.send" ||
        candidate.tool_name === "email_send" ||
        candidate.tool_name === "send_email",
    );
  if (!invocation) return null;
  if (invocation.status === "failed" || invocation.status === "uncertain") {
    return { status: "failed", approvalUrl: null };
  }
  const output = parsePreview(invocation.output_preview);
  if (output.status === "sent") {
    return { status: "sent", approvalUrl: null };
  }
  if (output.status === "pending_review") {
    return {
      status: "pending_review",
      approvalUrl:
        typeof output.approvalUrl === "string" ? output.approvalUrl : null,
    };
  }
  return { status: "unknown", approvalUrl: null };
}

function groundedEmailStatus(evidence: EmailEvidence | null): string {
  if (evidence?.status === "pending_review") {
    return [
      "The email draft is awaiting your approval. Nothing has been sent yet.",
      evidence.approvalUrl
        ? `Review and approve it here: ${evidence.approvalUrl}`
        : "Use the approval card in this thread to review, edit, or cancel it.",
    ].join("\n\n");
  }
  if (evidence?.status === "sent") {
    return "The governed email tool confirmed that the email was sent.";
  }
  if (evidence?.status === "failed") {
    return "The email was not sent. The governed email action failed, so no delivery or approval is pending.";
  }
  return "I could not submit that email. No governed email action was recorded, so nothing was sent or queued for approval.";
}

function parsePreview(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
