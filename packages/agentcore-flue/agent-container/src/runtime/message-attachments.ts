import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";

export interface MessageAttachmentRef {
  attachment_id?: unknown;
  attachmentId?: unknown;
  s3_key?: unknown;
  s3Key?: unknown;
  name?: unknown;
  mime_type?: unknown;
  mimeType?: unknown;
  size_bytes?: unknown;
  sizeBytes?: unknown;
}

export interface StagedMessageAttachment {
  attachmentId: string;
  localPath: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  textPreview?: string;
}

export interface StageMessageAttachmentsResult {
  turnDir: string;
  staged: StagedMessageAttachment[];
}

interface StageMessageAttachmentsInput {
  attachments: unknown;
  workspaceBucket: string;
  expectedTenantId: string;
  expectedThreadId: string;
  s3Client: Pick<S3Client, "send">;
  tmpRoot?: string;
  logger?: (message: string, details?: Record<string, unknown>) => void;
}

const TEXT_PREVIEW_BYTES = 24 * 1024;
const FILE_READ_LIMIT_BYTES = 512 * 1024;

export async function stageMessageAttachments(
  input: StageMessageAttachmentsInput,
): Promise<StageMessageAttachmentsResult> {
  const refs = Array.isArray(input.attachments) ? input.attachments : [];
  if (refs.length === 0 || !input.workspaceBucket) {
    return { turnDir: "", staged: [] };
  }

  const turnDir = path.join(
    input.tmpRoot ?? "/tmp",
    `flue-turn-${randomUUID()}`,
    "attachments",
  );
  await mkdir(turnDir, { recursive: true });

  const expectedPrefix =
    input.expectedTenantId && input.expectedThreadId
      ? `tenants/${input.expectedTenantId}/attachments/${input.expectedThreadId}/`
      : "";
  const staged: StagedMessageAttachment[] = [];

  for (const rawRef of refs) {
    const ref = normalizeAttachmentRef(rawRef);
    if (!ref) {
      input.logger?.("message_attachment_skipped", { reason: "malformed" });
      continue;
    }
    if (expectedPrefix && !ref.s3Key.startsWith(expectedPrefix)) {
      input.logger?.("message_attachment_skipped", {
        reason: "prefix_mismatch",
        attachmentId: ref.attachmentId,
      });
      continue;
    }

    const localPath = path.join(turnDir, ref.name);
    const relative = path.relative(turnDir, localPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      input.logger?.("message_attachment_skipped", {
        reason: "path_escape",
        attachmentId: ref.attachmentId,
      });
      continue;
    }

    try {
      const object = await input.s3Client.send(
        new GetObjectCommand({
          Bucket: input.workspaceBucket,
          Key: ref.s3Key,
        }),
      );
      const body = await bodyToBuffer(object.Body);
      await writeFile(localPath, body);
      staged.push({
        ...ref,
        localPath,
        textPreview: previewText(body, ref),
      });
    } catch (err) {
      input.logger?.("message_attachment_download_failed", {
        attachmentId: ref.attachmentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (staged.length === 0) {
    await cleanupMessageAttachments(turnDir);
    return { turnDir: "", staged: [] };
  }

  return { turnDir, staged };
}

export async function cleanupMessageAttachments(turnDir: string): Promise<void> {
  if (!turnDir) return;
  await rm(path.dirname(turnDir), { recursive: true, force: true });
}

export function formatMessageAttachmentsPreamble(
  staged: StagedMessageAttachment[],
): string {
  if (staged.length === 0) return "";

  const lines = [
    "Files attached to this turn:",
    "These files are already available to inspect. Do not say that no file is attached.",
  ];
  for (const entry of staged) {
    const sizeKb = Math.max(1, Math.floor((entry.sizeBytes || 0) / 1024));
    lines.push(
      `- ${entry.localPath} (${entry.name}, ${
        entry.mimeType || "application/octet-stream"
      }, ~${sizeKb} KB)`,
    );
    if (entry.textPreview) {
      lines.push(`  Preview:\n${indentFence(entry.textPreview)}`);
    }
  }
  lines.push(
    "Use the `file_read` tool with one of the absolute paths above " +
      "when the user asks about an attached file.",
  );
  return lines.join("\n");
}

export function buildFileReadTool(
  staged: StagedMessageAttachment[],
): AgentTool<any> | null {
  if (staged.length === 0) return null;
  const byPath = new Map(staged.map((entry) => [entry.localPath, entry]));
  return {
    name: "file_read",
    label: "File Read",
    description:
      "Read a file attached to the current user turn. Only the listed " +
      "attachment paths are allowed.",
    parameters: Type.Object({
      path: Type.String({
        description: "Absolute path of an attached file from the prompt.",
      }),
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const requestedPath = String((params as { path?: unknown }).path ?? "");
      const entry = byPath.get(requestedPath);
      if (!entry) {
        throw new Error(
          `Access denied. Available attachment paths: ${[...byPath.keys()].join(", ")}`,
        );
      }
      if (!isProbablyTextAttachment(entry)) {
        return {
          content: [
            {
              type: "text",
              text:
                `${entry.name} is available, but this runtime can only read ` +
                "text-like attachments directly. Use a specialist parser for " +
                `${entry.mimeType || "binary"} files.`,
            },
          ],
          details: { path: entry.localPath, name: entry.name, readable: false },
        };
      }
      const bytes = await readFile(entry.localPath);
      const truncated = bytes.length > FILE_READ_LIMIT_BYTES;
      const text = bytes.subarray(0, FILE_READ_LIMIT_BYTES).toString("utf-8");
      return {
        content: [
          {
            type: "text",
            text: truncated ? `${text}\n\n[truncated after 512 KB]` : text,
          },
        ],
        details: {
          path: entry.localPath,
          name: entry.name,
          readable: true,
          truncated,
        },
      };
    },
  };
}

function normalizeAttachmentRef(raw: unknown):
  | {
      attachmentId: string;
      s3Key: string;
      name: string;
      mimeType: string;
      sizeBytes: number;
    }
  | null {
  if (!raw || typeof raw !== "object") return null;
  const ref = raw as MessageAttachmentRef;
  const attachmentId = stringValue(ref.attachment_id ?? ref.attachmentId);
  const s3Key = stringValue(ref.s3_key ?? ref.s3Key);
  const name = stringValue(ref.name);
  if (!attachmentId || !s3Key || !name || path.basename(name) !== name) {
    return null;
  }
  return {
    attachmentId,
    s3Key,
    name,
    mimeType:
      stringValue(ref.mime_type ?? ref.mimeType) || "application/octet-stream",
    sizeBytes: numberValue(ref.size_bytes ?? ref.sizeBytes),
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (
    typeof (body as { transformToByteArray?: unknown }).transformToByteArray ===
    "function"
  ) {
    const bytes = await (
      body as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray();
    return Buffer.from(bytes);
  }
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error("Unsupported S3 body type");
}

function previewText(
  body: Buffer,
  entry: { mimeType: string; name: string },
): string {
  if (!isProbablyTextAttachment(entry)) return "";
  const text = body.subarray(0, TEXT_PREVIEW_BYTES).toString("utf-8").trim();
  if (!text) return "";
  return body.length > TEXT_PREVIEW_BYTES
    ? `${text}\n\n[preview truncated]`
    : text;
}

function isProbablyTextAttachment(entry: {
  mimeType: string;
  name: string;
}): boolean {
  const mime = entry.mimeType.toLowerCase();
  const ext = path.extname(entry.name).toLowerCase();
  const textExtensions = [
    "",
    ".csv",
    ".json",
    ".md",
    ".markdown",
    ".txt",
    ".tsv",
    ".xml",
    ".yaml",
    ".yml",
  ];
  return (
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("xml") ||
    textExtensions.includes(ext)
  );
}

function indentFence(text: string): string {
  return ["```", text, "```"].join("\n");
}
