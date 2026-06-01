import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as XLSX from "xlsx";

/**
 * Shared attachment text extraction + `file_read` tool.
 *
 * Every Thinkwork runtime (cloud AgentCore, desktop Local Pi, mobile Lambda)
 * exposes the same `file_read` tool contract that the finance skills declare in
 * `allowed-tools`. The skills do NOT execute code — they read an attached
 * statement via `file_read(<path>)` and reason over the returned cell values.
 *
 * The hard part is turning a *binary* statement (`.xlsx`/`.xls`) into text. We
 * do that here in pure TypeScript (SheetJS) so the contract holds on runtimes
 * with no Python — desktop just-bash is text-only (`python: false`) and cannot
 * parse a spreadsheet. See `project_desktop_justbash_text_only_sandbox`.
 */

export interface MessageAttachmentRef {
  attachment_id?: unknown;
  attachmentId?: unknown;
  s3_key?: unknown;
  s3Key?: unknown;
  download_url?: unknown;
  downloadUrl?: unknown;
  name?: unknown;
  mime_type?: unknown;
  mimeType?: unknown;
  size_bytes?: unknown;
  sizeBytes?: unknown;
}

export interface NormalizedAttachmentRef {
  attachmentId: string;
  s3Key: string;
  downloadUrl: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface StagedMessageAttachment {
  attachmentId: string;
  localPath: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  textPreview?: string;
}

export interface ExtractedAttachmentText {
  /** Plain-text rendering of the attachment, or "" when not extractable. */
  text: string;
  /** Whether `text` carries usable content the model can reason over. */
  readable: boolean;
  /** Coarse format classification, for logging/diagnostics. */
  kind: "text" | "spreadsheet" | "pdf" | "binary";
}

const TEXT_PREVIEW_BYTES = 24 * 1024;
const FILE_READ_LIMIT_CHARS = 512 * 1024;
const SPREADSHEET_CELL_CAP = 50_000;

const TEXT_EXTENSIONS = new Set([
  "",
  ".csv",
  ".json",
  ".log",
  ".md",
  ".markdown",
  ".tsv",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const SPREADSHEET_EXTENSIONS = new Set([
  ".xlsx",
  ".xls",
  ".xlsm",
  ".xlsb",
  ".ods",
]);

/**
 * Convert raw attachment bytes into text the model can read. Spreadsheets are
 * rendered as one CSV block per sheet; already-text formats pass through.
 * Unknown binary formats return `readable: false` so callers can surface a
 * clear "use a specialist parser" message instead of dumping garbage.
 */
export async function extractAttachmentText(input: {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<ExtractedAttachmentText> {
  const ext = path.extname(input.name).toLowerCase();
  const mime = (input.mimeType || "").toLowerCase();

  if (isSpreadsheet(ext, mime)) {
    const text = spreadsheetToText(input.bytes);
    return { text, readable: text.length > 0, kind: "spreadsheet" };
  }

  if (isPdf(ext, mime)) {
    const text = await pdfToText(input.bytes);
    return { text, readable: text.trim().length > 0, kind: "pdf" };
  }

  if (isTextLike(ext, mime, input.bytes)) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(input.bytes);
    return { text, readable: text.trim().length > 0, kind: "text" };
  }

  return { text: "", readable: false, kind: "binary" };
}

function isPdf(ext: string, mime: string): boolean {
  return ext === ".pdf" || mime.includes("pdf");
}

async function pdfToText(bytes: Uint8Array): Promise<string> {
  try {
    // unpdf bundles a serverless pdfjs build (no canvas/worker), so it runs in
    // the desktop sidecar and the cloud Lambda without native deps. Loaded
    // lazily: it's a heavy dep that hosts externalize, so a missing/broken
    // install degrades PDF reads instead of crashing the whole runtime.
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const result = await extractText(pdf, { mergePages: true });
    const raw = result.text as string | string[];
    return (Array.isArray(raw) ? raw.join("\n") : raw).trim();
  } catch {
    return "";
  }
}

function isSpreadsheet(ext: string, mime: string): boolean {
  return (
    SPREADSHEET_EXTENSIONS.has(ext) ||
    mime.includes("spreadsheetml") ||
    mime.includes("ms-excel") ||
    mime.includes("opendocument.spreadsheet")
  );
}

function isTextLike(ext: string, mime: string, bytes: Uint8Array): boolean {
  if (
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("xml") ||
    mime.includes("csv") ||
    TEXT_EXTENSIONS.has(ext)
  ) {
    return true;
  }
  // Unknown extension + unknown mime: sniff for NUL bytes in the head. A binary
  // file (zip, image, pdf) almost always has one early; UTF-8 text never does.
  const head = bytes.subarray(0, 8 * 1024);
  return !head.includes(0);
}

function spreadsheetToText(bytes: Uint8Array): string {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: "array" });
  } catch {
    return "";
  }
  const blocks: string[] = [];
  let cells = 0;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    // Cap total cells so a huge GL can't blow the context window; the model
    // still gets the shape + the leading rows it needs to reason about.
    const ref = sheet["!ref"];
    if (ref) {
      const range = XLSX.utils.decode_range(ref);
      const sheetCells =
        (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
      if (cells + sheetCells > SPREADSHEET_CELL_CAP) {
        const rowsLeft = Math.max(
          1,
          Math.floor(
            (SPREADSHEET_CELL_CAP - cells) / (range.e.c - range.s.c + 1),
          ),
        );
        range.e.r = Math.min(range.e.r, range.s.r + rowsLeft - 1);
        sheet["!ref"] = XLSX.utils.encode_range(range);
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        blocks.push(
          `### Sheet: ${sheetName} (truncated to first ${rowsLeft} rows)\n${csv}`,
        );
        break;
      }
      cells += sheetCells;
    }
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim().length === 0) continue;
    blocks.push(`### Sheet: ${sheetName}\n${csv}`);
  }
  return blocks.join("\n\n").trim();
}

