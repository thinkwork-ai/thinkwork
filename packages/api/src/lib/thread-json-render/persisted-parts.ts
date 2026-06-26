export const THREAD_JSON_RENDER_PART_TYPE = "data-json-render";
export const THREAD_JSON_RENDER_SCHEMA_VERSION = "thread-json-render/v1";
export const THREAD_JSON_RENDER_CATALOG_VERSION =
  "thread-json-render-catalog/v1";

export type ThreadJsonRenderPrimitive = string | number | boolean | null;

export interface ThreadJsonRenderDurableActionDescriptor {
  id: string;
  label: string;
  kind: "approve" | "reject" | "submit" | "open";
  params?: Record<string, ThreadJsonRenderPrimitive>;
  disabled?: boolean;
  destructive?: boolean;
}

export interface ThreadJsonRenderPart {
  type: typeof THREAD_JSON_RENDER_PART_TYPE;
  id: string;
  data: {
    schemaVersion: typeof THREAD_JSON_RENDER_SCHEMA_VERSION;
    catalogVersion: typeof THREAD_JSON_RENDER_CATALOG_VERSION;
    status: "ready" | "streaming" | "invalid" | "stale";
    spec: unknown;
    mobileFallback: {
      title: string;
      summary: string;
      lines?: string[];
    };
    durableActions?: ThreadJsonRenderDurableActionDescriptor[];
    specHash?: string;
  };
}

const statusValues = new Set(["ready", "streaming", "invalid", "stale"]);
const durableActionKinds = new Set(["approve", "reject", "submit", "open"]);

export function validateThreadJsonRenderPersistedPart(
  input: unknown,
):
  | { ok: true; part: ThreadJsonRenderPart }
  | { ok: false; diagnostics: string[] } {
  const diagnostics: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, diagnostics: ["Part must be an object."] };
  }
  if (input.type !== THREAD_JSON_RENDER_PART_TYPE) {
    diagnostics.push("Part type must be data-json-render.");
  }
  if (typeof input.id !== "string" || input.id.trim().length === 0) {
    diagnostics.push("Part id is required.");
  }
  const data = input.data;
  if (!isRecord(data)) {
    diagnostics.push("Part data must be an object.");
    return { ok: false, diagnostics };
  }
  if (data.schemaVersion !== THREAD_JSON_RENDER_SCHEMA_VERSION) {
    diagnostics.push(`Expected ${THREAD_JSON_RENDER_SCHEMA_VERSION}.`);
  }
  if (data.catalogVersion !== THREAD_JSON_RENDER_CATALOG_VERSION) {
    diagnostics.push(`Expected ${THREAD_JSON_RENDER_CATALOG_VERSION}.`);
  }
  if (!statusValues.has(String(data.status))) {
    diagnostics.push("Unsupported status.");
  }
  if (!isRecord(data.spec)) {
    diagnostics.push("Spec must be an object.");
  }
  validateFallback(data.mobileFallback, diagnostics);
  validateDurableActions(data.durableActions, diagnostics);
  if (
    typeof data.specHash === "string" &&
    data.specHash !== createThreadJsonRenderSpecHash(data.spec)
  ) {
    diagnostics.push("specHash does not match the canonical spec.");
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return {
    ok: true,
    part: {
      type: THREAD_JSON_RENDER_PART_TYPE,
      id: input.id as string,
      data: data as ThreadJsonRenderPart["data"],
    },
  };
}

export function createThreadJsonRenderSpecHash(spec: unknown): string {
  const serialized = stableStringify(spec);
  let hash = 0x811c9dc5;

  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `json-render-fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(",")}}`;
}

function validateFallback(input: unknown, diagnostics: string[]) {
  if (!isRecord(input)) {
    diagnostics.push("mobileFallback is required.");
    return;
  }
  if (typeof input.title !== "string" || input.title.trim().length === 0) {
    diagnostics.push("mobileFallback.title is required.");
  }
  if (typeof input.summary !== "string" || input.summary.trim().length === 0) {
    diagnostics.push("mobileFallback.summary is required.");
  }
  if (
    input.lines != null &&
    (!Array.isArray(input.lines) ||
      input.lines.some((line) => typeof line !== "string"))
  ) {
    diagnostics.push("mobileFallback.lines must be strings.");
  }
}

function validateDurableActions(input: unknown, diagnostics: string[]) {
  if (input == null) return;
  if (!Array.isArray(input)) {
    diagnostics.push("durableActions must be an array.");
    return;
  }
  for (const action of input) {
    if (!isRecord(action)) {
      diagnostics.push("durable action must be an object.");
      continue;
    }
    if (typeof action.id !== "string" || action.id.trim().length === 0) {
      diagnostics.push("durable action id is required.");
    }
    if (typeof action.label !== "string" || action.label.trim().length === 0) {
      diagnostics.push("durable action label is required.");
    }
    if (!durableActionKinds.has(String(action.kind))) {
      diagnostics.push("durable action kind is unsupported.");
    }
    if (action.params != null && !isRecord(action.params)) {
      diagnostics.push("durable action params must be an object.");
    }
    if (isRecord(action.params)) {
      for (const param of Object.values(action.params)) {
        if (
          param !== null &&
          typeof param !== "string" &&
          typeof param !== "number" &&
          typeof param !== "boolean"
        ) {
          diagnostics.push("durable action params must be primitive.");
        }
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
