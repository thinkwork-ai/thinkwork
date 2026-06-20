import { createAnalyticsDisplaySummary } from "../summary.js";
import type {
  AnalyticsDisplayElement,
  AnalyticsDisplayRenderPayload,
  AnalyticsDisplaySummary,
} from "../spec.js";

export type AnalyticsDisplayHost = "dashboard" | "thread";
export type AnalyticsDisplayDensity = "dashboard" | "thread";

export interface AnalyticsDisplayRenderOptions {
  host: AnalyticsDisplayHost;
  density: AnalyticsDisplayDensity;
}

export interface AnalyticsDisplayElementRenderModel {
  id: string;
  type: AnalyticsDisplayElement["type"];
  title: string;
  renderer:
    | "thinkwork.analytics.metric"
    | "thinkwork.ui.ChartContainer"
    | "thinkwork.ui.DataTable";
  density: AnalyticsDisplayDensity;
  maxHeight: number;
  rowPreviewLimit?: number;
}

export interface AnalyticsDisplayRenderModel {
  title: string;
  host: AnalyticsDisplayHost;
  density: AnalyticsDisplayDensity;
  elements: AnalyticsDisplayElementRenderModel[];
  summary: AnalyticsDisplaySummary;
}

const DENSITY_LIMITS: Record<
  AnalyticsDisplayDensity,
  { maxHeight: number; rowPreviewLimit: number }
> = {
  dashboard: { maxHeight: 520, rowPreviewLimit: 50 },
  thread: { maxHeight: 280, rowPreviewLimit: 8 },
};

export function createAnalyticsDisplayRenderModel(
  payload: AnalyticsDisplayRenderPayload,
  options: AnalyticsDisplayRenderOptions,
): AnalyticsDisplayRenderModel {
  const density = DENSITY_LIMITS[options.density];
  return {
    title: payload.spec.title,
    host: options.host,
    density: options.density,
    elements: payload.spec.elements.map((element) => ({
      id: element.id,
      type: element.type,
      title: element.title,
      renderer: rendererForElement(element),
      density: options.density,
      maxHeight: density.maxHeight,
      rowPreviewLimit:
        element.type === "table" ? density.rowPreviewLimit : undefined,
    })),
    summary: createAnalyticsDisplaySummary(payload),
  };
}

function rendererForElement(
  element: AnalyticsDisplayElement,
): AnalyticsDisplayElementRenderModel["renderer"] {
  if (element.type === "chart") return "thinkwork.ui.ChartContainer";
  if (element.type === "table") return "thinkwork.ui.DataTable";
  return "thinkwork.analytics.metric";
}
