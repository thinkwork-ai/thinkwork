import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  THREAD_JSON_RENDER_CATALOG_VERSION,
  THREAD_JSON_RENDER_PART_TYPE,
  THREAD_JSON_RENDER_SCHEMA_VERSION,
  THREAD_JSON_RENDER_STATE_SNAPSHOT_PAYLOAD_KIND,
  createThreadJsonRenderSpecHash,
  resultShapeHash,
  threadJsonRenderComponentDefinitions,
  threadJsonRenderPartToStateSnapshot,
  type ThreadJsonRenderData,
  type ThreadJsonRenderDataBindingDescriptor,
  type ThreadJsonRenderDiagnostic,
  type ThreadJsonRenderPart,
  type ThreadJsonRenderSpec,
  type ThreadJsonRenderStateSnapshotPayload,
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
/** AG-UI STATE_SNAPSHOT activity event type (KTD1); distinct from the legacy
 *  `ui_message_chunk` type so both can ride the pipeline additively. */
export const THREAD_JSON_RENDER_STATE_SNAPSHOT_ACTIVITY_EVENT_TYPE =
  "state_snapshot" as const;

export interface ThreadJsonRenderRuntimePartResult {
  part?: ThreadJsonRenderPart;
  ok: boolean;
  diagnostics: ThreadJsonRenderDiagnostic[];
}

export interface ThreadJsonRenderActivityPayload {
  kind: typeof THREAD_JSON_RENDER_ACTIVITY_PAYLOAD_KIND;
  chunk: ThreadJsonRenderPart;
  /** Additive data-source binding (Living Artifacts U5, KTD4). Present only
   *  when the emit declared a valid `sourceToolCallId`. */
  binding?: ThreadJsonRenderDataBindingDescriptor;
}

/**
 * A completed, non-errored MCP tool invocation in the current turn whose result
 * carries a re-invokable server/tool identity — i.e. a call whose data an
 * emitted canvas part *could* be bound to for headless refresh.
 */
export interface McpBindingCandidate {
  id: string;
  server: string;
  tool: string;
}

/**
 * Enumerate the turn's completed MCP invocations that a canvas emit could bind
 * to (the model-actionable candidate list for the emit feedback loop, R6). An
 * invocation qualifies only when it completed without error AND its result
 * carries the MCP identity stamp (`details.mcp_server` / `details.mcp_tool_name`)
 * — the same seam {@link buildCanvasDataBinding} validates against, so a listed
 * candidate is always a legal `sourceToolCallId`. The emit tool's own running
 * record (and any non-MCP tool) is naturally excluded (no MCP stamp).
 */
export function listMcpBindingCandidates(
  toolInvocations: readonly CanvasBindingSourceInvocation[],
): McpBindingCandidate[] {
  const candidates: McpBindingCandidate[] = [];
  for (const invocation of toolInvocations) {
    if (invocation.is_error === true || invocation.status === "error") continue;
    const details = recordDetails(invocation.result);
    const server =
      typeof details?.mcp_server === "string" ? details.mcp_server : null;
    const tool =
      typeof details?.mcp_tool_name === "string" ? details.mcp_tool_name : null;
    if (!server || !tool) continue;
    candidates.push({ id: invocation.id, server, tool });
  }
  return candidates;
}

export interface EmitBindingFeedback {
  /** True when a valid, refreshable binding was recorded for this emit. */
  bound: boolean;
  /** Count of bindable MCP invocations present in the turn so far. */
  candidateCount: number;
  /** Model-facing feedback line to append to the emit result, or null when
   *  there is nothing actionable to say (unbound with no MCP candidates). */
  text: string | null;
  /** The recorded binding when bound; null otherwise. */
  binding: ThreadJsonRenderDataBindingDescriptor | null;
}

/**
 * Compute the model-facing binding feedback for one `emit_json_render_ui` call
 * (Living Artifacts U5 follow-up, THINK-145 — the model-actionable-diagnostics
 * lesson applied to the *silent* unbound path observed live).
 *
 * - Bound (valid `sourceToolCallId` → refreshable MCP source): confirm it so
 *   the model knows the widget is now refreshable.
 * - Unbound but ≥1 completed MCP invocation exists this turn: hand the model the
 *   real candidate ids and tell it to re-emit with the SAME part id plus
 *   `sourceToolCallId`. Re-emission with a stable id merges idempotently, so the
 *   correction costs a single tool call.
 * - Unbound with no MCP invocations: nothing is bindable → no nudge.
 *
 * The candidate ids are pi's actual tool-call ids (shape
 * `functions.mcp_<server>_<tool>:<n>`), which the model does not reliably recall
 * verbatim — handing them back is the robust fix, not prompt wording alone.
 */
