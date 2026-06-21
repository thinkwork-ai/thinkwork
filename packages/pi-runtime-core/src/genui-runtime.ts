import { createHash } from "node:crypto";

import {
  THREAD_GENUI_PART_TYPE,
  createAnalyticsDisplayGenUIValidationContext,
  createThreadGenUIDiagnosticData,
  createThreadGenUISpecHash,
  validateThreadGenUIData,
  validateThreadGenUIPart,
  type ThreadGenUIDiagnostic,
  type ThreadGenUIData,
  type ThreadGenUIPart,
} from "@thinkwork/genui";

import type { ActivityEmitEvent } from "./agent-loop.js";

export const THREAD_GENUI_ACTIVITY_EVENT_TYPE = "ui_message_chunk" as const;
export const THREAD_GENUI_ACTIVITY_STREAM = "ui" as const;
export const THREAD_GENUI_ACTIVITY_PAYLOAD_KIND =
  "thread_genui.ui_message_chunk" as const;

export interface ThreadGenUIRuntimePartResult {
  part: ThreadGenUIPart;
  ok: boolean;
  diagnostics: ThreadGenUIDiagnostic[];
}

export interface ThreadGenUIActivityPayload {
  kind: typeof THREAD_GENUI_ACTIVITY_PAYLOAD_KIND;
  chunk: ThreadGenUIPart;
}

export function normalizeRuntimeThreadGenUIPart(
  candidate: unknown,
  fallbackId?: string,
): ThreadGenUIRuntimePartResult {
  const context = createAnalyticsDisplayGenUIValidationContext();
  const partResult = validateThreadGenUIPart(candidate, context);
  if (partResult.ok)
    return { part: partResult.part, ok: true, diagnostics: [] };

  const candidateRecord = recordValue(candidate);
  const candidateData =
    candidateRecord?.type === THREAD_GENUI_PART_TYPE
      ? candidateRecord.data
      : candidate;
  const dataResult = validateThreadGenUIData(candidateData, context);
  if (dataResult.ok) {
    const id =
      typeof candidateRecord?.id === "string" && candidateRecord.id
        ? candidateRecord.id
        : fallbackId || stablePartId(dataResult.data);
    return {
      part: { type: THREAD_GENUI_PART_TYPE, id, data: dataResult.data },
      ok: true,
      diagnostics: [],
    };
  }

  const diagnostic = dataResult.diagnostics[0] ??
    partResult.diagnostics[0] ?? {
      code: "GENUI_RUNTIME_INVALID",
      message: "Runtime GenUI payload failed validation.",
      severity: "error" as const,
    };
  const diagnosticData = createThreadGenUIDiagnosticData(diagnostic, {
    title: "Generated UI unavailable",
    summary: diagnostic.message,
  });
  const id =
    (typeof candidateRecord?.id === "string" && candidateRecord.id) ||
    fallbackId ||
    stablePartId(diagnosticData);
  return {
    part: { type: THREAD_GENUI_PART_TYPE, id, data: diagnosticData },
    ok: false,
    diagnostics: [...partResult.diagnostics, ...dataResult.diagnostics],
  };
}

export function threadGenUIActivityEvent(
  part: ThreadGenUIPart,
): ActivityEmitEvent {
  return {
    eventType: THREAD_GENUI_ACTIVITY_EVENT_TYPE,
    message: part.data.mobileFallback.title,
    stream: THREAD_GENUI_ACTIVITY_STREAM,
    payload: {
      kind: THREAD_GENUI_ACTIVITY_PAYLOAD_KIND,
      chunk: part,
    } satisfies ThreadGenUIActivityPayload,
  };
}

export function mergeFinalThreadGenUIParts(
  existing: readonly ThreadGenUIPart[] | undefined,
  incoming: readonly ThreadGenUIPart[],
): ThreadGenUIPart[] {
  const byId = new Map<string, ThreadGenUIPart>();
  for (const part of existing ?? []) byId.set(part.id, part);
  for (const part of incoming) byId.set(part.id, part);
  return [...byId.values()];
}

export function extractRuntimeThreadGenUICandidates(value: unknown): unknown[] {
  const out: unknown[] = [];
  collectCandidates(value, out, 0);
  return out;
}

function collectCandidates(
  value: unknown,
  out: unknown[],
  depth: number,
): void {
  if (depth > 4) return;
  const record = recordValue(value);
  if (!record) return;

  if (record.type === THREAD_GENUI_PART_TYPE || isThreadGenUIDataLike(record)) {
    out.push(record);
  }

  for (const key of [
    "threadGenUI",
    "thread_genui",
    "threadGenUIPart",
    "thread_genui_part",
    "threadGenUIParts",
    "thread_genui_parts",
    "dataGenUI",
    "data_genui",
  ]) {
    const nested = record[key];
    if (Array.isArray(nested)) {
      out.push(...nested);
    } else if (nested !== undefined) {
      out.push(nested);
    }
  }

  for (const key of [
    "details",
    "result",
    "toolResult",
    "rawToolResult",
    "output",
  ]) {
    collectCandidates(record[key], out, depth + 1);
  }
}

function isThreadGenUIDataLike(value: Record<string, unknown>): boolean {
  return (
    value.schemaVersion === "thread-genui/v1" &&
    value.catalogVersion === "thread-genui-catalog/v1" &&
    recordValue(value.spec) !== null
  );
}

function stablePartId(data: ThreadGenUIData): string {
  const basis = data.spec
    ? createThreadGenUISpecHash(data.spec)
    : stableHash(data);
  return `genui:${basis.replace(/^sha256:/, "").slice(0, 24)}`;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(",")}}`;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
