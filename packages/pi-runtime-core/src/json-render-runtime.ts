import { createHash } from "node:crypto"

import type { ActivityEmitEvent } from "./agent-loop.js"

export const THREAD_JSON_RENDER_PART_TYPE = "data-json-render" as const
export const THREAD_JSON_RENDER_SCHEMA_VERSION =
  "thread-json-render/v1" as const
export const THREAD_JSON_RENDER_CATALOG_VERSION =
  "thread-json-render-catalog/v1" as const
export const THREAD_JSON_RENDER_ACTIVITY_EVENT_TYPE =
  "ui_message_chunk" as const
export const THREAD_JSON_RENDER_ACTIVITY_STREAM = "ui" as const
export const THREAD_JSON_RENDER_ACTIVITY_PAYLOAD_KIND =
  "thread_json_render.ui_message_chunk" as const

export const THREAD_JSON_RENDER_STATUS_VALUES = [
  "ready",
  "streaming",
  "invalid",
  "stale",
] as const

export const THREAD_JSON_RENDER_DURABLE_ACTION_KINDS = [
  "approve",
  "reject",
  "submit",
  "open",
] as const

export type ThreadJsonRenderPartType = typeof THREAD_JSON_RENDER_PART_TYPE
export type ThreadJsonRenderStatus =
  (typeof THREAD_JSON_RENDER_STATUS_VALUES)[number]
export type ThreadJsonRenderDurableActionKind =
  (typeof THREAD_JSON_RENDER_DURABLE_ACTION_KINDS)[number]
export type ThreadJsonRenderPrimitive = string | number | boolean | null

export interface ThreadJsonRenderDiagnostic {
  code: string
  message: string
  path?: string
  severity: "error" | "warning"
}

export interface ThreadJsonRenderMobileFallback {
  title: string
  summary: string
  lines?: string[]
}

export interface ThreadJsonRenderElement {
  type: string
  props: Record<string, unknown>
  children: string[]
}

export interface ThreadJsonRenderSpec {
  root: string
  elements: Record<string, ThreadJsonRenderElement>
}

export interface ThreadJsonRenderDurableActionDescriptor {
  id: string
  label: string
  kind: ThreadJsonRenderDurableActionKind
  params?: Record<string, ThreadJsonRenderPrimitive>
  disabled?: boolean
  destructive?: boolean
}

export interface ThreadJsonRenderPromotionMetadata {
  artifactTitle?: string
  artifactSummary?: string
  sourceMessageId?: string
}

export interface ThreadJsonRenderData {
  schemaVersion: typeof THREAD_JSON_RENDER_SCHEMA_VERSION
  catalogVersion: typeof THREAD_JSON_RENDER_CATALOG_VERSION
  spec: ThreadJsonRenderSpec
  status: ThreadJsonRenderStatus
  mobileFallback: ThreadJsonRenderMobileFallback
  durableActions?: ThreadJsonRenderDurableActionDescriptor[]
  diagnostic?: ThreadJsonRenderDiagnostic
  diagnostics?: ThreadJsonRenderDiagnostic[]
  promotion?: ThreadJsonRenderPromotionMetadata
  specHash?: string
}

export interface ThreadJsonRenderPart {
  type: ThreadJsonRenderPartType
  id: string
  data: ThreadJsonRenderData
}

export interface ThreadJsonRenderValidationContext {
  allowedComponents?: Set<string> | string[]
  validateComponentProps?: (
    element: ThreadJsonRenderElement,
    path: string,
  ) => ThreadJsonRenderDiagnostic[]
}

export type ThreadJsonRenderValidationResult =
  | { ok: true; part: ThreadJsonRenderPart }
  | { ok: false; diagnostics: ThreadJsonRenderDiagnostic[] }

export type ThreadJsonRenderDataValidationResult =
  | { ok: true; data: ThreadJsonRenderData }
  | { ok: false; diagnostics: ThreadJsonRenderDiagnostic[] }

