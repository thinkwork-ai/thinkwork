import {
  threadJsonRenderCatalog,
  threadJsonRenderComponentDefinitions,
  threadJsonRenderComponentNames,
} from "./catalog"

export const THREAD_JSON_RENDER_PART_TYPE = "data-json-render" as const
export const THREAD_JSON_RENDER_SCHEMA_VERSION =
  "thread-json-render/v1" as const
export const THREAD_JSON_RENDER_CATALOG_VERSION =
  "thread-json-render-catalog/v1" as const

export interface ThreadJsonRenderElement {
  type: string
  props: Record<string, unknown>
  children: string[]
}

export interface ThreadJsonRenderSpec {
  root: string
  elements: Record<string, ThreadJsonRenderElement>
}

export interface ThreadJsonRenderMobileFallback {
  title: string
  summary: string
  lines?: string[]
}

export interface ThreadJsonRenderDurableActionDescriptor {
  id: string
  label: string
  kind: "approve" | "reject" | "submit" | "open"
  params?: Record<string, string | number | boolean | null>
  disabled?: boolean
  destructive?: boolean
}

export interface ThreadJsonRenderData {
  schemaVersion: typeof THREAD_JSON_RENDER_SCHEMA_VERSION
  catalogVersion: typeof THREAD_JSON_RENDER_CATALOG_VERSION
  spec: ThreadJsonRenderSpec
  status: "ready" | "streaming" | "invalid" | "stale"
  mobileFallback: ThreadJsonRenderMobileFallback
  durableActions?: ThreadJsonRenderDurableActionDescriptor[]
  specHash?: string
}

export interface ThreadJsonRenderPart {
  type: typeof THREAD_JSON_RENDER_PART_TYPE
  id: string
  data: ThreadJsonRenderData
}

export interface ThreadJsonRenderDiagnostic {
  code: string
  message: string
  path?: string
  severity: "error" | "warning"
}

export type ThreadJsonRenderValidationResult =
  | { ok: true; data: ThreadJsonRenderData }
  | { ok: false; diagnostics: ThreadJsonRenderDiagnostic[] }

const statusValues = new Set(["ready", "streaming", "invalid", "stale"])
const durableActionKinds = new Set(["approve", "reject", "submit", "open"])

export function validateThreadJsonRenderSpec(
  spec: unknown,
): ThreadJsonRenderValidationResult {
  const data = {
    schemaVersion: THREAD_JSON_RENDER_SCHEMA_VERSION,
    catalogVersion: THREAD_JSON_RENDER_CATALOG_VERSION,
    status: "ready",
    spec,
    mobileFallback: { title: "Generated UI", summary: "Generated UI" },
  }

  return validateThreadJsonRenderData(data)
}

export function validateThreadJsonRenderData(
  input: unknown,
): ThreadJsonRenderValidationResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      diagnostics: [
        error("JSON_RENDER_DATA_NOT_OBJECT", "Data must be an object.", "$"),
      ],
    }
  }

  const diagnostics: ThreadJsonRenderDiagnostic[] = []
  if (input.schemaVersion !== THREAD_JSON_RENDER_SCHEMA_VERSION) {
    diagnostics.push(
      error(
        "JSON_RENDER_SCHEMA_VERSION_UNSUPPORTED",
        `Expected ${THREAD_JSON_RENDER_SCHEMA_VERSION}.`,
        "$.schemaVersion",
      ),
    )
  }
  if (input.catalogVersion !== THREAD_JSON_RENDER_CATALOG_VERSION) {
    diagnostics.push(
      error(
        "JSON_RENDER_CATALOG_VERSION_UNSUPPORTED",
        `Expected ${THREAD_JSON_RENDER_CATALOG_VERSION}.`,
        "$.catalogVersion",
      ),
    )
  }
  if (!statusValues.has(String(input.status))) {
    diagnostics.push(
      error("JSON_RENDER_STATUS_INVALID", "Unsupported status.", "$.status"),
    )
  }
  validateFallback(input.mobileFallback, diagnostics)
  validateDurableActions(input.durableActions, diagnostics)

  const catalogValidation = threadJsonRenderCatalog.validate(input.spec)
  if (!catalogValidation.success || !catalogValidation.data) {
    diagnostics.push(
      error(
        "JSON_RENDER_SPEC_INVALID",
        String(catalogValidation.error),
        "$.spec",
      ),
    )
  } else {
    validateSpecGraph(catalogValidation.data, diagnostics)
    validateComponentProps(catalogValidation.data, diagnostics)
  }

  if (
    typeof input.specHash === "string" &&
    isRecord(input.spec) &&
    input.specHash !== createThreadJsonRenderSpecHash(input.spec)
  ) {
    diagnostics.push(
      error(
        "JSON_RENDER_SPEC_HASH_MISMATCH",
        "specHash does not match the canonical spec.",
        "$.specHash",
      ),
    )
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { ok: false, diagnostics }
  }

  return { ok: true, data: input as unknown as ThreadJsonRenderData }
}

