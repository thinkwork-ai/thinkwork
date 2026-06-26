import {
  threadJsonRenderCatalog,
  threadJsonRenderComponentDefinitions,
  threadJsonRenderComponentNames,
} from "./catalog.js";
import { createThreadJsonRenderSpecHash, stableStringify } from "./hash.js";
import {
  THREAD_JSON_RENDER_CATALOG_VERSION,
  THREAD_JSON_RENDER_PART_TYPE,
  THREAD_JSON_RENDER_SCHEMA_VERSION,
  type ThreadJsonRenderData,
  type ThreadJsonRenderDiagnostic,
  type ThreadJsonRenderPart,
  type ThreadJsonRenderSpec,
} from "./spec.js";

export type ThreadJsonRenderValidationResult =
  | { ok: true; data: ThreadJsonRenderData }
  | { ok: false; diagnostics: ThreadJsonRenderDiagnostic[] };

export interface ThreadJsonRenderValidationOptions {
  maxSerializedBytes?: number;
  maxElementCount?: number;
  maxDepth?: number;
  maxPropsSerializedBytes?: number;
  maxFallbackLines?: number;
  maxDiagnostics?: number;
  maxDurableActions?: number;
}

const DEFAULT_LIMITS = {
  maxSerializedBytes: 64_000,
  maxElementCount: 120,
  maxDepth: 20,
  maxPropsSerializedBytes: 8_000,
  maxFallbackLines: 12,
  maxDiagnostics: 20,
  maxDurableActions: 12,
} satisfies Required<ThreadJsonRenderValidationOptions>;

const DATA_KEYS = new Set([
  "schemaVersion",
  "catalogVersion",
  "status",
  "spec",
  "mobileFallback",
  "durableActions",
  "diagnostics",
  "specHash",
]);
const PART_KEYS = new Set(["type", "id", "data"]);
const SPEC_KEYS = new Set(["root", "elements"]);
const ELEMENT_KEYS = new Set(["type", "props", "children"]);
const FALLBACK_KEYS = new Set(["title", "summary", "lines"]);
const DIAGNOSTIC_KEYS = new Set(["code", "message", "path", "severity"]);
const ACTION_KEYS = new Set([
  "id",
  "label",
  "kind",
  "params",
  "disabled",
  "destructive",
]);
const statusValues = new Set(["ready", "streaming", "invalid", "stale"]);
const durableActionKinds = new Set(["approve", "reject", "submit", "open"]);
const diagnosticSeverityValues = new Set(["error", "warning"]);

const FORBIDDEN_NON_NULL_PROP_KEYS = new Set([
  "backgroundColor",
  "className",
  "color",
  "dangerouslySetInnerHTML",
  "fill",
  "href",
  "on",
  "script",
  "src",
  "stroke",
  "style",
  "url",
]);

const FORBIDDEN_ELEMENT_KEYS = new Set([
  "component",
  "dangerouslySetInnerHTML",
  "on",
  "script",
  "tsx",
]);

const FORBIDDEN_URL_FIELDS = new Set(["href", "src", "url"]);

export function validateThreadJsonRenderSpec(
  spec: unknown,
  options?: ThreadJsonRenderValidationOptions,
): ThreadJsonRenderValidationResult {
  const data = {
    schemaVersion: THREAD_JSON_RENDER_SCHEMA_VERSION,
    catalogVersion: THREAD_JSON_RENDER_CATALOG_VERSION,
    status: "ready",
    spec,
    mobileFallback: { title: "Generated UI", summary: "Generated UI" },
  };

  return validateThreadJsonRenderData(data, options);
}

