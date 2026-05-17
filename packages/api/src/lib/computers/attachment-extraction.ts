import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { PDFParse } from "pdf-parse";

import {
  validateOoxmlSafety,
  verifyMagicBytes,
} from "../attachments/content-validation.js";

const TEXT_ATTACHMENT_BYTES = 128 * 1024;
const BINARY_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 48_000;
const MAX_WORKBOOK_SHEETS = 8;
const MAX_WORKBOOK_ROWS_PER_SHEET = 80;
const MAX_WORKBOOK_CELLS_PER_ROW = 24;

const xlsxMime =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type AttachmentExtractionKind = "text" | "xlsx" | "pdf";

export type AttachmentExtractionReason =
  | "unsupported_mime_type"
  | "attachment_too_large"
  | "magic_byte_mismatch"
  | "unsafe_ooxml"
  | "parse_failed"
  | "content_empty";

export type AttachmentExtractionResult =
  | {
      readable: true;
      contentText: string;
      truncated: boolean;
      extractionKind: AttachmentExtractionKind;
    }
  | {
      readable: false;
      truncated: false;
      reason: AttachmentExtractionReason;
      extractionKind?: AttachmentExtractionKind;
    };

export interface AttachmentExtractionInput {
  name: string;
  mimeType: string;
  sizeBytes: number;
  body: Buffer;
}

export function attachmentDownloadByteLimit(input: {
  name: string;
  mimeType: string;
}): number {
  const kind = detectAttachmentKind(input);
  if (kind === "text") return TEXT_ATTACHMENT_BYTES;
  if (kind === "xlsx" || kind === "pdf") return BINARY_ATTACHMENT_BYTES;
  return 0;
}

export async function extractAttachmentText(
  input: AttachmentExtractionInput,
): Promise<AttachmentExtractionResult> {
  const kind = detectAttachmentKind(input);
  if (!kind) {
    return {
      readable: false,
      truncated: false,
      reason: "unsupported_mime_type",
    };
  }
  const byteLimit = attachmentDownloadByteLimit(input);
  if (input.sizeBytes > byteLimit && kind !== "text") {
    return {
      readable: false,
      truncated: false,
      reason: "attachment_too_large",
      extractionKind: kind,
    };
  }

  try {
    switch (kind) {
      case "text":
        return extractText(input.body, input.sizeBytes > TEXT_ATTACHMENT_BYTES);
      case "xlsx":
        return await extractXlsx(input.body);
      case "pdf":
        return await extractPdf(input.body);
    }
  } catch (err) {
    console.warn("[computer-runtime] attachment extraction failed", {
      name: input.name,
      mimeType: input.mimeType,
      kind,
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      readable: false,
      truncated: false,
      reason: "parse_failed",
      extractionKind: kind,
    };
  }
}

export function detectAttachmentKind(input: {
  name: string;
  mimeType: string;
}): AttachmentExtractionKind | null {
  const mime = input.mimeType.toLowerCase();
  const name = input.name.toLowerCase();
  if (mime === xlsxMime || name.endsWith(".xlsx")) return "xlsx";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("xml") ||
    name.endsWith(".csv") ||
    name.endsWith(".json") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown") ||
    name.endsWith(".tsv") ||
    name.endsWith(".txt") ||
    name.endsWith(".xml") ||
    name.endsWith(".yaml") ||
    name.endsWith(".yml")
  ) {
    return "text";
  }
  return null;
}

function extractText(
  body: Buffer,
  truncated: boolean,
): AttachmentExtractionResult {
  const contentText = body.toString("utf-8").trim();
  if (!contentText) {
    return {
      readable: false,
      truncated: false,
      reason: "content_empty",
      extractionKind: "text",
    };
  }
  return { readable: true, contentText, truncated, extractionKind: "text" };
}

async function extractXlsx(body: Buffer): Promise<AttachmentExtractionResult> {
  const magic = verifyMagicBytes(body, ".xlsx");
  if (!magic.ok) {
    return {
      readable: false,
      truncated: false,
      reason: "magic_byte_mismatch",
      extractionKind: "xlsx",
    };
  }
  const safety = await validateOoxmlSafety(body);
  if (!safety.ok) {
    return {
      readable: false,
      truncated: false,
      reason: "unsafe_ooxml",
      extractionKind: "xlsx",
    };
  }

  const zip = await JSZip.loadAsync(body);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    parseTagValue: false,
    trimValues: true,
  });
  const sharedStrings = await loadSharedStrings(zip, parser);
  const sheetNames = await loadSheetNames(zip, parser);
  const worksheetPaths = Object.keys(zip.files)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .slice(0, MAX_WORKBOOK_SHEETS);

  const lines = ["Workbook attachment extracted from .xlsx"];
  let workbookTruncated = worksheetPaths.length >= MAX_WORKBOOK_SHEETS;
  for (const path of worksheetPaths) {
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    const parsed = parser.parse(xml);
    const rows = arrayify(
      getObject(getObject(parsed, "worksheet"), "sheetData")?.row,
    );
    const sheetName =
      sheetNames.get(path) ?? path.replace(/^xl\/worksheets\//, "");
    lines.push("", `Sheet: ${sheetName}`);
    let emittedRows = 0;
    for (const row of rows) {
      const rowObject = asObject(row);
      if (!rowObject) continue;
      const cells = arrayify(rowObject.c)
        .slice(0, MAX_WORKBOOK_CELLS_PER_ROW)
        .map((cell) => formatCell(cell, sharedStrings))
        .filter(Boolean);
      if (cells.length === 0) continue;
      const rowNumber = stringAttr(rowObject, "r") ?? String(emittedRows + 1);
      lines.push(`Row ${rowNumber}: ${cells.join(" | ")}`);
      emittedRows++;
      if (emittedRows >= MAX_WORKBOOK_ROWS_PER_SHEET) {
        workbookTruncated = true;
        break;
      }
    }
    if (emittedRows === 0) lines.push("(no visible cell values)");
  }

  const text = lines.join("\n").trim();
  if (!text || worksheetPaths.length === 0) {
    return {
      readable: false,
      truncated: false,
      reason: "content_empty",
      extractionKind: "xlsx",
    };
  }
  const capped = capText(text);
  return {
    readable: true,
    contentText: capped.text,
    truncated: workbookTruncated || capped.truncated,
    extractionKind: "xlsx",
  };
}

