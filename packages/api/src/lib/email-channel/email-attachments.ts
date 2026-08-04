/**
 * Resolve and load agent-referenced attachments for outbound email.
 *
 * The agent references attachments by `thread_attachments` row id (the ref
 * it received from `execute_code` output_files or an inbound message) —
 * never by raw S3 key and never by inline bytes. Authorization is the DB
 * row: id must exist under the sending tenant, and its s3_key must sit
 * under that tenant's attachment prefix. Bytes are fetched from the
 * workspace bucket at send time.
 */

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { and, eq, inArray } from "drizzle-orm";
import { threadAttachments } from "@thinkwork/database-pg/schema";
import type { Database } from "@thinkwork/database-pg";
import {
  MAX_EMAIL_ATTACHMENT_COUNT,
  MAX_EMAIL_ATTACHMENT_TOTAL_BYTES,
  type OutboundMimeAttachment,
} from "./outbound-mime.js";

type Db = Pick<Database, "select">;

export interface EmailAttachmentRef {
  attachmentId: string;
  /** Display-name override; defaults to the stored row name. */
  name?: string;
}

export interface ResolvedEmailAttachment {
  attachmentId: string;
  name: string;
  contentType: string;
  s3Key: string;
  sizeBytes: number;
}

export class EmailAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailAttachmentError";
  }
}

/** Resolve refs to validated rows without fetching bytes (approval path
 * persists this metadata; bytes are re-fetched at approved send time). */
export async function resolveEmailAttachments(input: {
  db: Db;
  tenantId: string;
  refs: EmailAttachmentRef[];
}): Promise<ResolvedEmailAttachment[]> {
  if (input.refs.length === 0) return [];
  if (input.refs.length > MAX_EMAIL_ATTACHMENT_COUNT) {
    throw new EmailAttachmentError(
      `Too many attachments: ${input.refs.length} (max ${MAX_EMAIL_ATTACHMENT_COUNT}).`,
    );
  }
  const ids = input.refs.map((ref) => ref.attachmentId);
  const rows = await input.db
    .select()
    .from(threadAttachments)
    .where(
      and(
        eq(threadAttachments.tenant_id, input.tenantId),
        inArray(threadAttachments.id, ids),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const tenantPrefix = `tenants/${input.tenantId}/attachments/`;
  const resolved: ResolvedEmailAttachment[] = [];
  let totalBytes = 0;
  for (const ref of input.refs) {
    const row = byId.get(ref.attachmentId);
    if (!row || !row.s3_key) {
      throw new EmailAttachmentError(
        `Attachment ${ref.attachmentId} was not found for this tenant.`,
      );
    }
    if (!row.s3_key.startsWith(tenantPrefix)) {
      throw new EmailAttachmentError(
        `Attachment ${ref.attachmentId} is outside the tenant attachment prefix.`,
      );
    }
    const sizeBytes = row.size_bytes ?? 0;
    totalBytes += sizeBytes;
    if (totalBytes > MAX_EMAIL_ATTACHMENT_TOTAL_BYTES) {
      throw new EmailAttachmentError(
        `Attachments exceed the ${Math.floor(MAX_EMAIL_ATTACHMENT_TOTAL_BYTES / (1024 * 1024))} MB email limit.`,
      );
    }
    resolved.push({
      attachmentId: row.id,
      name: ref.name || row.name || "attachment",
      contentType: row.mime_type || "application/octet-stream",
      s3Key: row.s3_key,
      sizeBytes,
    });
  }
  return resolved;
}

export async function loadEmailAttachmentBytes(input: {
  s3: S3Client;
  bucket: string;
  attachments: ResolvedEmailAttachment[];
}): Promise<OutboundMimeAttachment[]> {
  const loaded: OutboundMimeAttachment[] = [];
  let totalBytes = 0;
  for (const attachment of input.attachments) {
    const object = await input.s3.send(
      new GetObjectCommand({ Bucket: input.bucket, Key: attachment.s3Key }),
    );
    const bytes = Buffer.from(
      await (object.Body as {
        transformToByteArray(): Promise<Uint8Array>;
      })!.transformToByteArray(),
    );
    totalBytes += bytes.length;
    if (totalBytes > MAX_EMAIL_ATTACHMENT_TOTAL_BYTES) {
      throw new EmailAttachmentError(
        `Attachments exceed the ${Math.floor(MAX_EMAIL_ATTACHMENT_TOTAL_BYTES / (1024 * 1024))} MB email limit.`,
      );
    }
    loaded.push({
      name: attachment.name,
      contentType: attachment.contentType,
      bytes,
    });
  }
  return loaded;
}