export function validateThreadJsonRenderData(
  input: unknown,
  options?: ThreadJsonRenderValidationOptions,
): ThreadJsonRenderValidationResult {
  const limits = { ...DEFAULT_LIMITS, ...options };
  if (!isRecord(input)) {
    return {
      ok: false,
      diagnostics: [
        error("JSON_RENDER_DATA_NOT_OBJECT", "Data must be an object.", "$"),
      ],
    };
  }

  const diagnostics: ThreadJsonRenderDiagnostic[] = [];
  validateUnknownKeys(input, DATA_KEYS, "$", diagnostics);
  validateSerializedSize(input, "$", limits.maxSerializedBytes, diagnostics);

  if (input.schemaVersion !== THREAD_JSON_RENDER_SCHEMA_VERSION) {
    diagnostics.push(
      error(
        "JSON_RENDER_SCHEMA_VERSION_UNSUPPORTED",
        `Expected ${THREAD_JSON_RENDER_SCHEMA_VERSION}.`,
        "$.schemaVersion",
      ),
    );
  }
  if (input.catalogVersion !== THREAD_JSON_RENDER_CATALOG_VERSION) {
    diagnostics.push(
      error(
        "JSON_RENDER_CATALOG_VERSION_UNSUPPORTED",
        `Expected ${THREAD_JSON_RENDER_CATALOG_VERSION}.`,
        "$.catalogVersion",
      ),
    );
  }
  if (!statusValues.has(String(input.status))) {
    diagnostics.push(
      error("JSON_RENDER_STATUS_INVALID", "Unsupported status.", "$.status"),
    );
  }

  validateFallback(input.mobileFallback, limits, diagnostics);
  validateDiagnostics(input.diagnostics, limits, diagnostics);
  validateDurableActions(input.durableActions, limits, diagnostics);

  const spec = input.spec;
  if (!isRecord(spec)) {
    diagnostics.push(
      error("JSON_RENDER_SPEC_REQUIRED", "Spec must be an object.", "$.spec"),
    );
  } else {
    validateUnknownKeys(spec, SPEC_KEYS, "$.spec", diagnostics);
    validateSpecLimits(spec, limits, diagnostics);
    validateSpecSafety(spec, diagnostics);
    validateUnsupportedComponentTypes(spec, diagnostics);
    const catalogValidation = threadJsonRenderCatalog.validate(spec);
    if (!catalogValidation.success || !catalogValidation.data) {
      diagnostics.push(
        error(
          "JSON_RENDER_SPEC_INVALID",
          sanitizeDiagnosticMessage(String(catalogValidation.error)),
          "$.spec",
        ),
      );
    } else {
      validateSpecGraph(catalogValidation.data, limits, diagnostics);
      validateComponentProps(catalogValidation.data, limits, diagnostics);
    }
  }

  if (
    typeof input.specHash === "string" &&
    isRecord(spec) &&
    input.specHash !== createThreadJsonRenderSpecHash(spec)
  ) {
    diagnostics.push(
      error(
        "JSON_RENDER_SPEC_HASH_MISMATCH",
        "specHash does not match the canonical spec.",
        "$.specHash",
      ),
    );
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { ok: false, diagnostics: sanitizeDiagnostics(diagnostics, limits) };
  }

  return { ok: true, data: input as unknown as ThreadJsonRenderData };
}

export function validateThreadJsonRenderPart(
  input: unknown,
  options?: ThreadJsonRenderValidationOptions,
):
  | { ok: true; part: ThreadJsonRenderPart }
  | { ok: false; diagnostics: ThreadJsonRenderDiagnostic[] } {
  if (!isRecord(input)) {
    return {
      ok: false,
      diagnostics: [
        error("JSON_RENDER_PART_NOT_OBJECT", "Part must be an object.", "$"),
      ],
    };
  }

  const diagnostics: ThreadJsonRenderDiagnostic[] = [];
  validateUnknownKeys(input, PART_KEYS, "$", diagnostics);
  if (input.type !== THREAD_JSON_RENDER_PART_TYPE) {
    diagnostics.push(
      error(
        "JSON_RENDER_PART_TYPE_INVALID",
        "Part type must be data-json-render.",
        "$.type",
      ),
    );
  }
  if (typeof input.id !== "string" || input.id.trim().length === 0) {
    diagnostics.push(
      error("JSON_RENDER_PART_ID_REQUIRED", "Part id is required.", "$.id"),
    );
  }

  const dataResult = validateThreadJsonRenderData(input.data, options);
  if (!dataResult.ok) diagnostics.push(...dataResult.diagnostics);
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { ok: false, diagnostics: sanitizeDiagnostics(diagnostics) };
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
  };
}

export function normalizeThreadJsonRenderPart(
  input: unknown,
  options?: ThreadJsonRenderValidationOptions,
):
  | { ok: true; part: ThreadJsonRenderPart }
  | { ok: false; diagnostics: ThreadJsonRenderDiagnostic[] } {
  return validateThreadJsonRenderPart(input, options);
}