export function normalizeAttachmentRef(
  raw: unknown,
): NormalizedAttachmentRef | null {
  if (!raw || typeof raw !== "object") return null;
  const ref = raw as MessageAttachmentRef;
  const attachmentId = stringValue(ref.attachment_id ?? ref.attachmentId);
  const s3Key = stringValue(ref.s3_key ?? ref.s3Key);
  const name = stringValue(ref.name);
  if (!attachmentId || !name || path.basename(name) !== name) {
    return null;
  }
  return {
    attachmentId,
    s3Key,
    downloadUrl: stringValue(ref.download_url ?? ref.downloadUrl),
    name,
    mimeType:
      stringValue(ref.mime_type ?? ref.mimeType) || "application/octet-stream",
    sizeBytes: numberValue(ref.size_bytes ?? ref.sizeBytes),
  };
}

export interface StageAttachmentsViaFetchInput {
  attachments: unknown;
  turnDir: string;
  fetchImpl?: typeof fetch;
  logger?: (message: string, details?: Record<string, unknown>) => void;
}

/**
 * Desktop/mobile staging path: download each attachment over its presigned
 * `download_url` (the runtime has no AWS credentials) and write it to a real
 * host temp dir that the sidecar's `file_read` tool can read.
 */
export async function stageAttachmentsViaFetch(
  input: StageAttachmentsViaFetchInput,
): Promise<StagedMessageAttachment[]> {
  const refs = Array.isArray(input.attachments) ? input.attachments : [];
  if (refs.length === 0) return [];
  const fetchImpl = input.fetchImpl ?? fetch;
  await mkdir(input.turnDir, { recursive: true });
  const staged: StagedMessageAttachment[] = [];

  for (const rawRef of refs) {
    const ref = normalizeAttachmentRef(rawRef);
    if (!ref) {
      input.logger?.("message_attachment_skipped", { reason: "malformed" });
      continue;
    }
    if (!ref.downloadUrl) {
      input.logger?.("message_attachment_skipped", {
        reason: "missing_download_url",
        attachmentId: ref.attachmentId,
      });
      continue;
    }
    const localPath = path.join(input.turnDir, ref.name);
    const relative = path.relative(input.turnDir, localPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      input.logger?.("message_attachment_skipped", {
        reason: "path_escape",
        attachmentId: ref.attachmentId,
      });
      continue;
    }
    try {
      const response = await fetchImpl(ref.downloadUrl);
      if (!response.ok) {
        throw new Error(`download failed (${response.status})`);
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      await writeFile(localPath, bytes);
      staged.push({
        attachmentId: ref.attachmentId,
        localPath,
        name: ref.name,
        mimeType: ref.mimeType,
        sizeBytes: ref.sizeBytes || bytes.byteLength,
        textPreview: await previewText(bytes, ref),
      });
    } catch (err) {
      input.logger?.("message_attachment_download_failed", {
        attachmentId: ref.attachmentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return staged;
}

export async function cleanupStagedAttachments(turnDir: string): Promise<void> {
  if (!turnDir) return;
  await rm(turnDir, { recursive: true, force: true });
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
    "Use the `file_read` tool with one of the absolute paths above when the " +
      "user asks about an attached file. Spreadsheets are returned as CSV " +
      "(one block per sheet).",
  );
  return lines.join("\n");
}

/**
 * Build the `file_read` ToolDefinition for fetch-staged attachments. Reads a
 * staged file from the host FS and returns it as text — converting binary
 * spreadsheets via `extractAttachmentText`.
 */
export function buildFileReadToolDefinition(
  staged: StagedMessageAttachment[],
): ToolDefinition | null {
  if (staged.length === 0) return null;
  const byPath = new Map(staged.map((entry) => [entry.localPath, entry]));
  return {
    name: "file_read",
    label: "File Read",
    description:
      "Read a file attached to the current user turn. Only the listed " +
      "attachment paths are allowed. Spreadsheets (.xlsx/.xls) are returned " +
      "as CSV, one block per sheet.",
    parameters: Type.Object({
      path: Type.String({
        description: "Absolute path of an attached file from the prompt.",
      }),
    }),
    executionMode: "sequential",
    execute: async (_toolCallId: string, params: unknown) => {
      const requestedPath = String((params as { path?: unknown }).path ?? "");
      const entry = byPath.get(requestedPath);
      if (!entry) {
        throw new Error(
          `Access denied. Available attachment paths: ${[...byPath.keys()].join(", ")}`,
        );
      }
      const bytes = new Uint8Array(await readFile(entry.localPath));
      const extracted = await extractAttachmentText({
        name: entry.name,
        mimeType: entry.mimeType,
        bytes,
      });
      if (!extracted.readable) {
        return {
          content: [
            {
              type: "text",
              text:
                `${entry.name} is attached, but this runtime cannot extract ` +
                `text from ${entry.mimeType || "this binary format"}. Ask the ` +
                "user to provide it as CSV or Excel, or delegate to the cloud agent.",
            },
          ],
          details: { path: entry.localPath, name: entry.name, readable: false },
        };
      }
      const truncated = extracted.text.length > FILE_READ_LIMIT_CHARS;
      const text = truncated
        ? `${extracted.text.slice(0, FILE_READ_LIMIT_CHARS)}\n\n[truncated after 512 KB]`
        : extracted.text;
      return {
        content: [{ type: "text", text }],
        details: {
          path: entry.localPath,
          name: entry.name,
          kind: extracted.kind,
          readable: true,
          truncated,
        },
      };
    },
  } as ToolDefinition;
}

async function previewText(
  bytes: Uint8Array,
  ref: NormalizedAttachmentRef,
): Promise<string> {
  const extracted = await extractAttachmentText({
    name: ref.name,
    mimeType: ref.mimeType,
    bytes,
  });
  if (!extracted.readable) return "";
  const text = extracted.text.slice(0, TEXT_PREVIEW_BYTES).trim();
  if (!text) return "";
  return extracted.text.length > TEXT_PREVIEW_BYTES
    ? `${text}\n\n[preview truncated]`
    : text;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function indentFence(text: string): string {
  return ["```", text, "```"].join("\n");
}