export function validateThreadJsonRenderPart(
  input: unknown,
):
  | { ok: true; part: ThreadJsonRenderPart }
  | { ok: false; diagnostics: ThreadJsonRenderDiagnostic[] } {
  if (!isRecord(input)) {
    return {
      ok: false,
      diagnostics: [
        error("JSON_RENDER_PART_NOT_OBJECT", "Part must be an object.", "$"),
      ],
    }
  }

  const diagnostics: ThreadJsonRenderDiagnostic[] = []
  if (input.type !== THREAD_JSON_RENDER_PART_TYPE) {
    diagnostics.push(
      error(
        "JSON_RENDER_PART_TYPE_INVALID",
        "Part type must be data-json-render.",
        "$.type",
      ),
    )
  }
  if (typeof input.id !== "string" || input.id.length === 0) {
    diagnostics.push(
      error("JSON_RENDER_PART_ID_REQUIRED", "Part id is required.", "$.id"),
    )
  }

  const dataResult = validateThreadJsonRenderData(input.data)
  if (!dataResult.ok) diagnostics.push(...dataResult.diagnostics)
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { ok: false, diagnostics }
  }

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

export function createThreadJsonRenderSpecHash(spec: unknown): string {
  const serialized = stableStringify(spec)
  let hash = 0x811c9dc5

  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return `json-render-fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`
}

function validateSpecGraph(
  spec: ThreadJsonRenderSpec,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  if (!(spec.root in spec.elements)) {
    diagnostics.push(
      error(
        "JSON_RENDER_SPEC_ROOT_MISSING",
        "spec.root must reference an element id.",
        "$.spec.root",
      ),
    )
  }

  const reachable = new Set<string>()
  const visit = (id: string, stack: string[]) => {
    if (stack.includes(id)) {
      diagnostics.push(
        error(
          "JSON_RENDER_CHILD_CYCLE",
          "Spec children cannot contain cycles.",
          `$.spec.elements.${id}.children`,
        ),
      )
      return
    }
    if (reachable.has(id)) return
    reachable.add(id)
    const element = spec.elements[id]
    for (const child of element?.children ?? []) {
      if (!(child in spec.elements)) {
        diagnostics.push(
          error(
            "JSON_RENDER_CHILD_MISSING",
            `Child ${child} must reference an element id.`,
            `$.spec.elements.${id}.children`,
          ),
        )
      } else {
        visit(child, [...stack, id])
      }
    }
  }
  visit(spec.root, [])
}

function validateComponentProps(
  spec: ThreadJsonRenderSpec,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  for (const [elementId, element] of Object.entries(spec.elements)) {
    if (!threadJsonRenderComponentNames.includes(element.type)) {
      diagnostics.push(
        error(
          "JSON_RENDER_COMPONENT_UNSUPPORTED",
          `Unsupported component ${element.type}.`,
          `$.spec.elements.${elementId}.type`,
        ),
      )
      continue
    }
    const definition =
      threadJsonRenderComponentDefinitions[
        element.type as keyof typeof threadJsonRenderComponentDefinitions
      ]
    const propsValidation = definition?.props.safeParse(element.props)
    if (!propsValidation?.success) {
      diagnostics.push(
        error(
          "JSON_RENDER_PROPS_INVALID",
          String(propsValidation?.error ?? "Invalid component props."),
          `$.spec.elements.${elementId}.props`,
        ),
      )
    }
    if ("className" in element.props && element.props.className) {
      diagnostics.push(
        error(
          "JSON_RENDER_FORBIDDEN_CLASSNAME",
          "className must be null or omitted in Thread json-render specs.",
          `$.spec.elements.${elementId}.props.className`,
        ),
      )
    }
  }
}

function validateFallback(
  input: unknown,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  if (!isRecord(input)) {
    diagnostics.push(
      error(
        "JSON_RENDER_FALLBACK_REQUIRED",
        "mobileFallback is required.",
        "$.mobileFallback",
      ),
    )
    return
  }
  if (typeof input.title !== "string" || input.title.length === 0) {
    diagnostics.push(
      error(
        "JSON_RENDER_FALLBACK_TITLE_REQUIRED",
        "mobileFallback.title is required.",
        "$.mobileFallback.title",
      ),
    )
  }
  if (typeof input.summary !== "string" || input.summary.length === 0) {
    diagnostics.push(
      error(
        "JSON_RENDER_FALLBACK_SUMMARY_REQUIRED",
        "mobileFallback.summary is required.",
        "$.mobileFallback.summary",
      ),
    )
  }
}

function validateDurableActions(
  input: unknown,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  if (input == null) return
  if (!Array.isArray(input)) {
    diagnostics.push(
      error(
        "JSON_RENDER_DURABLE_ACTIONS_INVALID",
        "durableActions must be an array.",
        "$.durableActions",
      ),
    )
    return
  }
  input.forEach((action, index) => {
    const path = `$.durableActions[${index}]`
    if (!isRecord(action)) {
      diagnostics.push(
        error(
          "JSON_RENDER_DURABLE_ACTION_INVALID",
          "durable action must be an object.",
          path,
        ),
      )
      return
    }
    if (typeof action.id !== "string" || action.id.length === 0) {
      diagnostics.push(
        error(
          "JSON_RENDER_ACTION_ID_REQUIRED",
          "id is required.",
          `${path}.id`,
        ),
      )
    }
    if (typeof action.label !== "string" || action.label.length === 0) {
      diagnostics.push(
        error(
          "JSON_RENDER_ACTION_LABEL_REQUIRED",
          "label is required.",
          `${path}.label`,
        ),
      )
    }
    if (!durableActionKinds.has(String(action.kind))) {
      diagnostics.push(
        error(
          "JSON_RENDER_ACTION_KIND_INVALID",
          "durable action kind is unsupported.",
          `${path}.kind`,
        ),
      )
    }
  })
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(",")}}`
}

function error(
  code: string,
  message: string,
  path: string,
): ThreadJsonRenderDiagnostic {
  return { code, message, path, severity: "error" }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
