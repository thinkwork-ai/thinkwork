import path from "node:path";

import * as XLSX from "xlsx";

export interface ExtractedAttachmentText {
  text: string;
  readable: boolean;
  kind: "text" | "spreadsheet" | "pdf" | "binary";
}

const CELL_CAP = 50_000;
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
const SHEET_EXTENSIONS = new Set([".xlsx", ".xls", ".xlsm", ".xlsb", ".ods"]);

/** Server-side extraction for governed AgentCore attachment reads. */
export async function extractAttachmentText(input: {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<ExtractedAttachmentText> {
  const ext = path.extname(input.name).toLowerCase();
  const mime = input.mimeType.toLowerCase();
  if (
    SHEET_EXTENSIONS.has(ext) ||
    mime.includes("spreadsheetml") ||
    mime.includes("ms-excel") ||
    mime.includes("opendocument.spreadsheet")
  ) {
    const text = spreadsheetToText(input.bytes);
    return { text, readable: Boolean(text), kind: "spreadsheet" };
  }
  if (ext === ".pdf" || mime.includes("pdf")) {
    const text = await pdfToText(input.bytes);
    return { text, readable: Boolean(text.trim()), kind: "pdf" };
  }
  if (
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("xml") ||
    mime.includes("csv") ||
    TEXT_EXTENSIONS.has(ext) ||
    !input.bytes.subarray(0, 8 * 1024).includes(0)
  ) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(input.bytes);
    return { text, readable: Boolean(text.trim()), kind: "text" };
  }
  return { text: "", readable: false, kind: "binary" };
}

async function pdfToText(bytes: Uint8Array): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const result = await extractText(pdf, { mergePages: true });
    return (
      Array.isArray(result.text) ? result.text.join("\n") : result.text
    ).trim();
  } catch {
    return "";
  }
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
    const range = sheet["!ref"]
      ? XLSX.utils.decode_range(sheet["!ref"]!)
      : null;
    if (range) {
      const columns = range.e.c - range.s.c + 1;
      const sheetCells = (range.e.r - range.s.r + 1) * columns;
      if (cells + sheetCells > CELL_CAP) {
        const rows = Math.max(1, Math.floor((CELL_CAP - cells) / columns));
        range.e.r = Math.min(range.e.r, range.s.r + rows - 1);
        sheet["!ref"] = XLSX.utils.encode_range(range);
        blocks.push(
          `### Sheet: ${sheetName} (truncated to first ${rows} rows)\n${XLSX.utils.sheet_to_csv(sheet, { blankrows: false })}`,
        );
        break;
      }
      cells += sheetCells;
    }
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim()) blocks.push(`### Sheet: ${sheetName}\n${csv}`);
  }
  return blocks.join("\n\n").trim();
}
