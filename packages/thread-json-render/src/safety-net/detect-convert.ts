// Deterministic safety-net backstop (THINK-116, U7, KTD5).
//
// Pure, runtime-agnostic converter that catches structured content the model
// returned as *markdown* — a GFM table, or a clean homogeneous list of records —
// and turns it into a validated `table` json-render spec. The converted part is
// routed through the SAME strict validator (`validateThreadJsonRenderData`) that
// gates model-authored specs; there is no bypass.
//
// Design invariants:
//   * Never throws. Never mutates the input string.
//   * Conservative detection: prefer false negatives over false positives. A
//     stray `|` in prose, a single-column "table", a fenced code block, or a
//     misaligned separator must NOT convert.
//   * On validation failure the result is `{ matched: false }` — the caller
//     keeps the original prose untouched.

import { createThreadJsonRenderSpecHash } from "../hash.js";
import {
  THREAD_JSON_RENDER_CATALOG_VERSION,
  THREAD_JSON_RENDER_SCHEMA_VERSION,
  type ThreadJsonRenderData,
  type ThreadJsonRenderDiagnostic,
  type ThreadJsonRenderSpec,
} from "../spec.js";
import { validateThreadJsonRenderData } from "../validation.js";

// Catalog `table` limits (catalog.ts): columns.max(16), rows.max(50). The
// validator is still the gate — these caps only stop us building a spec we
// already know it will reject.
const MAX_COLUMNS = 16;
const MAX_ROWS = 50;
// Matches the validator's default `maxFallbackLines`.
const MAX_FALLBACK_LINES = 12;

export interface SafetyNetSourceSpan {
  /** 0-based index of the first source line in the converted block. */
  startLine: number;
  /** Exclusive 0-based index of the line after the converted block. */
  endLine: number;
}

export interface SafetyNetConversionResult {
  /** True only when a structured block was detected AND validated. */
  matched: boolean;
  /** The validated json-render data. Present only when `matched` is true. */
  part?: ThreadJsonRenderData;
  /** Validator diagnostics when a candidate was detected but rejected. */
  diagnostics?: ThreadJsonRenderDiagnostic[];
  /** Line span of the detected block in the source text. */
  sourceSpan?: SafetyNetSourceSpan;
}

interface DetectedTable {
  headers: string[];
  rows: string[][];
  span: SafetyNetSourceSpan;
}

/**
 * Detect a single structured block (GFM table first, then a clean list of
 * records) in assistant text and convert the first one found into a validated
 * `table` json-render part. Returns `{ matched: false }` when nothing clean is
 * found or when the converted spec fails validation.
 */
export function detectAndConvert(text: string): SafetyNetConversionResult {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { matched: false };
  }

  let detected: DetectedTable | null = null;
  try {
    const lines = text.split("\n");
    detected = detectGfmTable(lines) ?? detectRecordList(lines);
  } catch {
    // Detection is best-effort; any parsing surprise degrades to no-match.
    return { matched: false };
  }
  if (!detected) return { matched: false };

  return convertDetectedTable(detected);
}

// ---------------------------------------------------------------------------
// GFM table detection
// ---------------------------------------------------------------------------

function detectGfmTable(lines: string[]): DetectedTable | null {
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isFenceToggle(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    // A table needs a header line, a separator line directly below it, and at
    // least one body row. The header must itself look like a table row.
    const separator = lines[i + 1];
    if (separator === undefined) break;
    if (!looksLikeTableRow(line)) continue;

    const headerCells = splitRow(line);
    if (headerCells.length < 2) continue; // single-column tables are rejected.

    const separatorCells = splitRow(separator);
    if (separatorCells.length !== headerCells.length) continue;
    if (!separatorCells.every(isSeparatorCell)) continue;

    // Collect contiguous body rows whose column count matches the header
    // exactly. A ragged or non-row line terminates the table.
    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length; j += 1) {
      const candidate = lines[j];
      if (isFenceToggle(candidate)) break;
      if (!looksLikeTableRow(candidate)) break;
      const cells = splitRow(candidate);
      if (cells.length !== headerCells.length) break;
      rows.push(cells);
      if (rows.length >= MAX_ROWS + 1) break; // over-cap; validator will reject.
    }

    if (rows.length === 0) continue; // header + separator with no body: not a table.

    return {
      headers: headerCells,
      rows,
      span: { startLine: i, endLine: j },
    };
  }
  return null;
}

