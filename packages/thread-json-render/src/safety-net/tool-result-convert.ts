// U8: convert a structured external tool result (e.g. an MCP CRM tool returning
// a list of Opportunities) into a validated `table` GenUI part — the "raw tool
// output should render as a table, not JSON" case. Reuses the U7 table builder
// and the SAME strict validator. Pure: never throws, never mutates input.

import {
  buildValidatedTablePart,
  type SafetyNetConversionResult,
} from "./detect-convert.js";

type Primitive = string | number | boolean | null;

// Homogeneous record arrays larger than this are left untouched — the `table`
// catalog caps rows at 50, so anything larger would be rejected by the
// validator anyway; skip the work and fall back to the existing rendering.
const MAX_RECORDS = 50;

/**
 * Match ONLY a homogeneous array of flat, primitive-valued records and convert
 * it to a validated `table` part. Anything else — a scalar, an empty or
 * single-element array, heterogeneous key sets, or records with nested/array
 * values — returns `{ matched:false }` and the caller keeps the original
 * rendering. Conservative by design, mirroring the U7 markdown guards.
 */
export function convertRecordsToGenUI(
  value: unknown,
): SafetyNetConversionResult {
  try {
    const records = matchRecordArray(value);
    if (!records) return { matched: false };

    const headers = Object.keys(records[0]);
    const rows = records.map((record) =>
      headers.map((key) => primitiveToCell(record[key])),
    );
    return buildValidatedTablePart(headers, rows);
  } catch {
    // Any structural surprise degrades to no-match; never throw to the caller.
    return { matched: false };
  }
}

function matchRecordArray(
  value: unknown,
): Array<Record<string, Primitive>> | null {
  if (!Array.isArray(value)) return null;
  if (value.length < 2 || value.length > MAX_RECORDS) return null;

  const first = value[0];
  if (!isPlainRecord(first)) return null;
  const keys = Object.keys(first);
  if (keys.length === 0) return null;
  const keySet = new Set(keys);

  for (const element of value) {
    if (!isPlainRecord(element)) return null;
    const elementKeys = Object.keys(element);
    // Require an identical key set (same count + same members) so columns are
    // consistent across every row.
    if (elementKeys.length !== keys.length) return null;
    for (const key of elementKeys) {
      if (!keySet.has(key)) return null;
      if (!isPrimitive(element[key])) return null;
    }
  }

  return value as Array<Record<string, Primitive>>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isPrimitive(value: unknown): value is Primitive {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function primitiveToCell(value: Primitive): string {
  if (value === null) return "";
  return String(value);
}