export function sanitizeDiagnostics(
  diagnostics: ThreadJsonRenderDiagnostic[],
  options?: ThreadJsonRenderValidationOptions,
): ThreadJsonRenderDiagnostic[] {
  const maxDiagnostics =
    options?.maxDiagnostics ?? DEFAULT_LIMITS.maxDiagnostics;
  return diagnostics.slice(0, maxDiagnostics).map((diagnostic) => ({
    code: diagnostic.code,
    message: sanitizeDiagnosticMessage(diagnostic.message),
    path: diagnostic.path,
    severity: diagnostic.severity,
  }));
}

export function sanitizeDiagnosticMessage(message: string): string {
  return message
    .replace(/[A-Za-z0-9_./-]+=[A-Za-z0-9_./+=:-]{12,}/g, "[redacted]")
    .replace(/(secret|token|password|api[_-]?key)[^,\n)]*/gi, "$1=[redacted]")
    .slice(0, 500);
}

function validateSpecLimits(
  spec: Record<string, unknown>,
  limits: Required<ThreadJsonRenderValidationOptions>,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  const elements = isRecord(spec.elements) ? spec.elements : {};
  const elementCount = Object.keys(elements).length;
  if (elementCount > limits.maxElementCount) {
    diagnostics.push(
      error(
        "JSON_RENDER_ELEMENT_COUNT_LIMIT",
        `Spec contains too many elements. Max ${limits.maxElementCount}.`,
        "$.spec.elements",
      ),
    );
  }
}

function validateSpecSafety(
  spec: Record<string, unknown>,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  const elements = isRecord(spec.elements) ? spec.elements : {};
  for (const [elementId, element] of Object.entries(elements)) {
    const elementPath = `$.spec.elements.${elementId}`;
    if (!isRecord(element)) continue;
    validateUnknownKeys(element, ELEMENT_KEYS, elementPath, diagnostics);
    for (const key of Object.keys(element)) {
      if (FORBIDDEN_ELEMENT_KEYS.has(key)) {
        diagnostics.push(
          error(
            "JSON_RENDER_FORBIDDEN_ELEMENT_FIELD",
            `Element field ${key} is not allowed.`,
            `${elementPath}.${key}`,
          ),
        );
      }
    }
    if (isRecord(element.props)) {
      collectForbiddenProps(element.props, `${elementPath}.props`, diagnostics);
    }
  }
}

function validateUnsupportedComponentTypes(
  spec: Record<string, unknown>,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  const elements = isRecord(spec.elements) ? spec.elements : {};
  for (const [elementId, element] of Object.entries(elements)) {
    if (!isRecord(element)) continue;
    if (
      typeof element.type === "string" &&
      !threadJsonRenderComponentNames.includes(element.type)
    ) {
      diagnostics.push(
        error(
          "JSON_RENDER_COMPONENT_UNSUPPORTED",
          `Unsupported component ${element.type}.`,
          `$.spec.elements.${elementId}.type`,
        ),
      );
    }
  }
}

function collectForbiddenProps(
  props: Record<string, unknown>,
  path: string,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  for (const [key, value] of Object.entries(props)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_NON_NULL_PROP_KEYS.has(key) && value != null) {
      diagnostics.push(
        error(
          "JSON_RENDER_FORBIDDEN_PROP",
          `Generated prop ${key} is not allowed in Thread json-render specs.`,
          childPath,
        ),
      );
    }
    if (
      FORBIDDEN_URL_FIELDS.has(key) &&
      typeof value === "string" &&
      value.trim().length > 0
    ) {
      diagnostics.push(
        error(
          "JSON_RENDER_FORBIDDEN_REMOTE_REFERENCE",
          `Generated prop ${key} cannot reference external resources.`,
          childPath,
        ),
      );
    }
    if (isRecord(value)) {
      collectForbiddenProps(value, childPath, diagnostics);
    }
  }
}