function looksLikeTableRow(line: string | undefined): boolean {
  if (line === undefined) return false;
  // A table row must contain at least one unescaped pipe and some non-pipe
  // content. Blank lines and prose without pipes are rejected.
  if (line.trim().length === 0) return false;
  return countUnescapedPipes(line) >= 1;
}

function countUnescapedPipes(line: string): number {
  let count = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === "|" && line[i - 1] !== "\\") count += 1;
  }
  return count;
}

// Split a markdown table row into trimmed cell strings, honoring backslash-
// escaped pipes and dropping the empty leading/trailing cells produced by a
// leading/trailing `|`.
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\\" && line[i + 1] === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);

  const trimmed = line.trim();
  if (trimmed.startsWith("|")) cells.shift();
  if (trimmed.endsWith("|") && cells.length > 0) cells.pop();

  return cells.map((cell) => cell.trim());
}

function isSeparatorCell(cell: string): boolean {
  return /^:?-{1,}:?$/.test(cell.trim());
}

function isFenceToggle(line: string | undefined): boolean {
  if (line === undefined) return false;
  // Up to three leading spaces are allowed before a code fence in CommonMark.
  return /^ {0,3}(```|~~~)/.test(line);
}

// ---------------------------------------------------------------------------
// List-of-records detection (only when clean + homogeneous)
// ---------------------------------------------------------------------------

interface RecordBlock {
  fields: Array<{ key: string; value: string }>;
  startLine: number;
  endLine: number;
}

function detectRecordList(lines: string[]): DetectedTable | null {
  const records: RecordBlock[] = [];
  let inFence = false;
  let i = 0;

  // Find the first top-level `- ` bullet, then greedily read a run of records.
  while (i < lines.length) {
    const line = lines[i];
    if (isFenceToggle(line)) {
      inFence = !inFence;
      i += 1;
      continue;
    }
    if (inFence || !isRecordBullet(line)) {
      // Once a record run has started, any non-bullet, non-continuation line
      // ends it. (Continuations are consumed inside parseRecord.)
      if (records.length > 0 && line.trim().length !== 0) break;
      i += 1;
      continue;
    }

    const parsed = parseRecord(lines, i);
    if (!parsed) {
      // A bullet we cannot parse cleanly makes the run ambiguous — bail out
      // entirely rather than convert a partial/misread structure.
      return null;
    }
    records.push(parsed);
    i = parsed.endLine;
  }

  if (records.length < 2) return null;

  // Homogeneity: every record must share the same ordered key set, with at
  // least two fields. Anything else is ambiguous — skip.
  const keys = records[0].fields.map((field) => field.key);
  if (keys.length < 2) return null;
  for (const record of records) {
    if (record.fields.length !== keys.length) return null;
    for (let k = 0; k < keys.length; k += 1) {
      if (record.fields[k].key !== keys[k]) return null;
    }
  }

  const rows = records.map((record) => record.fields.map((field) => field.value));
  return {
    headers: keys,
    rows,
    span: {
      startLine: records[0].startLine,
      endLine: records[records.length - 1].endLine,
    },
  };
}

function isRecordBullet(line: string): boolean {
  return /^-\s+\S/.test(line);
}

// Parse a single record: the `- key: value` bullet line plus any indented
// `  key: value` continuation lines. Returns null if any line in the record is
// not a clean single-line `key: value` pair.
function parseRecord(lines: string[], start: number): RecordBlock | null {
  const fields: Array<{ key: string; value: string }> = [];

  const bulletContent = lines[start].replace(/^-\s+/, "");
  const bulletField = parseKeyValue(bulletContent);
  if (!bulletField) return null;
  fields.push(bulletField);

  let i = start + 1;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().length === 0) break; // blank line ends the record.
    if (isRecordBullet(line)) break; // next record.
    if (!/^\s+\S/.test(line)) return null; // dedented non-blank line: ambiguous.
    const field = parseKeyValue(line.trim());
    if (!field) return null; // continuation that is not key: value: ambiguous.
    fields.push(field);
  }

  return { fields, startLine: start, endLine: i };
}

function parseKeyValue(text: string): { key: string; value: string } | null {
  const match = /^([^:]{1,60}):\s+(\S.*)$/.exec(text);
  if (!match) return null;
  const key = match[1].trim();
  const value = match[2].trim();
  if (key.length === 0 || value.length === 0) return null;
  // Reject keys that carry markdown structure — keeps detection conservative.
  if (/[|`*_[\]]/.test(key)) return null;
  return { key, value };
}

