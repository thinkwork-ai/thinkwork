import { createHash } from "node:crypto";

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getDb } from "@thinkwork/database-pg";
import { getConfig } from "@thinkwork/runtime-config";

import type { HarnessCapabilityContext } from "../../handlers/harness-capability-mcp.js";
import { extractAttachmentText } from "../thread-attachments/attachment-text.js";
import {
  resolveDispatchMessageAttachments,
  type DispatchMessageAttachment,
} from "../thread-attachments/message-attachment-refs.js";

export type MessageAttachmentAccessErrorCode =
  | "invalid_message_attachment"
  | "message_attachment_not_authorized"
  | "message_attachment_source_unavailable"
  | "message_attachment_too_large"
  | "message_attachment_unreadable";

export class MessageAttachmentAccessError extends Error {
  constructor(
    public readonly code: MessageAttachmentAccessErrorCode,
    message = code,
  ) {
    super(message);
    this.name = "MessageAttachmentAccessError";
  }
}

export interface AuthorizedMessageAttachment {
  attachmentId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ReadMessageAttachmentResult extends AuthorizedMessageAttachment {
  kind: "text" | "spreadsheet" | "pdf";
  content: string;
  contentSha256: string;
  offset: number;
  nextOffset: number | null;
  totalChars: number;
  truncated: boolean;
}

export interface MessageAttachmentToolsDeps {
  resolveAttachments(input: {
    tenantId: string;
    threadId: string;
    messageId: string;
  }): Promise<DispatchMessageAttachment[]>;
  readObject(key: string, maxBytes: number): Promise<Uint8Array>;
}

export const DEFAULT_ATTACHMENT_CHUNK_CHARS = 32 * 1024;
export const MAX_ATTACHMENT_CHUNK_CHARS = 64 * 1024;
export const MAX_ATTACHMENT_SOURCE_BYTES = 25 * 1024 * 1024;

export function createMessageAttachmentTools(deps: MessageAttachmentToolsDeps) {
  const resolveCurrent = async (context: HarnessCapabilityContext) => {
    const attachments = await deps.resolveAttachments({
      tenantId: context.tenantId,
      threadId: context.threadId,
      messageId: context.triggeringMessageId,
    });
    for (const attachment of attachments) {
      assertCanonicalAttachmentKey(context, attachment);
    }
    return attachments;
  };

  return {
    async list(context: HarnessCapabilityContext): Promise<{
      attachmentSetFingerprint: string;
      attachments: AuthorizedMessageAttachment[];
    }> {
      const attachments = (await resolveCurrent(context)).map(toAuthorized);
      return {
        attachmentSetFingerprint: fingerprint(attachments),
        attachments,
      };
    },

    async read(
      context: HarnessCapabilityContext,
      attachmentId: string,
      offset = 0,
      maxChars = DEFAULT_ATTACHMENT_CHUNK_CHARS,
    ): Promise<ReadMessageAttachmentResult> {
      if (!UUID_RE.test(attachmentId)) {
        throw new MessageAttachmentAccessError("invalid_message_attachment");
      }
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(maxChars) ||
        maxChars < 1 ||
        maxChars > MAX_ATTACHMENT_CHUNK_CHARS
      ) {
        throw new MessageAttachmentAccessError("invalid_message_attachment");
      }
      const attachment = (await resolveCurrent(context)).find(
        (candidate) => candidate.attachmentId === attachmentId.toLowerCase(),
      );
      if (!attachment) {
        throw new MessageAttachmentAccessError(
          "message_attachment_not_authorized",
        );
      }
      if (
        attachment.sizeBytes < 0 ||
        attachment.sizeBytes > MAX_ATTACHMENT_SOURCE_BYTES
      ) {
        throw new MessageAttachmentAccessError("message_attachment_too_large");
      }

      let bytes: Uint8Array;
      try {
        bytes = await deps.readObject(
          attachment.s3Key,
          MAX_ATTACHMENT_SOURCE_BYTES,
        );
      } catch (error) {
        if (error instanceof MessageAttachmentAccessError) throw error;
        throw new MessageAttachmentAccessError(
          "message_attachment_source_unavailable",
        );
      }
      if (bytes.byteLength > MAX_ATTACHMENT_SOURCE_BYTES) {
        throw new MessageAttachmentAccessError("message_attachment_too_large");
      }

      const extracted = await extractAttachmentText({
        name: attachment.name,
        mimeType: attachment.mimeType,
        bytes,
      });
      if (!extracted.readable || extracted.kind === "binary") {
        throw new MessageAttachmentAccessError("message_attachment_unreadable");
      }
      if (offset > extracted.text.length) {
        throw new MessageAttachmentAccessError("invalid_message_attachment");
      }
      const nextOffset = Math.min(extracted.text.length, offset + maxChars);
      const content = extracted.text.slice(offset, nextOffset);
      return {
        ...toAuthorized(attachment),
        kind: extracted.kind,
        content,
        contentSha256: createHash("sha256").update(content).digest("hex"),
        offset,
        nextOffset: nextOffset < extracted.text.length ? nextOffset : null,
        totalChars: extracted.text.length,
        truncated: nextOffset < extracted.text.length,
      };
    },
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toAuthorized(
  attachment: DispatchMessageAttachment,
): AuthorizedMessageAttachment {
  return {
    attachmentId: attachment.attachmentId,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
  };
}

function assertCanonicalAttachmentKey(
  context: HarnessCapabilityContext,
  attachment: DispatchMessageAttachment,
) {
  const prefix = `tenants/${context.tenantId}/attachments/${context.threadId}/${attachment.attachmentId}/`;
  if (!attachment.s3Key.startsWith(prefix)) {
    throw new MessageAttachmentAccessError("message_attachment_not_authorized");
  }
}

function fingerprint(attachments: AuthorizedMessageAttachment[]): string {
  return createHash("sha256").update(JSON.stringify(attachments)).digest("hex");
}

const s3 = new S3Client({});

async function readWorkspaceObject(
  key: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const bucket = getConfig("WORKSPACE_BUCKET", "");
  if (!bucket) {
    throw new MessageAttachmentAccessError(
      "message_attachment_source_unavailable",
    );
  }
  const response = await s3.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!response.Body) {
    throw new MessageAttachmentAccessError(
      "message_attachment_source_unavailable",
    );
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new MessageAttachmentAccessError("message_attachment_too_large");
    }
    chunks.push(chunk);
  }
  const combined = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    combined.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return combined;
}

export const messageAttachmentTools = createMessageAttachmentTools({
  resolveAttachments: (input) =>
    resolveDispatchMessageAttachments({ db: getDb(), ...input }),
  readObject: readWorkspaceObject,
});