export interface ThreadJsonRenderRuntimePartResult {
  part: ThreadJsonRenderPart
  ok: boolean
  diagnostics: ThreadJsonRenderDiagnostic[]
}

export interface ThreadJsonRenderActivityPayload {
  kind: typeof THREAD_JSON_RENDER_ACTIVITY_PAYLOAD_KIND
  chunk: ThreadJsonRenderPart
}

const statusSet = new Set<string>(THREAD_JSON_RENDER_STATUS_VALUES)
const durableActionKindSet = new Set<string>(
  THREAD_JSON_RENDER_DURABLE_ACTION_KINDS,
)
const envelopeKeys = new Set([
  "schemaVersion",
  "catalogVersion",
  "spec",
  "status",
  "mobileFallback",
  "durableActions",
  "diagnostic",
  "diagnostics",
  "promotion",
  "specHash",
])
const specKeys = new Set(["root", "elements"])
const elementKeys = new Set(["type", "props", "children"])
const mobileFallbackKeys = new Set(["title", "summary", "lines"])
const durableActionKeys = new Set([
  "id",
  "label",
  "kind",
  "params",
  "disabled",
  "destructive",
])
const diagnosticKeys = new Set(["code", "message", "path", "severity"])
const promotionKeys = new Set([
  "artifactTitle",
  "artifactSummary",
  "sourceMessageId",
])
const forbiddenKeys = new Set([
  "callback",
  "dangerouslySetInnerHTML",
  "endpoint",
  "fetch",
  "html",
  "onClick",
  "renderer",
  "script",
  "src",
  "style",
  "url",
])

const limits = {
  maxSerializedBytes: 48_000,
  maxElements: 80,
  maxDepth: 12,
  maxChildren: 24,
  maxFallbackLines: 8,
  maxDiagnostics: 8,
  maxDurableActions: 12,
  maxStringLength: 4_000,
} as const

export function validateThreadJsonRenderPart(
  input: unknown,
  context: ThreadJsonRenderValidationContext = {},
): ThreadJsonRenderValidationResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          "JSON_RENDER_PART_NOT_OBJECT",
          "Thread json-render part must be an object.",
          "$",
        ),
      ],
    }
  }

  const diagnostics: ThreadJsonRenderDiagnostic[] = []
  if (input.type !== THREAD_JSON_RENDER_PART_TYPE) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_PART_TYPE_INVALID",
        "Thread json-render part type must be data-json-render.",
        "$.type",
      ),
    )
  }
  if (typeof input.id !== "string" || input.id.length === 0) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_PART_ID_REQUIRED",
        "Thread json-render part id is required.",
        "$.id",
      ),
    )
  }

  const dataResult = validateThreadJsonRenderData(input.data, context)
  if (!dataResult.ok) diagnostics.push(...dataResult.diagnostics)
  if (hasError(diagnostics)) return { ok: false, diagnostics }

  return {
    ok: true,
    part: {
      type: THREAD_JSON_RENDER_PART_TYPE,
      id: input.id as string,
      data: dataResult.ok
        ? dataResult.data
        : (input.data as ThreadJsonRenderData),
    },
  }
}