// ---------------------------------------------------------------------------
// Conversion → validated `table` json-render data
// ---------------------------------------------------------------------------

function convertDetectedTable(
  detected: DetectedTable,
): SafetyNetConversionResult {
  const result = buildValidatedTablePart(detected.headers, detected.rows);
  return result.matched
    ? { ...result, sourceSpan: detected.span }
    : result;
}

/**
 * Build a validated `table` json-render part from a header list and a
 * string-cell grid. Shared by the markdown safety net (U7) and the structured
 * tool-result converter (U8) so there is a single source of truth for the
 * `table` spec shape, mobile fallback, and the strict-validator gate. Returns
 * `{ matched:false, diagnostics }` when the spec fails validation; never throws.
 */
export function buildValidatedTablePart(
  headers: string[],
  cellRows: string[][],
): SafetyNetConversionResult {
  const columnIds = buildColumnIds(headers);
  const columns = headers.map((header, index) => ({
    id: columnIds[index],
    header: header.length > 0 ? header : columnIds[index],
  }));

  const rows = cellRows.map((cells, rowIndex) => {
    const row: Record<string, string> = { id: `row-${rowIndex + 1}` };
    columnIds.forEach((columnId, columnIndex) => {
      // `id` is reserved for row identity; never let a column named "id"
      // clobber it (buildColumnIds already avoids the collision, but guard).
      if (columnId === "id") return;
      row[columnId] = cells[columnIndex] ?? "";
    });
    return row;
  });

  const spec: ThreadJsonRenderSpec = {
    root: "table",
    elements: {
      table: {
        type: "table",
        props: { columns, rows },
        children: [],
      },
    },
  };

  const data: ThreadJsonRenderData = {
    schemaVersion: THREAD_JSON_RENDER_SCHEMA_VERSION,
    catalogVersion: THREAD_JSON_RENDER_CATALOG_VERSION,
    status: "ready",
    spec,
    mobileFallback: buildMobileFallback(headers, cellRows),
    specHash: createThreadJsonRenderSpecHash(spec),
  };

  const validation = validateThreadJsonRenderData(data);
  if (!validation.ok) {
    return { matched: false, diagnostics: validation.diagnostics };
  }

  return { matched: true, part: validation.data };
}

function buildMobileFallback(headers: string[], cellRows: string[][]) {
  const rowCount = cellRows.length;
  const columnCount = headers.length;
  const summary =
    `${rowCount} ${plural(rowCount, "row", "rows")}, ` +
    `${columnCount} ${plural(columnCount, "column", "columns")}`;

  const lines = cellRows
    .slice(0, MAX_FALLBACK_LINES)
    .map((cells) => cells.join(" — "));

  return {
    title: "Table",
    summary,
    ...(lines.length > 0 ? { lines } : {}),
  };
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

// Derive stable, unique, non-empty column ids from headers. Headers that
// slugify to the same value (or to the reserved `id`) are disambiguated with a
// numeric suffix.
function buildColumnIds(headers: string[]): string[] {
  const used = new Set<string>();
  return headers.map((header, index) => {
    let base = slugify(header);
    if (base.length === 0) base = `col-${index + 1}`;
    if (base === "id") base = `col-${index + 1}`;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  });
}

function slugify(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