function validateSpecGraph(
  spec: ThreadJsonRenderSpec,
  limits: Required<ThreadJsonRenderValidationOptions>,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  if (!(spec.root in spec.elements)) {
    diagnostics.push(
      error(
        "JSON_RENDER_SPEC_ROOT_MISSING",
        "spec.root must reference an element id.",
        "$.spec.root",
      ),
    );
    return;
  }

  const reachable = new Set<string>();
  const visit = (id: string, stack: string[]) => {
    if (stack.length > limits.maxDepth) {
      diagnostics.push(
        error(
          "JSON_RENDER_DEPTH_LIMIT",
          `Spec exceeds max depth ${limits.maxDepth}.`,
          `$.spec.elements.${id}.children`,
        ),
      );
      return;
    }
    if (stack.includes(id)) {
      diagnostics.push(
        error(
          "JSON_RENDER_CHILD_CYCLE",
          "Spec children cannot contain cycles.",
          `$.spec.elements.${id}.children`,
        ),
      );
      return;
    }
    if (reachable.has(id)) return;
    reachable.add(id);
    const element = spec.elements[id];
    for (const child of element?.children ?? []) {
      if (!(child in spec.elements)) {
        diagnostics.push(
          error(
            "JSON_RENDER_CHILD_MISSING",
            `Child ${child} must reference an element id.`,
            `$.spec.elements.${id}.children`,
          ),
        );
      } else {
        visit(child, [...stack, id]);
      }
    }
  };
  visit(spec.root, []);
}

function validateComponentProps(
  spec: ThreadJsonRenderSpec,
  limits: Required<ThreadJsonRenderValidationOptions>,
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
      );
      continue;
    }
    validateSerializedSize(
      element.props,
      `$.spec.elements.${elementId}.props`,
      limits.maxPropsSerializedBytes,
      diagnostics,
    );
    const definition =
      threadJsonRenderComponentDefinitions[
        element.type as keyof typeof threadJsonRenderComponentDefinitions
      ];
    const propsValidation = definition?.props.safeParse(element.props);
    if (!propsValidation?.success) {
      diagnostics.push(
        error(
          "JSON_RENDER_PROPS_INVALID",
          sanitizeDiagnosticMessage(
            String(propsValidation?.error ?? "Invalid component props."),
          ),
          `$.spec.elements.${elementId}.props`,
        ),
      );
    }
  }
}

function validateFallback(
  input: unknown,
  limits: Required<ThreadJsonRenderValidationOptions>,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  if (!isRecord(input)) {
    diagnostics.push(
      error(
        "JSON_RENDER_FALLBACK_REQUIRED",
        "mobileFallback is required.",
        "$.mobileFallback",
      ),
    );
    return;
  }
  validateUnknownKeys(input, FALLBACK_KEYS, "$.mobileFallback", diagnostics);
  if (typeof input.title !== "string" || input.title.trim().length === 0) {
    diagnostics.push(
      error(
        "JSON_RENDER_FALLBACK_TITLE_REQUIRED",
        "mobileFallback.title is required.",
        "$.mobileFallback.title",
      ),
    );
  }
  if (typeof input.summary !== "string" || input.summary.trim().length === 0) {
    diagnostics.push(
      error(
        "JSON_RENDER_FALLBACK_SUMMARY_REQUIRED",
        "mobileFallback.summary is required.",
        "$.mobileFallback.summary",
      ),
    );
  }
  if (
    input.lines != null &&
    (!Array.isArray(input.lines) ||
      input.lines.some((line) => typeof line !== "string"))
  ) {
    diagnostics.push(
      error(
        "JSON_RENDER_FALLBACK_LINES_INVALID",
        "mobileFallback.lines must contain strings.",
        "$.mobileFallback.lines",
      ),
    );
  }
  if (
    Array.isArray(input.lines) &&
    input.lines.length > limits.maxFallbackLines
  ) {
    diagnostics.push(
      error(
        "JSON_RENDER_FALLBACK_LINE_LIMIT",
        `mobileFallback.lines cannot exceed ${limits.maxFallbackLines} lines.`,
        "$.mobileFallback.lines",
      ),
    );
  }
}