export function validateThreadJsonRenderData(
  input: unknown,
  context: ThreadJsonRenderValidationContext = {},
): ThreadJsonRenderDataValidationResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          "JSON_RENDER_DATA_NOT_OBJECT",
          "Thread json-render data must be an object.",
          "$.data",
        ),
      ],
    }
  }

  const diagnostics: ThreadJsonRenderDiagnostic[] = []
  validateSerializedSize(input, "$.data", diagnostics)
  validateUnknownKeys(input, envelopeKeys, "$.data", diagnostics)
  collectForbiddenFieldDiagnostics(input, "$.data", diagnostics)

  if (input.schemaVersion !== THREAD_JSON_RENDER_SCHEMA_VERSION) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_SCHEMA_VERSION_UNSUPPORTED",
        `Unsupported Thread json-render schemaVersion. Expected ${THREAD_JSON_RENDER_SCHEMA_VERSION}.`,
        "$.data.schemaVersion",
      ),
    )
  }
  if (input.catalogVersion !== THREAD_JSON_RENDER_CATALOG_VERSION) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_CATALOG_VERSION_UNSUPPORTED",
        `Unsupported Thread json-render catalogVersion. Expected ${THREAD_JSON_RENDER_CATALOG_VERSION}.`,
        "$.data.catalogVersion",
      ),
    )
  }
  if (!statusSet.has(String(input.status))) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_STATUS_INVALID",
        "Thread json-render status is unsupported.",
        "$.data.status",
      ),
    )
  }

  validateMobileFallback(input.mobileFallback, diagnostics)
  validateDiagnostics(input.diagnostic, "$.data.diagnostic", diagnostics)
  validateDiagnosticsArray(input.diagnostics, "$.data.diagnostics", diagnostics)
  validateDurableActions(input.durableActions, diagnostics)
  validatePromotion(input.promotion, diagnostics)

  if (isRecord(input.spec)) {
    validateSpec(input.spec, context, diagnostics)
  } else {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_SPEC_REQUIRED",
        "Thread json-render data must include spec.",
        "$.data.spec",
      ),
    )
  }

  if (
    typeof input.specHash === "string" &&
    isRecord(input.spec) &&
    input.specHash !== createThreadJsonRenderSpecHash(input.spec)
  ) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_SPEC_HASH_MISMATCH",
        "Thread json-render specHash does not match the canonical spec.",
        "$.data.specHash",
      ),
    )
  }

  if (hasError(diagnostics)) return { ok: false, diagnostics }
  return { ok: true, data: input as unknown as ThreadJsonRenderData }
}

export function createThreadJsonRenderDiagnosticData(
  inputDiagnostic: ThreadJsonRenderDiagnostic,
  fallback: ThreadJsonRenderMobileFallback = {
    title: "Generated UI unavailable",
    summary: "This generated UI cannot be displayed.",
  },
): ThreadJsonRenderData {
  const spec = {
    root: "fallbackText",
    elements: {
      fallbackText: {
        type: "Text",
        props: {
          text: fallback.summary || inputDiagnostic.message,
          variant: "body",
        },
        children: [],
      },
    },
  } satisfies ThreadJsonRenderSpec

  return {
    schemaVersion: THREAD_JSON_RENDER_SCHEMA_VERSION,
    catalogVersion: THREAD_JSON_RENDER_CATALOG_VERSION,
    spec,
    status: "invalid",
    diagnostic: inputDiagnostic,
    diagnostics: [inputDiagnostic],
    mobileFallback: fallback,
    specHash: createThreadJsonRenderSpecHash(spec),
  }
}

export function normalizeRuntimeThreadJsonRenderPart(
  candidate: unknown,
  fallbackId?: string,
  context: ThreadJsonRenderValidationContext = {},
): ThreadJsonRenderRuntimePartResult {
  const partResult = validateThreadJsonRenderPart(candidate, context)
  if (partResult.ok) return { part: partResult.part, ok: true, diagnostics: [] }

  const candidateRecord = recordValue(candidate)
  const candidateData =
    candidateRecord && candidateRecord.type === THREAD_JSON_RENDER_PART_TYPE
      ? candidateRecord.data
      : candidate
  const dataResult = validateThreadJsonRenderData(candidateData, context)
  if (dataResult.ok) {
    const id =
      typeof candidateRecord?.id === "string" && candidateRecord.id
        ? candidateRecord.id
        : fallbackId || stablePartId(dataResult.data)
    return {
      part: { type: THREAD_JSON_RENDER_PART_TYPE, id, data: dataResult.data },
      ok: true,
      diagnostics: [],
    }
  }

  const firstDiagnostic = dataResult.diagnostics[0] ??
    partResult.diagnostics[0] ?? {
      code: "JSON_RENDER_RUNTIME_INVALID",
      message: "Runtime json-render payload failed validation.",
      severity: "error" as const,
    }
  const diagnosticData = createThreadJsonRenderDiagnosticData(firstDiagnostic, {
    title: "Generated UI unavailable",
    summary: firstDiagnostic.message,
  })
  const id =
    (typeof candidateRecord?.id === "string" && candidateRecord.id) ||
    fallbackId ||
    stablePartId(diagnosticData)

  return {
    part: { type: THREAD_JSON_RENDER_PART_TYPE, id, data: diagnosticData },
    ok: false,
    diagnostics: [...partResult.diagnostics, ...dataResult.diagnostics],
  }
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
  }
}

