export const THREAD_GENUI_PART_TYPE = "data-genui" as const;
export const THREAD_GENUI_SCHEMA_VERSION = "thread-genui/v1" as const;
export const THREAD_GENUI_CATALOG_VERSION = "thread-genui-catalog/v1" as const;

export const THREAD_GENUI_NATIVE_COMPONENTS = [
  "task.review",
  "workflow.status",
  "keyValue.list",
  "form.action",
] as const;

export const THREAD_GENUI_RESERVED_ADAPTER_COMPONENTS = [
  "analytics.display",
] as const;

export const THREAD_GENUI_STATUS_VALUES = [
  "ready",
  "streaming",
  "invalid",
  "stale",
] as const;

export const THREAD_GENUI_ACTION_KINDS = [
  "approve",
  "reject",
  "submit",
  "open",
] as const;

export type ThreadGenUIPartType = typeof THREAD_GENUI_PART_TYPE;
export type ThreadGenUISchemaVersion = typeof THREAD_GENUI_SCHEMA_VERSION;
export type ThreadGenUICatalogVersion = typeof THREAD_GENUI_CATALOG_VERSION;
export type ThreadGenUINativeComponent =
  (typeof THREAD_GENUI_NATIVE_COMPONENTS)[number];
export type ThreadGenUIReservedAdapterComponent =
  (typeof THREAD_GENUI_RESERVED_ADAPTER_COMPONENTS)[number];
export type ThreadGenUIComponent =
  | ThreadGenUINativeComponent
  | ThreadGenUIReservedAdapterComponent
  | string;
export type ThreadGenUIStatus = (typeof THREAD_GENUI_STATUS_VALUES)[number];
export type ThreadGenUIActionKind = (typeof THREAD_GENUI_ACTION_KINDS)[number];

export type ThreadGenUIPrimitive = string | number | boolean | null;

export interface ThreadGenUIDiagnostic {
  code: string;
  message: string;
  path?: string;
  severity: "error" | "warning";
}

export interface ThreadGenUIMobileFallback {
  title: string;
  summary: string;
  lines?: string[];
}

export interface ThreadGenUIActionDescriptor {
  id: string;
  label: string;
  kind: ThreadGenUIActionKind;
  params?: Record<string, ThreadGenUIPrimitive>;
  disabled?: boolean;
  destructive?: boolean;
}

export interface ThreadGenUIElement {
  component: ThreadGenUIComponent;
  props: Record<string, unknown>;
  children?: string[];
}

export interface ThreadGenUISpec {
  root: string;
  elements: Record<string, ThreadGenUIElement>;
}

export interface ThreadGenUIPromotionMetadata {
  artifactTitle?: string;
  artifactSummary?: string;
  sourceMessageId?: string;
}

export interface ThreadGenUIData {
  schemaVersion: ThreadGenUISchemaVersion;
  catalogVersion: ThreadGenUICatalogVersion;
  spec: ThreadGenUISpec;
  status: ThreadGenUIStatus;
  mobileFallback: ThreadGenUIMobileFallback;
  diagnostic?: ThreadGenUIDiagnostic;
  diagnostics?: ThreadGenUIDiagnostic[];
  actions?: ThreadGenUIActionDescriptor[];
  promotion?: ThreadGenUIPromotionMetadata;
  specHash?: string;
}

export interface ThreadGenUIPart {
  type: ThreadGenUIPartType;
  id: string;
  data: ThreadGenUIData;
}

export interface ThreadGenUIValidationContext {
  allowAdapterComponents?: Set<string> | string[];
  validateAdapterElement?: (
    component: string,
    element: ThreadGenUIElement,
    path: string,
  ) => ThreadGenUIDiagnostic[];
}

export type ThreadGenUIValidationResult =
  | { ok: true; part: ThreadGenUIPart }
  | { ok: false; diagnostics: ThreadGenUIDiagnostic[] };

export type ThreadGenUIDataValidationResult =
  | { ok: true; data: ThreadGenUIData }
  | { ok: false; diagnostics: ThreadGenUIDiagnostic[] };

export type ThreadGenUIInput = unknown;
