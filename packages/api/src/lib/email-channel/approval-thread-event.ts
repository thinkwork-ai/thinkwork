import { eq } from "drizzle-orm";
import { messages, users } from "@thinkwork/database-pg/schema";
import type { Database } from "@thinkwork/database-pg";

type ThreadEventDb = Pick<Database, "insert" | "select">;

export type EmailSendOutcome =
  | { sent: true; providerMessageId?: string | null }
  | { sent: false; error?: string | null };

export interface EmailDecisionThreadEventInput {
  db: ThreadEventDb;
  tenantId: string;
  /** Null for sends with no originating chat thread — then this is a no-op. */
  threadId: string | null;
  decision: "approved" | "rejected";
  recipients: string[];
  subject?: string | null;
  actorId: string | null;
  reviewNotes?: string | null;
  /** Omitted on denial; present on the approved path. */
  outcome?: EmailSendOutcome;
  /** Injectable for deterministic tests. */
  now?: Date;
}

/**
 * Feed an email approval decision back into the agent's thread (THINK-600).
 *
 * Without this the agent's only record of the email is its own `send_email`
 * tool result — "pending human review" — which stays true-looking forever.
 * Dogfooding on 2026-08-04 caught the agent confidently reporting the
 * opposite of reality three turns after the human had approved and the mail
 * had gone out.
 *
 * The row is written as `role: "assistant"` with `sender_type: "system"`
 * (the brain draft-review-writeback pattern) *because* that is what the
 * model actually sees: both the API-side history loader
 * (`chat-agent-invoke.loadPriorMessageRows` → `messagesHistory`) and the
 * runtime's `normalizeHistory` drop every role that is not `user` or
 * `assistant`, and read `content` only. A `role: "system"` row would be
 * UI-visible but model-invisible — exactly the asymmetry that caused the
 * bug.
 *
 * Best-effort: an approval that already sent real mail must not fail because
 * the notice could not be written.
 */
export async function postEmailDecisionThreadEvent(
  input: EmailDecisionThreadEventInput,
): Promise<{ posted: boolean }> {
  if (!input.threadId) return { posted: false };
  try {
    const actor = await resolveActorLabel(input.db, input.actorId);
    const content = renderEmailDecisionNotice({ ...input, actor });
    await input.db.insert(messages).values({
      thread_id: input.threadId,
      tenant_id: input.tenantId,
      role: "assistant",
      content,
      sender_type: "system",
      sender_id: input.actorId ?? undefined,
      metadata: {
        kind: "email_approval_decision",
        decision: input.decision,
        recipients: input.recipients,
        subject: input.subject ?? null,
        decidedByUserId: input.actorId,
        decidedAt: (input.now ?? new Date()).toISOString(),
        sent: input.outcome?.sent ?? false,
        providerMessageId:
          input.outcome?.sent === true
            ? (input.outcome.providerMessageId ?? null)
            : null,
      },
    });
    return { posted: true };
  } catch (error) {
    console.error("[email-approval] thread event insert failed", {
      tenantId: input.tenantId,
      threadId: input.threadId,
      decision: input.decision,
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return { posted: false };
  }
}

export function renderEmailDecisionNotice(input: {
  decision: "approved" | "rejected";
  recipients: string[];
  subject?: string | null;
  actor: string;
  reviewNotes?: string | null;
  outcome?: EmailSendOutcome;
  now?: Date;
}): string {
  const at = (input.now ?? new Date()).toISOString();
  const to = input.recipients.join(", ") || "(unknown recipient)";
  const subject = input.subject ? ` "${input.subject}"` : "";
  const head = `System notice (email channel): the pending email to ${to}${subject} was ${
    input.decision === "approved" ? "APPROVED" : "DENIED"
  } by ${input.actor} at ${at}.`;

  let outcome: string;
  if (input.decision === "rejected") {
    outcome = "The email was NOT sent.";
  } else if (input.outcome?.sent === true) {
    const id = input.outcome.providerMessageId;
    outcome = id
      ? `It has been SENT (provider message id ${id}).`
      : "It has been SENT.";
  } else {
    const reason = input.outcome?.error ? `: ${input.outcome.error}` : ".";
    outcome = `The send then FAILED${reason} The email was NOT delivered.`;
  }

  const notes = input.reviewNotes
    ? ` Reviewer notes: ${input.reviewNotes}`
    : "";
  return `${head} ${outcome}${notes} This supersedes any earlier "pending human review" tool result for this email — treat it as the current state.`;
}

async function resolveActorLabel(
  db: ThreadEventDb,
  actorId: string | null,
): Promise<string> {
  if (!actorId) return "a reviewer";
  try {
    const [user] = await db
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1);
    return user?.name || user?.email || actorId;
  } catch {
    return actorId;
  }
}
