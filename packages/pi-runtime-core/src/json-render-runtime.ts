import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  THREAD_JSON_RENDER_CATALOG_VERSION,
  THREAD_JSON_RENDER_PART_TYPE,
  THREAD_JSON_RENDER_SCHEMA_VERSION,
  createThreadJsonRenderSpecHash,
  threadJsonRenderComponentDefinitions,
  type ThreadJsonRenderData,
  type ThreadJsonRenderDiagnostic,
  type ThreadJsonRenderPart,
  type ThreadJsonRenderSpec,
  validateThreadJsonRenderData,
  validateThreadJsonRenderPart,
} from "@thinkwork/thread-json-render";

import type { ActivityEmitEvent } from "./agent-loop.js";

export const THREAD_JSON_RENDER_UI_CAPABILITY =
  "thread-json-render-ui" as const;
export const EMIT_JSON_RENDER_UI_TOOL_NAME = "emit_json_render_ui" as const;
export const THREAD_JSON_RENDER_ACTIVITY_EVENT_TYPE =
  "ui_message_chunk" as const;
export const THREAD_JSON_RENDER_ACTIVITY_STREAM = "ui" as const;
export const THREAD_JSON_RENDER_ACTIVITY_PAYLOAD_KIND =
  "thread_json_render.ui_message_chunk" as const;

export interface ThreadJsonRenderRuntimePartResult {
  part?: ThreadJsonRenderPart;
  ok: boolean;
  diagnostics: ThreadJsonRenderDiagnostic[];
}

export interface ThreadJsonRenderActivityPayload {
  kind: typeof THREAD_JSON_RENDER_ACTIVITY_PAYLOAD_KIND;
  chunk: ThreadJsonRenderPart;
}

