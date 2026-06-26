export const THREAD_JSON_RENDER_PART_TYPE = "data-json-render" as const;
export const THREAD_JSON_RENDER_SCHEMA_VERSION =
  "thread-json-render/v1" as const;
export const THREAD_JSON_RENDER_CATALOG_VERSION =
  "thread-json-render-catalog/v1" as const;

export type ThreadJsonRenderPrimitive = string | number | boolean | null;

export interface ThreadJsonRenderElement {
  type: string;
  props: Record<string, unknown>;
  children: string[];
}

export interface ThreadJsonRenderSpec {
  root: string;
  elements: Record<string, ThreadJsonRenderElement>;
}

export interface ThreadJsonRenderMobileFallback {
  title: string;
  summary: string;
  lines?: string[];
}

export interface ThreadJsonRenderDiagnostic {
  code: string;
  message: string;
  path?: string;
  severity: "error" | "warning";
}

export interface ThreadJsonRenderDurableActionDescriptor {
  id: string;
  label: string;
  kind: "approve" | "reject" | "submit" | "open";
  params?: Record<string, ThreadJsonRenderPrimitive>;
  disabled?: boolean;
  destructive?: boolean;
}

export interface ThreadJsonRenderData {
  schemaVersion: typeof THREAD_JSON_RENDER_SCHEMA_VERSION;
  catalogVersion: typeof THREAD_JSON_RENDER_CATALOG_VERSION;
  status: "ready" | "streaming" | "invalid" | "stale";
  spec: ThreadJsonRenderSpec;
  mobileFallback: ThreadJsonRenderMobileFallback;
  durableActions?: ThreadJsonRenderDurableActionDescriptor[];
  diagnostics?: ThreadJsonRenderDiagnostic[];
  specHash?: string;
}

export interface ThreadJsonRenderPart {
  type: typeof THREAD_JSON_RENDER_PART_TYPE;
  id: string;
  data: ThreadJsonRenderData;
}