export function mergeFinalThreadJsonRenderParts(
  existing: readonly ThreadJsonRenderPart[] | undefined,
  incoming: readonly ThreadJsonRenderPart[],
): ThreadJsonRenderPart[] {
  const byId = new Map<string, ThreadJsonRenderPart>()
  for (const part of existing ?? []) byId.set(part.id, part)
  for (const part of incoming) byId.set(part.id, part)
  return [...byId.values()]
}

export function extractRuntimeThreadJsonRenderCandidates(
  value: unknown,
): unknown[] {
  const out: unknown[] = []
  collectCandidates(value, out, 0)
  return out
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(",")}}`
}

export function createThreadJsonRenderSpecHash(spec: unknown): string {
  const serialized = stableStringify(spec)
  let hash = 0x811c9dc5

  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return `json-render-fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`
}

function validateSpec(
  spec: Record<string, unknown>,
  context: ThreadJsonRenderValidationContext,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  validateUnknownKeys(spec, specKeys, "$.data.spec", diagnostics)
  if (typeof spec.root !== "string" || spec.root.length === 0) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_SPEC_ROOT_REQUIRED",
        "Thread json-render spec.root is required.",
        "$.data.spec.root",
      ),
    )
  }
  if (!isRecord(spec.elements)) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_SPEC_ELEMENTS_REQUIRED",
        "Thread json-render spec.elements must be an object.",
        "$.data.spec.elements",
      ),
    )
    return
  }
  const entries = Object.entries(spec.elements)
  if (entries.length === 0) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_SPEC_ELEMENTS_EMPTY",
        "Thread json-render spec.elements cannot be empty.",
        "$.data.spec.elements",
      ),
    )
  }
  if (entries.length > limits.maxElements) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_TOO_MANY_ELEMENTS",
        `Thread json-render spec has more than ${limits.maxElements} elements.`,
        "$.data.spec.elements",
      ),
    )
  }
  if (typeof spec.root === "string" && !(spec.root in spec.elements)) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_SPEC_ROOT_MISSING",
        "Thread json-render spec.root must reference an element id.",
        "$.data.spec.root",
      ),
    )
  }

  const allowedComponents = context.allowedComponents
    ? new Set(context.allowedComponents)
    : null
  for (const [elementId, element] of entries) {
    validateElement(
      elementId,
      element,
      spec.elements,
      allowedComponents,
      context,
      `$.data.spec.elements.${elementId}`,
      diagnostics,
    )
  }
  if (typeof spec.root === "string") {
    validateDepth(spec.root, spec.elements, diagnostics)
    validateReachable(spec.root, spec.elements, diagnostics)
  }
}

function validateElement(
  elementId: string,
  element: unknown,
  elements: Record<string, unknown>,
  allowedComponents: Set<string> | null,
  context: ThreadJsonRenderValidationContext,
  path: string,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  if (!isRecord(element)) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_ELEMENT_INVALID",
        "Thread json-render element must be an object.",
        path,
      ),
    )
    return
  }
  validateUnknownKeys(element, elementKeys, path, diagnostics)
  if (typeof element.type !== "string" || element.type.length === 0) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_COMPONENT_REQUIRED",
        "Thread json-render element.type is required.",
        `${path}.type`,
      ),
    )
    return
  }
  if (allowedComponents && !allowedComponents.has(element.type)) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_COMPONENT_UNSUPPORTED",
        `Unsupported Thread json-render component ${element.type}.`,
        `${path}.type`,
      ),
    )
  }
  if (!isRecord(element.props)) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_PROPS_INVALID",
        "Thread json-render element.props must be an object.",
        `${path}.props`,
      ),
    )
    return
  }
  if (
    element.children != null &&
    (!Array.isArray(element.children) ||
      !element.children.every((child) => typeof child === "string"))
  ) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_CHILDREN_INVALID",
        "Thread json-render element.children must contain element ids.",
        `${path}.children`,
      ),
    )
  }
  if (Array.isArray(element.children)) {
    if (element.children.length > limits.maxChildren) {
      diagnostics.push(
        diagnostic(
          "JSON_RENDER_TOO_MANY_CHILDREN",
          `Thread json-render element ${elementId} has more than ${limits.maxChildren} children.`,
          `${path}.children`,
        ),
      )
    }
    element.children.forEach((child, index) => {
      if (!(child in elements)) {
        diagnostics.push(
          diagnostic(
            "JSON_RENDER_CHILD_MISSING",
            `Thread json-render child ${child} must reference an element id.`,
            `${path}.children[${index}]`,
          ),
        )
      }
    })
  }
  diagnostics.push(
    ...(context.validateComponentProps?.(
      element as unknown as ThreadJsonRenderElement,
      path,
    ) ?? []),
  )
}

function validateMobileFallback(
  input: unknown,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  if (!isRecord(input)) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_FALLBACK_REQUIRED",
        "Thread json-render mobileFallback is required.",
        "$.data.mobileFallback",
      ),
    )
    return
  }
  validateUnknownKeys(
    input,
    mobileFallbackKeys,
    "$.data.mobileFallback",
    diagnostics,
  )
  requireString(input, "title", "$.data.mobileFallback", diagnostics)
  requireString(input, "summary", "$.data.mobileFallback", diagnostics)
  if (input.lines != null) {
    if (!Array.isArray(input.lines)) {
      diagnostics.push(
        diagnostic(
          "JSON_RENDER_FALLBACK_LINES_INVALID",
          "Thread json-render fallback lines must be an array.",
          "$.data.mobileFallback.lines",
        ),
      )
    } else if (input.lines.length > limits.maxFallbackLines) {
      diagnostics.push(
        diagnostic(
          "JSON_RENDER_TOO_MANY_FALLBACK_LINES",
          `Thread json-render fallback lines cannot exceed ${limits.maxFallbackLines}.`,
          "$.data.mobileFallback.lines",
        ),
      )
    }
  }
}

function validateDurableActions(
  input: unknown,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  if (input == null) return
  if (!Array.isArray(input)) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_DURABLE_ACTIONS_INVALID",
        "Thread json-render durableActions must be an array.",
        "$.data.durableActions",
      ),
    )
    return
  }
  if (input.length > limits.maxDurableActions) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_TOO_MANY_DURABLE_ACTIONS",
        `Thread json-render durableActions cannot exceed ${limits.maxDurableActions}.`,
        "$.data.durableActions",
      ),
    )
  }
  input.forEach((action, index) => {
    const path = `$.data.durableActions[${index}]`
    if (!isRecord(action)) {
      diagnostics.push(
        diagnostic(
          "JSON_RENDER_DURABLE_ACTION_INVALID",
          "Thread json-render durable action must be an object.",
          path,
        ),
      )
      return
    }
    validateUnknownKeys(action, durableActionKeys, path, diagnostics)
    requireString(action, "id", path, diagnostics)
    requireString(action, "label", path, diagnostics)
    if (!durableActionKindSet.has(String(action.kind))) {
      diagnostics.push(
        diagnostic(
          "JSON_RENDER_DURABLE_ACTION_KIND_INVALID",
          "Thread json-render durable action kind is unsupported.",
          `${path}.kind`,
        ),
      )
    }
    if (action.params != null && !isPrimitiveRecord(action.params)) {
      diagnostics.push(
        diagnostic(
          "JSON_RENDER_DURABLE_ACTION_PARAMS_INVALID",
          "Thread json-render durable action params must be a bounded primitive map.",
          `${path}.params`,
        ),
      )
    }
  })
}

function validatePromotion(
  input: unknown,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  if (input == null) return
  if (!isRecord(input)) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_PROMOTION_INVALID",
        "Thread json-render promotion metadata must be an object.",
        "$.data.promotion",
      ),
    )
    return
  }
  validateUnknownKeys(input, promotionKeys, "$.data.promotion", diagnostics)
}

function validateDiagnosticsArray(
  input: unknown,
  path: string,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  if (input == null) return
  if (!Array.isArray(input)) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_DIAGNOSTICS_INVALID",
        "Thread json-render diagnostics must be an array.",
        path,
      ),
    )
    return
  }
  if (input.length > limits.maxDiagnostics) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_TOO_MANY_DIAGNOSTICS",
        `Thread json-render diagnostics cannot exceed ${limits.maxDiagnostics}.`,
        path,
      ),
    )
  }
  input.forEach((item, index) =>
    validateDiagnostics(item, `${path}[${index}]`, diagnostics),
  )
}

function validateDiagnostics(
  input: unknown,
  path: string,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  if (input == null) return
  if (!isRecord(input)) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_DIAGNOSTIC_INVALID",
        "Thread json-render diagnostic must be an object.",
        path,
      ),
    )
    return
  }
  validateUnknownKeys(input, diagnosticKeys, path, diagnostics)
  requireString(input, "code", path, diagnostics)
  requireString(input, "message", path, diagnostics)
  if (input.severity !== "error" && input.severity !== "warning") {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_DIAGNOSTIC_SEVERITY_INVALID",
        "Thread json-render diagnostic severity must be error or warning.",
        `${path}.severity`,
      ),
    )
  }
}

function validateUnknownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      diagnostics.push(
        diagnostic(
          "JSON_RENDER_UNKNOWN_KEY",
          `Unsupported Thread json-render field ${key}.`,
          `${path}.${key}`,
        ),
      )
    }
  }
}

function collectForbiddenFieldDiagnostics(
  value: unknown,
  path: string,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectForbiddenFieldDiagnostics(item, `${path}[${index}]`, diagnostics),
    )
    return
  }
  if (!isRecord(value)) return
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`
    if (
      forbiddenKeys.has(key) ||
      key.startsWith("on") ||
      typeof nested === "function"
    ) {
      diagnostics.push(
        diagnostic(
          "JSON_RENDER_FORBIDDEN_FIELD",
          `Thread json-render field ${key} is not allowed.`,
          nestedPath,
        ),
      )
    }
    if (key === "className" && nested != null && nested !== "") {
      diagnostics.push(
        diagnostic(
          "JSON_RENDER_FORBIDDEN_CLASSNAME",
          "Thread json-render className must be null or omitted.",
          nestedPath,
        ),
      )
    }
    collectForbiddenFieldDiagnostics(nested, nestedPath, diagnostics)
  }
}

