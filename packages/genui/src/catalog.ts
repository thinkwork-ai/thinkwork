import {
  THREAD_GENUI_CATALOG_VERSION,
  THREAD_GENUI_NATIVE_COMPONENTS,
  THREAD_GENUI_RESERVED_ADAPTER_COMPONENTS,
} from "./spec.js";

export const threadGenUICatalog = {
  version: THREAD_GENUI_CATALOG_VERSION,
  nativeComponents: THREAD_GENUI_NATIVE_COMPONENTS,
  reservedAdapterComponents: THREAD_GENUI_RESERVED_ADAPTER_COMPONENTS,
  workflow: "task-review-and-approval",
} as const;

export function isNativeGenUIComponent(component: string): boolean {
  return (THREAD_GENUI_NATIVE_COMPONENTS as readonly string[]).includes(
    component,
  );
}

export function isReservedAdapterComponent(component: string): boolean {
  return (
    THREAD_GENUI_RESERVED_ADAPTER_COMPONENTS as readonly string[]
  ).includes(component);
}

export function isAnalyticalComponentName(component: string): boolean {
  return (
    component === "analytics.display" ||
    component === "chart" ||
    component === "table" ||
    component === "metric" ||
    component.startsWith("analytics.") ||
    component.startsWith("chart.") ||
    component.startsWith("table.") ||
    component.startsWith("metric.")
  );
}