export function buildEmitJsonRenderUiTool(): AgentTool<any> {
  return {
    name: EMIT_JSON_RENDER_UI_TOOL_NAME,
    label: "Emit json-render UI",
    description:
      "Emit a complete, bounded json-render UI part for the current Thread. " +
      "Use this when structured UI is clearly better than prose, especially " +
      "for scan-friendly result.list collections of Work Items, user-question " +
      "summaries, approval/review queues, and similar result sets. Keep true " +
      "blocking clarifications on ask_user_question instead of generated UI. " +
      "Provide a full spec using root/elements/type/props/children plus mobileFallback. " +
      "Do not include secrets, OAuth tokens, API keys, raw connector payloads, " +
      "arbitrary URLs, scripts, callbacks, imports, or route instructions. " +
      "For actionable approval or review UI, pair component action references " +
      "such as task.review.primaryActionId or form.action.submitActionId with " +
      "matching durableActions descriptors; result.list item action ids must " +
      "also reference matching durableActions descriptors. Work Item approval actions should " +
      'use params target "work_item_status", workItemId, and statusCategory or statusId.',
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["spec", "mobileFallback"],
      properties: {
        id: {
          type: "string",
          description:
            "Optional stable part id. Omit unless updating the same generated UI.",
        },
        spec: {
          type: "object",
          description:
            "Complete upstream json-render spec: { root, elements }. children must contain element ids only; user-visible text belongs in component props such as Heading.text, Text.text, and Button.label.",
        },
        mobileFallback: {
          type: "object",
          additionalProperties: false,
          required: ["title", "summary"],
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            lines: { type: "array", items: { type: "string" } },
          },
        },
        durableActions: {
          type: "array",
          description:
            "Optional ThinkWork durable action descriptors. Required for actionable approval/review/form/result-list UI whose components reference action ids. Do not include arbitrary callbacks, URLs, tokens, raw connector payloads, scripts, imports, or route instructions.",
          items: { type: "object", additionalProperties: true },
        },
      },
    },
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const result = normalizeRuntimeThreadJsonRenderInput(params);
      if (!result.ok || !result.part) {
        return {
          content: [
            {
              type: "text",
              text:
                "Generated UI was rejected by the ThinkWork json-render validator. " +
                diagnosticSummary(result.diagnostics),
            },
          ],
          details: { ok: false, diagnostics: result.diagnostics },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Generated UI ready: ${result.part.data.mobileFallback.title}`,
          },
        ],
        details: { ok: true, thread_json_render_part: result.part },
      };
    },
  } as AgentTool<any>;
}

export function normalizeRuntimeThreadJsonRenderInput(
  candidate: unknown,
  fallbackId?: string,
): ThreadJsonRenderRuntimePartResult {
  const record = recordValue(candidate);
  const partResult = validateThreadJsonRenderPart(candidate);
  if (partResult.ok) {
    return {
      part: withHostComputedHash(partResult.part),
      ok: true,
      diagnostics: [],
    };
  }

  const dataCandidate =
    record && record.type === THREAD_JSON_RENDER_PART_TYPE
      ? record.data
      : buildDataFromToolInput(record);
  const dataResult = validateThreadJsonRenderData(dataCandidate);
  if (dataResult.ok) {
    const data = withSpecHash(dataResult.data);
    const id =
      typeof record?.id === "string" && record.id.trim()
        ? record.id.trim()
        : fallbackId || stablePartId(data);
    return {
      part: { type: THREAD_JSON_RENDER_PART_TYPE, id, data },
      ok: true,
      diagnostics: [],
    };
  }

  return {
    ok: false,
    diagnostics: [...partResult.diagnostics, ...dataResult.diagnostics],
  };
}

export function extractEmitJsonRenderToolPart(
  result: unknown,
): ThreadJsonRenderPart | null {
  const resultRecord = recordValue(result);
  const details = recordValue(resultRecord?.details);
  const candidate =
    details?.thread_json_render_part ?? resultRecord?.thread_json_render_part;
  if (!candidate) return null;
  const normalized = normalizeRuntimeThreadJsonRenderInput(candidate);
  return normalized.ok && normalized.part ? normalized.part : null;
}

export function threadJsonRenderActivityEvent(
  part: ThreadJsonRenderPart,
): ActivityEmitEvent {
  return {
    eventType: THREAD_JSON_RENDER_ACTIVITY_EVENT_TYPE,
    message: part.data.mobileFallback.title,
    stream: THREAD_JSON_RENDER_ACTIVITY_STREAM,
    payload: {
      kind: THREAD_JSON_RENDER_ACTIVITY_PAYLOAD_KIND,
      chunk: part,
    } satisfies ThreadJsonRenderActivityPayload,
  };
}

export function mergeFinalThreadJsonRenderParts(
  existing: readonly ThreadJsonRenderPart[] | undefined,
  incoming: readonly ThreadJsonRenderPart[],
): ThreadJsonRenderPart[] {
  const byId = new Map<string, ThreadJsonRenderPart>();
  for (const part of existing ?? []) byId.set(part.id, part);
  for (const part of incoming) byId.set(part.id, part);
  return [...byId.values()];
}

function buildDataFromToolInput(
  input: Record<string, unknown> | null,
): ThreadJsonRenderData {
  const spec = canonicalizeGeneratedSpec(input?.spec);
  return {
    schemaVersion: THREAD_JSON_RENDER_SCHEMA_VERSION,
    catalogVersion: THREAD_JSON_RENDER_CATALOG_VERSION,
    status: "ready",
    spec: spec as ThreadJsonRenderData["spec"],
    mobileFallback:
      input?.mobileFallback as ThreadJsonRenderData["mobileFallback"],
    durableActions: Array.isArray(input?.durableActions)
      ? (input.durableActions as ThreadJsonRenderData["durableActions"])
      : undefined,
    specHash: recordValue(spec)
      ? createThreadJsonRenderSpecHash(spec)
      : undefined,
  };
}

function canonicalizeGeneratedSpec(input: unknown): unknown {
  const spec = recordValue(input);
  if (!spec) return input;
  const elements = recordValue(spec.elements);
  if (!elements) return input;

  let changed = false;
  const nextElements: ThreadJsonRenderSpec["elements"] = {};
  for (const [elementId, elementValue] of Object.entries(elements)) {
    const element = recordValue(elementValue);
    if (!element || typeof element.type !== "string") {
      nextElements[elementId] =
        elementValue as ThreadJsonRenderSpec["elements"][string];
      continue;
    }

    const props = canonicalizeNullableCatalogProps(element.type, element.props);
    if (props !== element.props) changed = true;
    nextElements[elementId] = {
      ...element,
      props,
    } as ThreadJsonRenderSpec["elements"][string];
  }

  if (!changed) return input;
  return {
    ...spec,
    elements: nextElements,
  };
}

function canonicalizeNullableCatalogProps(
  componentType: string,
  propsInput: unknown,
): Record<string, unknown> {
  const definition =
    threadJsonRenderComponentDefinitions[
      componentType as keyof typeof threadJsonRenderComponentDefinitions
    ];
  const shape = recordValue(definition?.props?.def?.shape);
  const props = { ...(recordValue(propsInput) ?? {}) };
  if (!shape) return props;

  let changed = false;
  for (const [key, schema] of Object.entries(shape)) {
    if (Object.prototype.hasOwnProperty.call(props, key)) continue;
    if (isRequiredNullableZodSchema(schema)) {
      props[key] = null;
      changed = true;
    }
  }

  return changed ? props : (propsInput as Record<string, unknown>);
}

function isRequiredNullableZodSchema(schema: unknown): boolean {
  const maybeSchema = schema as {
    isNullable?: () => boolean;
    isOptional?: () => boolean;
    type?: string;
  };
  if (maybeSchema.type === "nullable") return true;
  try {
    return (
      maybeSchema.isNullable?.() === true && maybeSchema.isOptional?.() !== true
    );
  } catch {
    return false;
  }
}

function withHostComputedHash(
  part: ThreadJsonRenderPart,
): ThreadJsonRenderPart {
  return { ...part, data: withSpecHash(part.data) };
}

function withSpecHash(data: ThreadJsonRenderData): ThreadJsonRenderData {
  return { ...data, specHash: createThreadJsonRenderSpecHash(data.spec) };
}

function stablePartId(data: ThreadJsonRenderData): string {
  const hash = data.specHash ?? createThreadJsonRenderSpecHash(data.spec);
  return `json-render:${hash.replace(/^json-render-fnv1a:/, "").slice(0, 24)}`;
}

function diagnosticSummary(diagnostics: ThreadJsonRenderDiagnostic[]): string {
  if (diagnostics.length === 0) return "No diagnostics were returned.";
  return diagnostics
    .slice(0, 3)
    .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
    .join(" ");
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