function validateDepth(
  root: string,
  elements: Record<string, unknown>,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  const visiting = new Set<string>()
  const visit = (id: string, depth: number) => {
    if (depth > limits.maxDepth) {
      diagnostics.push(
        diagnostic(
          "JSON_RENDER_MAX_DEPTH_EXCEEDED",
          `Thread json-render spec cannot exceed depth ${limits.maxDepth}.`,
          `$.data.spec.elements.${id}`,
        ),
      )
      return
    }
    if (visiting.has(id)) {
      diagnostics.push(
        diagnostic(
          "JSON_RENDER_CHILD_CYCLE",
          "Thread json-render spec children cannot contain cycles.",
          `$.data.spec.elements.${id}.children`,
        ),
      )
      return
    }
    const element = recordValue(elements[id])
    if (!element || !Array.isArray(element.children)) return
    visiting.add(id)
    for (const child of element.children) {
      if (typeof child === "string") visit(child, depth + 1)
    }
    visiting.delete(id)
  }
  visit(root, 0)
}

function validateReachable(
  root: string,
  elements: Record<string, unknown>,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  const seen = new Set<string>()
  const visit = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    const element = recordValue(elements[id])
    if (!element || !Array.isArray(element.children)) return
    for (const child of element.children) {
      if (typeof child === "string") visit(child)
    }
  }
  visit(root)
  for (const id of Object.keys(elements)) {
    if (!seen.has(id)) {
      diagnostics.push(
        diagnostic(
          "JSON_RENDER_ORPHAN_ELEMENT",
          `Thread json-render element ${id} is not reachable from root.`,
          `$.data.spec.elements.${id}`,
          "warning",
        ),
      )
    }
  }
}

