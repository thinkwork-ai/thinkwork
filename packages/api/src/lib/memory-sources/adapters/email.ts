/**
 * Provider-neutral email memory-source adapter (THINK-193 U6).
 *
 * The email FAMILY is the contract: thread-level normalized snapshots
 * ({threadId, subject, participants, messages[], latestMessageAt}), stable
 * `email:thread:<id>` subjects, `email.*` claims, and a User-Bank-capable
 * scope (supportsPersonalScope). Gmail (./gmail.ts) is the only V1
 * provider; the interface stays compatible with a future Microsoft Graph
 * delta provider without implementing it (plan §U6).
 *
 * PRIVACY: the inline Postgres snapshot for this family is a CONTENT-FREE
 * skeleton (contentFree: true). Everything rendered here therefore loads
 * the FULL snapshot from S3 via the stage runner; `focusLabelFor` — which
 * receives the INLINE column — must never assume content exists and never
 * emits any (AE4: no message content on operator/preflight surfaces).
 */

import { createHash } from "node:crypto";

import {
  boundedInlineText,
  extractEmailThreadClaims,
  subjectKeyForEmailThread,
} from "../claims.js";
import {
  checkGmailReadiness,
  EMAIL_PARTITION_KEY,
  runGmailAcquire,
} from "./gmail.js";
import type { MemorySourceAdapter } from "./registry.js";

const MAX_DOSSIER_CHARS = 16 * 1024;
const MAX_TITLE_CHARS = 200;

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Stable projection key: one Hindsight document per thread. */
export function projectionKeyForEmailThread(threadId: string): string {
  return `thread:${createHash("sha256").update(threadId, "utf8").digest("hex").slice(0, 16)}`;
}

/**
 * PURE: deterministic fallback projection when a thread subject has no
 * claims. Mail text renders ONLY inside blockquotes — an explicit
 * untrusted-content boundary: hostile mail cannot mint top-level headings
 * or instructions-shaped structure in the projected document.
 */
export function buildEmailThreadDossier(
  snapshot: Record<string, unknown>,
  sourceItemId: string,
): { title: string; markdown: string } {
  const subject = stringOrNull(snapshot.subject);
  const title = subject
    ? boundedInlineText(subject, MAX_TITLE_CHARS)
    : `Email thread ${sourceItemId}`;
  const lines: string[] = [`# ${title}`];

  const participants = Array.isArray(snapshot.participants)
    ? snapshot.participants
    : [];
  if (participants.length > 0) {
    const rendered = participants
      .map((raw) => {
        const participant = recordOrNull(raw);
        const email = stringOrNull(participant?.email);
        if (!email) return null;
        const name = stringOrNull(participant?.name);
        return name
          ? `${boundedInlineText(name, 100)} <${boundedInlineText(email, 320)}>`
          : boundedInlineText(email, 320);
      })
      .filter((entry): entry is string => entry !== null);
    if (rendered.length > 0) {
      lines.push(`- Participants: ${rendered.join(", ")}`);
    }
  }
  const latest = stringOrNull(snapshot.latestMessageAt);
  if (latest) lines.push(`- Latest message: ${latest}`);

  const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
  for (const raw of messages) {
    const message = recordOrNull(raw);
    if (!message) continue;
    const from = stringOrNull(message.from) ?? "unknown sender";
    const sentAt = stringOrNull(message.sentAt) ?? "unknown time";
    const header = `## ${boundedInlineText(from, 320)} — ${boundedInlineText(sentAt, 40)}`;
    const parts: string[] = [header];
    const text = stringOrNull(message.text);
    if (text) {
      const quoted = text
        .split(/\r?\n/)
        .map((line) => `> ${line}`)
        .join("\n");
      parts.push(quoted);
    }
    const attachments = Array.isArray(message.attachments)
      ? message.attachments
      : [];
    if (attachments.length > 0) {
      const rendered = attachments
        .map((rawAttachment) => {
          const attachment = recordOrNull(rawAttachment);
          const filename = stringOrNull(attachment?.filename);
          if (!filename) return null;
          const mime = stringOrNull(attachment?.mimeType) ?? "unknown";
          const size =
            typeof attachment?.sizeBytes === "number"
              ? attachment.sizeBytes
              : 0;
          return `${boundedInlineText(filename, 200)} (${boundedInlineText(mime, 100)}, ${size} bytes)`;
        })
        .filter((entry): entry is string => entry !== null);
      if (rendered.length > 0) {
        parts.push(`_Attachments (metadata only): ${rendered.join("; ")}_`);
      }
    }
    lines.push(parts.join("\n\n"));
  }
  if (snapshot.truncated === true) lines.push("_…truncated_");

  let markdown = lines.join("\n\n");
  if (markdown.length > MAX_DOSSIER_CHARS) {
    markdown = `${markdown.slice(0, MAX_DOSSIER_CHARS)}\n\n…truncated`;
  }
  return { title, markdown };
}

export const emailAdapter: MemorySourceAdapter = {
  family: "email",
  partitionKey: EMAIL_PARTITION_KEY,
  pathSegment: "email",
  // Tokens are minted as the processor's owning user — a mailbox is only
  // ever read as its owner (connection ownership is checked in readiness).
  requiresOwnerUser: true,
  // U6: the personal-capable family — personal processors write the
  // owner's User Bank; shared use still requires an explicit shared grant.
  supportsPersonalScope: true,
  // Gmail is the only V1 provider behind the neutral family contract.
  checkReadiness: (db, args) => checkGmailReadiness(db, args),
  runAcquire: (args) => runGmailAcquire(args),
  projectionKeyFor: projectionKeyForEmailThread,
  subjectKeyFor: subjectKeyForEmailThread,
  buildProjection: (snapshot, sourceItemId) =>
    buildEmailThreadDossier(snapshot, sourceItemId),
  extractClaims: (input) => extractEmailThreadClaims(input),
  editionEffectiveFrom: (snapshot) => {
    const raw = stringOrNull(snapshot.latestMessageAt);
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  },
  // The inline snapshot for email is the content-free skeleton — the focus
  // label is deliberately id-shaped and NEVER subject/body text (AE4).
  focusLabelFor: (_snapshot, sourceItemId) => `Email thread ${sourceItemId}`,
};
