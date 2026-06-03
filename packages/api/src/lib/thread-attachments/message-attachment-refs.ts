import { and, eq, inArray } from "drizzle-orm";
import { messages, threadAttachments } from "@thinkwork/database-pg/schema";

export const MAX_MESSAGE_ATTACHMENT_REFS = 20;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MessageAttachmentRefsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageAttachmentRefsError";
  }
}

export async function canonicalizeMessageAttachmentMetadata(input: {
  db: any;
  tenantId: string;
  threadId: string;
  metadata: unknown;
}): Promise<Record<string, unknown> | undefined> {
  if (input.metadata == null) return undefined;
  const metadata = parseRecord(input.metadata);
  const rawAttachments = metadata.attachments;
  if (rawAttachments == null) return metadata;
  if (!Array.isArray(rawAttachments)) {
    throw new MessageAttachmentRefsError(
      "attachments metadata must be an array",
    );
  }
  if (rawAttachments.length > MAX_MESSAGE_ATTACHMENT_REFS) {
    throw new MessageAttachmentRefsError("too many attachments on message");
  }

  const attachmentIds = dedupeAttachmentIds(rawAttachments);
  if (attachmentIds.length === 0) {
    return { ...metadata, attachments: [] };
  }

  const rows = await input.db
    .select({ id: threadAttachments.id })
    .from(threadAttachments)
    .where(
      and(
        eq(threadAttachments.tenant_id, input.tenantId),
        eq(threadAttachments.thread_id, input.threadId),
        inArray(threadAttachments.id, attachmentIds),
      ),
    );
  const allowed = new Set(rows.map((row: { id: string }) => row.id));
  const missing = attachmentIds.filter((id) => !allowed.has(id));
  if (missing.length > 0) {
    throw new MessageAttachmentRefsError(
      "attachment does not belong to this thread",
    );
  }

  return {
    ...metadata,
    attachments: attachmentIds.map((attachmentId) => ({ attachmentId })),
  };
}

export function dedupeAttachmentIds(rawAttachments: unknown[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of rawAttachments) {
    const record = parseRecord(entry);
    const attachmentId = stringValue(record.attachmentId)?.toLowerCase();
    if (!attachmentId) {
      throw new MessageAttachmentRefsError(
        "attachment reference missing attachmentId",
      );
    }
    if (!UUID_RE.test(attachmentId)) {
      throw new MessageAttachmentRefsError("attachmentId must be a UUID");
    }
    if (seen.has(attachmentId)) continue;
    seen.add(attachmentId);
    ids.push(attachmentId);
  }
  return ids;
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Full attachment record shape the chat dispatch path hands to
 * chat-agent-invoke (camelCase; forwarded to AgentCore as
 * `message_attachments` in snake_case). Mirrors
 * `ChatAgentInvokeAttachment` in graphql/utils.ts.
 */
export interface DispatchMessageAttachment {
  attachmentId: string;
  s3Key: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Resolve the finalized `thread_attachments` records a USER message
 * references via `messages.metadata.attachments`, in metadata order, so the
 * direct chat-agent-invoke dispatch path can pass them to the agent.
 *
 * The wakeup-processor path has always done this (loadChatMessageAttachmentContext);
 * the direct-invoke path added by the AgentCore-first refactor skipped it, so
 * uploaded files were invisible to the agent on both web and desktop. Returns
 * an empty array when the message has no resolvable attachments.
 */
export async function resolveDispatchMessageAttachments(input: {
  db: any;
  tenantId: string;
  threadId: string;
  messageId: string;
}): Promise<DispatchMessageAttachment[]> {
  const [message] = await input.db
    .select({ metadata: messages.metadata })
    .from(messages)
    .where(
      and(
        eq(messages.tenant_id, input.tenantId),
        eq(messages.thread_id, input.threadId),
        eq(messages.id, input.messageId),
      ),
    )
    .limit(1);

  const ids = parseAttachmentIdsFromMetadata(message?.metadata);
  if (ids.length === 0) return [];

  const rows: Array<{
    id: string;
    s3Key: string | null;
    name: string;
    mimeType: string;
    sizeBytes: number;
  }> = await input.db
    .select({
      id: threadAttachments.id,
      s3Key: threadAttachments.s3_key,
      name: threadAttachments.name,
      mimeType: threadAttachments.mime_type,
      sizeBytes: threadAttachments.size_bytes,
    })
    .from(threadAttachments)
    .where(
      and(
        eq(threadAttachments.tenant_id, input.tenantId),
        eq(threadAttachments.thread_id, input.threadId),
        inArray(threadAttachments.id, ids),
      ),
    );

  const byId = new Map(rows.map((row) => [row.id, row]));
  const resolved: DispatchMessageAttachment[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || !row.s3Key) continue;
    resolved.push({
      attachmentId: row.id,
      s3Key: row.s3Key,
      name: row.name,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
    });
  }
  return resolved;
}

/**
 * Parse attachment UUIDs from a message's `metadata.attachments`, tolerating
 * both jsonb (object) and text (stringified JSON) column shapes.
 */
function parseAttachmentIdsFromMetadata(metadata: unknown): string[] {
  let value = metadata;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  const record = parseRecord(value);
  const rawAttachments = Array.isArray(record.attachments)
    ? record.attachments
    : [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of rawAttachments) {
    const attachmentId = stringValue(
      parseRecord(entry).attachmentId,
    )?.toLowerCase();
    if (!attachmentId || !UUID_RE.test(attachmentId)) continue;
    if (seen.has(attachmentId)) continue;
    seen.add(attachmentId);
    ids.push(attachmentId);
  }
  return ids;
}