function validateSerializedSize(
  value: unknown,
  path: string,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  const bytes = Buffer.byteLength(JSON.stringify(value) ?? "", "utf8")
  if (bytes > limits.maxSerializedBytes) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_PAYLOAD_TOO_LARGE",
        `Thread json-render payload exceeds ${limits.maxSerializedBytes} bytes.`,
        path,
      ),
    )
  }
}

function requireString(
  input: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  if (typeof input[key] !== "string" || input[key].length === 0) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_STRING_REQUIRED",
        `Thread json-render field ${key} is required.`,
        `${path}.${key}`,
      ),
    )
  } else if (input[key].length > limits.maxStringLength) {
    diagnostics.push(
      diagnostic(
        "JSON_RENDER_STRING_TOO_LONG",
        `Thread json-render field ${key} exceeds ${limits.maxStringLength} characters.`,
        `${path}.${key}`,
      ),
    )
  }
}

function hasError(diagnostics: ThreadJsonRenderDiagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === "error")
}

function isPrimitiveRecord(
  value: unknown,
): value is Record<string, ThreadJsonRenderPrimitive> {
  if (!isRecord(value)) return false
  return Object.values(value).every(
    (nested) =>
      nested == null ||
      typeof nested === "string" ||
      typeof nested === "number" ||
      typeof nested === "boolean",
  )
}