async function extractPdf(body: Buffer): Promise<AttachmentExtractionResult> {
  const magic = verifyMagicBytes(body, ".pdf");
  if (!magic.ok) {
    return {
      readable: false,
      truncated: false,
      reason: "magic_byte_mismatch",
      extractionKind: "pdf",
    };
  }

  const parser = new PDFParse({ data: body });
  try {
    const result = await parser.getText();
    const text = String(result.text ?? "").trim();
    if (!text) {
      return {
        readable: false,
        truncated: false,
        reason: "content_empty",
        extractionKind: "pdf",
      };
    }
    const capped = capText(text);
    return {
      readable: true,
      contentText: capped.text,
      truncated: capped.truncated,
      extractionKind: "pdf",
    };
  } finally {
    await parser.destroy();
  }
}

async function loadSharedStrings(
  zip: JSZip,
  parser: XMLParser,
): Promise<string[]> {
  const xml = await zip.file("xl/sharedStrings.xml")?.async("string");
  if (!xml) return [];
  const parsed = parser.parse(xml);
  const entries = arrayify(getObject(parsed, "sst")?.si);
  return entries.map((entry) => collectText(entry));
}

async function loadSheetNames(
  zip: JSZip,
  parser: XMLParser,
): Promise<Map<string, string>> {
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!workbookXml || !relsXml) return new Map();

  const workbook = parser.parse(workbookXml);
  const rels = parser.parse(relsXml);
  const relById = new Map<string, string>();
  for (const rel of arrayify(getObject(rels, "Relationships")?.Relationship)) {
    const relObject = asObject(rel);
    if (!relObject) continue;
    const id = stringAttr(relObject, "Id");
    const target = stringAttr(relObject, "Target");
    if (id && target) relById.set(id, normalizeWorkbookTarget(target));
  }

  const names = new Map<string, string>();
  for (const sheet of arrayify(
    getObject(getObject(workbook, "workbook"), "sheets")?.sheet,
  )) {
    const sheetObject = asObject(sheet);
    if (!sheetObject) continue;
    const name = stringAttr(sheetObject, "name");
    const relId = stringAttr(sheetObject, "r:id");
    if (!name || !relId) continue;
    const target = relById.get(relId);
    if (target) names.set(target, name);
  }
  return names;
}

function normalizeWorkbookTarget(target: string): string {
  const normalized = target.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized}`;
}

function formatCell(cell: unknown, sharedStrings: string[]): string {
  const cellObject = asObject(cell);
  if (!cellObject) return "";
  const address = stringAttr(cellObject, "r");
  const type = stringAttr(cellObject, "t");
  let value = "";
  if (type === "s") {
    const index = Number(getTextValue(cellObject.v));
    value = Number.isFinite(index) ? (sharedStrings[index] ?? "") : "";
  } else if (type === "inlineStr") {
    value = collectText(cellObject.is);
  } else {
    value = getTextValue(cellObject.v) || collectText(cellObject.is);
  }
  value = value.replace(/\s+/g, " ").trim();
  if (!value) return "";
  return address ? `${address}=${value}` : value;
}

function collectText(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  const object = asObject(node);
  if (!object) return "";
  const parts: string[] = [];
  for (const key of ["t", "#text", "r", "si"]) {
    if (key in object) parts.push(collectText(object[key]));
  }
  return parts.join("");
}

function getTextValue(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  const object = asObject(node);
  if (object && "#text" in object) return getTextValue(object["#text"]);
  return "";
}

function arrayify(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getObject(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  return asObject(value)?.[key] as Record<string, unknown> | undefined;
}

function stringAttr(
  object: Record<string, unknown>,
  key: string,
): string | null {
  const value = object[`@_${key}`];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}

function capText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_EXTRACTED_CHARS) return { text, truncated: false };
  return {
    text: text.slice(0, MAX_EXTRACTED_CHARS).trimEnd(),
    truncated: true,
  };
}