export function buildEmitBindingFeedback(input: {
  partId: string;
  sourceToolCallId: unknown;
  toolInvocations: readonly CanvasBindingSourceInvocation[];
}): EmitBindingFeedback {
  const { partId, sourceToolCallId, toolInvocations } = input;
  const binding = buildCanvasDataBinding({
    partId,
    sourceToolCallId,
    toolInvocations,
  });
  if (binding) {
    return {
      bound: true,
      candidateCount: 0,
      binding,
      text: `Data-source binding recorded: ${binding.serverName}/${binding.toolName}.`,
    };
  }

  const candidates = listMcpBindingCandidates(toolInvocations);
  if (candidates.length === 0) {
    return { bound: false, candidateCount: 0, binding: null, text: null };
  }

  const candidateLines = candidates
    .map(
      (candidate) => `${candidate.id} — ${candidate.server}/${candidate.tool}`,
    )
    .join("\n");
  return {
    bound: false,
    candidateCount: candidates.length,
    binding: null,
    text:
      "No data-source binding was recorded. If this UI presents data returned " +
      "by one of these tool calls, immediately re-emit with the SAME id plus " +
      `sourceToolCallId:\n${candidateLines}`,
  };
}

/**
 * Wire an already-built `emit_json_render_ui` tool with a live view of the
 * turn's recorded tool invocations so its *result content* carries the binding
 * feedback loop (see {@link buildEmitBindingFeedback}). This is the chosen
 * injection seam: the tool is constructed context-free (in the Pi server), and
 * the agent loop — the only holder of the live `toolInvocations` registry —
 * wraps it at wiring time, passing a getter. The wrapper only augments a
 * successful emit's content; rejected emits pass through untouched so the strict
 * validator's repair loop is not polluted.
 */
export function wrapEmitToolWithBindingFeedback(
  tool: AgentTool<any>,
  getTurnInvocations: () => readonly CanvasBindingSourceInvocation[],
): AgentTool<any> {
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const result = await tool.execute(toolCallId, params, signal, onUpdate);
      const part = extractEmitJsonRenderToolPart(result);
      // Only a successful emit produces a part; a rejected emit returns its
      // validator diagnostics untouched.
      if (!part) return result;
      const feedback = buildEmitBindingFeedback({
        partId: part.id,
        sourceToolCallId: recordValue(params)?.sourceToolCallId,
        toolInvocations: getTurnInvocations(),
      });
      if (!feedback.text) return result;
      const resultRecord = recordValue(result) ?? {};
      const existingContent = Array.isArray(resultRecord.content)
        ? resultRecord.content
        : [];
      return {
        ...resultRecord,
        content: [...existingContent, { type: "text", text: feedback.text }],
      } as Awaited<ReturnType<AgentTool<any>["execute"]>>;
    },
  } as AgentTool<any>;
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
      'use params target "work_item_status", workItemId, and statusCategory or statusId. ' +
      "When this UI charts or tabulates the data returned by an earlier tool call " +
      "in THIS turn, pass that call's id as sourceToolCallId so the canvas can be " +
      "refreshed later without re-running the whole turn.",
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
        sourceToolCallId: {
          type: "string",
          description:
            "Optional. The id of the tool call in this turn whose result this UI " +
            "presents (e.g. the MCP tool that returned the rows/metrics being " +
            "charted). Use the tool call's real id, shaped like " +
            "`functions.mcp_<server>_<tool>:<n>`. Pass it so the widget records a " +
            "refreshable data-source binding. If you omit it while such a tool " +
            "call exists this turn, the emit result lists the candidate ids so " +
            "you can re-emit with the SAME part id plus sourceToolCallId. Omit " +
            "when the UI is not derived from a single tool result.",
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
        // Observability (R6): a model-authored emit was rejected by the strict
        // validator. Emit a structured line (Pi container logs ->
        // /thinkwork/<stage>/agentcore-pi) carrying diagnostic CODES only, so
        // rejection rates are countable. The diagnostics are also returned to
        // the model below, which drives the in-turn repair loop.
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "json_render_emit_rejected",
            // Codes + PATHS only (never values) — code-only proved
            // undiagnosable live; the path pinpoints the offending prop.
            diagnostics: (result.diagnostics ?? []).map(
              (d) => `${d.code}@${d.path ?? ""}`,
            ),
          }),
        );
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

  // Tool-shaped input ({spec, mobileFallback, ...}) always fails the
  // part-shape validation above with artifact diagnostics ("unknown key:
  // spec", "part type invalid", ...). Surfacing those FIRST poisoned the
  // model's repair loop — diagnosticSummary showed the artifacts and the
  // real zod spec errors never reached the model (observed live,
  // THINK-116). Only include part-shape diagnostics when the input
  // actually claimed to be a part.
  const lookedLikePart =
    record?.type === THREAD_JSON_RENDER_PART_TYPE || record?.data !== undefined;
  return {
    ok: false,
    diagnostics: lookedLikePart
      ? [...partResult.diagnostics, ...dataResult.diagnostics]
      : dataResult.diagnostics,
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
  binding?: ThreadJsonRenderDataBindingDescriptor,
): ActivityEmitEvent {
  return {
    eventType: THREAD_JSON_RENDER_ACTIVITY_EVENT_TYPE,
    message: part.data.mobileFallback.title,
    stream: THREAD_JSON_RENDER_ACTIVITY_STREAM,
    payload: {
      kind: THREAD_JSON_RENDER_ACTIVITY_PAYLOAD_KIND,
      chunk: part,
      ...(binding ? { binding } : {}),
    } satisfies ThreadJsonRenderActivityPayload,
  };
}