function validateDiagnostics(
  input: unknown,
  limits: Required<ThreadJsonRenderValidationOptions>,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  if (input == null) return;
  if (!Array.isArray(input)) {
    diagnostics.push(
      error(
        "JSON_RENDER_DIAGNOSTICS_INVALID",
        "diagnostics must be an array.",
        "$.diagnostics",
      ),
    );
    return;
  }
  if (input.length > limits.maxDiagnostics) {
    diagnostics.push(
      error(
        "JSON_RENDER_DIAGNOSTIC_LIMIT",
        `diagnostics cannot exceed ${limits.maxDiagnostics} entries.`,
        "$.diagnostics",
      ),
    );
  }
  input.forEach((diagnostic, index) => {
    const path = `$.diagnostics[${index}]`;
    if (!isRecord(diagnostic)) {
      diagnostics.push(
        error(
          "JSON_RENDER_DIAGNOSTIC_INVALID",
          "diagnostic must be an object.",
          path,
        ),
      );
      return;
    }
    validateUnknownKeys(diagnostic, DIAGNOSTIC_KEYS, path, diagnostics);
    if (typeof diagnostic.code !== "string" || diagnostic.code.length === 0) {
      diagnostics.push(
        error(
          "JSON_RENDER_DIAGNOSTIC_CODE_REQUIRED",
          "code is required.",
          `${path}.code`,
        ),
      );
    }
    if (
      typeof diagnostic.message !== "string" ||
      diagnostic.message.length === 0
    ) {
      diagnostics.push(
        error(
          "JSON_RENDER_DIAGNOSTIC_MESSAGE_REQUIRED",
          "message is required.",
          `${path}.message`,
        ),
      );
    }
    if (!diagnosticSeverityValues.has(String(diagnostic.severity))) {
      diagnostics.push(
        error(
          "JSON_RENDER_DIAGNOSTIC_SEVERITY_INVALID",
          "severity is unsupported.",
          `${path}.severity`,
        ),
      );
    }
  });
}

function validateDurableActions(
  input: unknown,
  limits: Required<ThreadJsonRenderValidationOptions>,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  if (input == null) return;
  if (!Array.isArray(input)) {
    diagnostics.push(
      error(
        "JSON_RENDER_DURABLE_ACTIONS_INVALID",
        "durableActions must be an array.",
        "$.durableActions",
      ),
    );
    return;
  }
  if (input.length > limits.maxDurableActions) {
    diagnostics.push(
      error(
        "JSON_RENDER_DURABLE_ACTION_LIMIT",
        `durableActions cannot exceed ${limits.maxDurableActions} entries.`,
        "$.durableActions",
      ),
    );
  }
  input.forEach((action, index) => {
    const path = `$.durableActions[${index}]`;
    if (!isRecord(action)) {
      diagnostics.push(
        error(
          "JSON_RENDER_DURABLE_ACTION_INVALID",
          "durable action must be an object.",
          path,
        ),
      );
      return;
    }
    validateUnknownKeys(action, ACTION_KEYS, path, diagnostics);
    if (typeof action.id !== "string" || action.id.trim().length === 0) {
      diagnostics.push(
        error(
          "JSON_RENDER_ACTION_ID_REQUIRED",
          "id is required.",
          `${path}.id`,
        ),
      );
    }
    if (typeof action.label !== "string" || action.label.trim().length === 0) {
      diagnostics.push(
        error(
          "JSON_RENDER_ACTION_LABEL_REQUIRED",
          "label is required.",
          `${path}.label`,
        ),
      );
    }
    if (!durableActionKinds.has(String(action.kind))) {
      diagnostics.push(
        error(
          "JSON_RENDER_ACTION_KIND_INVALID",
          "durable action kind is unsupported.",
          `${path}.kind`,
        ),
      );
    }
    if (action.params != null && !isRecord(action.params)) {
      diagnostics.push(
        error(
          "JSON_RENDER_ACTION_PARAMS_INVALID",
          "durable action params must be an object.",
          `${path}.params`,
        ),
      );
    }
    if (isRecord(action.params)) {
      for (const [key, param] of Object.entries(action.params)) {
        if (
          param !== null &&
          typeof param !== "string" &&
          typeof param !== "number" &&
          typeof param !== "boolean"
        ) {
          diagnostics.push(
            error(
              "JSON_RENDER_ACTION_PARAM_NON_PRIMITIVE",
              "durable action params must be primitive.",
              `${path}.params.${key}`,
            ),
          );
        }
      }
    }
  });
}

function validateUnknownKeys(
  input: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      diagnostics.push(
        error(
          "JSON_RENDER_UNKNOWN_KEY",
          `Unknown key ${key} is not allowed.`,
          `${path}.${key}`,
        ),
      );
    }
  }
}

function validateSerializedSize(
  value: unknown,
  path: string,
  maxBytes: number,
  diagnostics: ThreadJsonRenderDiagnostic[],
) {
  if (new TextEncoder().encode(stableStringify(value)).length > maxBytes) {
    diagnostics.push(
      error(
        "JSON_RENDER_SIZE_LIMIT",
        `Value exceeds max serialized size ${maxBytes} bytes.`,
        path,
      ),
    );
  }
}

function error(
  code: string,
  message: string,
  path: string,
): ThreadJsonRenderDiagnostic {
  return { code, message, path, severity: "error" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