function collectCandidates(
  value: unknown,
  out: unknown[],
  depth: number,
): void {
  if (depth > 4) return
  const record = recordValue(value)
  if (!record) return

  if (
    record.type === THREAD_JSON_RENDER_PART_TYPE ||
    isThreadJsonRenderDataLike(record)
  ) {
    out.push(record)
  }

  for (const key of [
    "threadJsonRender",
    "thread_json_render",
    "threadJsonRenderPart",
    "thread_json_render_part",
    "threadJsonRenderParts",
    "thread_json_render_parts",
    "dataJsonRender",
    "data_json_render",
  ]) {
    const nested = record[key]
    if (Array.isArray(nested)) {
      out.push(...nested)
    } else if (nested !== undefined) {
      out.push(nested)
    }
  }

  for (const key of [
    "details",
    "result",
    "toolResult",
    "rawToolResult",
    "output",
  ]) {
    collectCandidates(record[key], out, depth + 1)
  }
}

function isThreadJsonRenderDataLike(value: Record<string, unknown>): boolean {
  return (
    value.schemaVersion === THREAD_JSON_RENDER_SCHEMA_VERSION &&
    value.catalogVersion === THREAD_JSON_RENDER_CATALOG_VERSION &&
    recordValue(value.spec) !== null
  )
}

function stablePartId(data: ThreadJsonRenderData): string {
  const basis = data.spec
    ? createThreadJsonRenderSpecHash(data.spec)
    : stableHash(data)
  return `json-render:${basis.replace(/^sha256:/, "").slice(0, 24)}`
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex")
}

function diagnostic(
  code: string,
  message: string,
  path: string,
  severity: ThreadJsonRenderDiagnostic["severity"] = "error",
): ThreadJsonRenderDiagnostic {
  return { code, message, path, severity }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return recordValue(value) !== null
}