/**
 * Minimal read-shape of a recorded tool invocation the binding join needs. A
 * structural subset of pi-runtime-core's `ToolInvocationRecord`, declared here
 * so {@link buildCanvasDataBinding} stays a pure, independently-testable
 * function with no dependency on the loop's live state.
 */
export interface CanvasBindingSourceInvocation {
  id: string;
  args?: unknown;
  result?: unknown;
  is_error?: boolean;
  status?: string;
}

function recordDetails(result: unknown): Record<string, unknown> | null {
  const record = recordValue(result);
  return recordValue(record?.details);
}

/**
 * Build a data-source binding descriptor for an emitted canvas part (KTD4/R4).
 *
 * The model declares which tool call produced the part's data via the
 * `emit_json_render_ui` `sourceToolCallId` param; this validates that reference
 * against the turn's recorded invocations and derives the refresh identity from
 * the invocation's own result metadata (MCP tool wrappers stamp
 * `details.mcp_server` / `details.mcp_tool_name` — a reliable seam, unlike
 * parsing the sanitized `mcp_<server>_<tool>` exposed name).
 *
 * Returns null (widget stays UNBOUND — legal, not an error) when:
 *  - no/blank `sourceToolCallId`,
 *  - the id matches no recorded invocation,
 *  - the referenced call errored or never completed,
 *  - the source is not an MCP tool (no `mcp_server` / `mcp_tool_name`), so it
 *    has no headless-refreshable server.
 *
 * Auth-context classification (tenant vs per-user OAuth) is intentionally NOT
 * done here — the runtime knows the server NAME but not its auth model; the
 * persistence side classifies against `tenant_mcp_servers`.
 *
 * v1 binds the whole part to one primary source, so `elementId` is always "".
 */
export function buildCanvasDataBinding(input: {
  partId: string;
  sourceToolCallId: unknown;
  toolInvocations: readonly CanvasBindingSourceInvocation[];
}): ThreadJsonRenderDataBindingDescriptor | null {
  const { partId, sourceToolCallId, toolInvocations } = input;
  if (typeof sourceToolCallId !== "string" || !sourceToolCallId.trim()) {
    return null;
  }
  const id = sourceToolCallId.trim();
  const source = toolInvocations.find((invocation) => invocation.id === id);
  if (!source) return null;
  if (source.is_error === true || source.status === "error") return null;

  const details = recordDetails(source.result);
  const serverName =
    typeof details?.mcp_server === "string" ? details.mcp_server : null;
  const toolName =
    typeof details?.mcp_tool_name === "string" ? details.mcp_tool_name : null;
  // Non-MCP tool results have no re-invokable server → cannot be bound for
  // headless refresh. Leave the widget unbound.
  if (!serverName || !toolName) return null;

  const frozenArgs = recordValue(source.args) ?? {};
  // Hash the raw MCP response shape when present (what U6's re-invoke returns),
  // else the recorded result — either way the sorted KEY STRUCTURE, not values.
  const shapeSource = details && "raw" in details ? details.raw : source.result;

  return {
    partId,
    elementId: "",
    serverRef: serverName,
    serverName,
    toolName,
    frozenArgs,
    resultShapeHash: resultShapeHash(shapeSource),
  };
}

/**
 * AG-UI STATE_SNAPSHOT activity event for a single json-render part (KTD1, R1).
 *
 * Emitted ADDITIVELY alongside {@link threadJsonRenderActivityEvent}: the
 * legacy `ui_message_chunk` kind keeps flowing untouched, and this carries the
 * same part under the AG-UI `state_snapshot` payload kind. The web fold merges
 * both by part id, so a part that round-trips through the snapshot renders
 * identically to the legacy chunk. Always ONE part per event — never a
 * multi-part canvas — so `assertThreadTurnEventPayloadSize` (64KB) holds by
 * construction.
 */
export function threadJsonRenderStateSnapshotActivityEvent(
  part: ThreadJsonRenderPart,
  binding?: ThreadJsonRenderDataBindingDescriptor,
): ActivityEmitEvent {
  return {
    eventType: THREAD_JSON_RENDER_STATE_SNAPSHOT_ACTIVITY_EVENT_TYPE,
    message: part.data.mobileFallback.title,
    stream: THREAD_JSON_RENDER_ACTIVITY_STREAM,
    payload: {
      kind: THREAD_JSON_RENDER_STATE_SNAPSHOT_PAYLOAD_KIND,
      event: threadJsonRenderPartToStateSnapshot(part),
      ...(binding ? { binding } : {}),
    } satisfies ThreadJsonRenderStateSnapshotPayload,
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
