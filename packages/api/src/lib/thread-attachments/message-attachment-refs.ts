import { and, eq, inArray } from "drizzle-orm";
import { threadAttachments } from "@thinkwork/database-pg/schema";

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
    throw new MessageAttachmentRefsError("attachments metadata must be an array");
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
