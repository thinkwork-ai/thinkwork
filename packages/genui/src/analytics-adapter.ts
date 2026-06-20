import {
  ANALYTICS_DISPLAY_KIND,
  ANALYTICS_DISPLAY_VERSION,
  createAnalyticsDisplaySummary,
  validateAnalyticsDisplayPayload,
  type AnalyticsDisplayDiagnostic,
  type AnalyticsDisplayRenderPayload,
  type AnalyticsDisplaySummary,
} from "@thinkwork/analytics-display";

import {
  createThreadGenUIAdapterRegistry,
  type ThreadGenUIAdapter,
} from "./adapter-registry.js";
import { genUIError } from "./diagnostics.js";
import { createThreadGenUISpecHash } from "./hash.js";
import { threadGenUILimits } from "./limits.js";
import {
  THREAD_GENUI_ANALYTICS_COMPONENT,
  THREAD_GENUI_CATALOG_VERSION,
  THREAD_GENUI_PART_TYPE,
  THREAD_GENUI_SCHEMA_VERSION,
  type ThreadGenUIData,
  type ThreadGenUIDiagnostic,
  type ThreadGenUIElement,
  type ThreadGenUIMobileFallback,
  type ThreadGenUIPart,
  type ThreadGenUIPromotionMetadata,
  type ThreadGenUIValidationContext,
} from "./spec.js";
import { validateThreadGenUIData } from "./validation.js";

export interface AnalyticsDisplayGenUIPartOptions {
  id: string;
  payload: AnalyticsDisplayRenderPayload;
  status?: ThreadGenUIData["status"];
  promotion?: ThreadGenUIPromotionMetadata;
}

export type AnalyticsDisplayGenUIDataValidationResult =
  | {
      ok: true;
      data: ThreadGenUIData;
      payload: AnalyticsDisplayRenderPayload;
      summary: AnalyticsDisplaySummary;
    }
  | { ok: false; diagnostics: ThreadGenUIDiagnostic[] };

export const analyticsDisplayGenUIAdapter: ThreadGenUIAdapter = {
  component: THREAD_GENUI_ANALYTICS_COMPONENT,
  validateElement: validateAnalyticsDisplayGenUIElement,
};

export function createAnalyticsDisplayGenUIValidationContext(): ThreadGenUIValidationContext {
  return createThreadGenUIAdapterRegistry([
    analyticsDisplayGenUIAdapter,
  ]).toValidationContext();
}

export function validateAnalyticsDisplayGenUIElement(
  element: ThreadGenUIElement,
  path: string,
): ThreadGenUIDiagnostic[] {
  const result = validateAnalyticsDisplayPayload(element.props);
  if (result.ok) return [];
  return result.diagnostics.map((diagnostic) =>
    analyticsDiagnosticToGenUI(diagnostic, path),
  );
}

export function validateAnalyticsDisplayGenUIData(
  input: unknown,
): AnalyticsDisplayGenUIDataValidationResult {
  const context = createAnalyticsDisplayGenUIValidationContext();
  const genUIResult = validateThreadGenUIData(input, context);
  if (!genUIResult.ok) return genUIResult;

  const rootElement =
    genUIResult.data.spec.elements[genUIResult.data.spec.root];
  if (
    !rootElement ||
    rootElement.component !== THREAD_GENUI_ANALYTICS_COMPONENT
  ) {
    return {
      ok: false,
      diagnostics: [
        genUIError(
          "GENUI_ANALYTICS_ROOT_REQUIRED",
          "Analytical Thread GenUI data must root at analytics.display.",
          "$.data.spec.root",
        ),
      ],
    };
  }

  const analyticsResult = validateAnalyticsDisplayPayload(rootElement.props);
  if (!analyticsResult.ok) {
    return {
      ok: false,
      diagnostics: analyticsResult.diagnostics.map((diagnostic) =>
        analyticsDiagnosticToGenUI(
          diagnostic,
          `$.data.spec.elements.${genUIResult.data.spec.root}`,
        ),
      ),
    };
  }

  return {
    ok: true,
    data: genUIResult.data,
    payload: analyticsResult.payload,
    summary: createAnalyticsDisplaySummary(analyticsResult.payload),
  };
}

export function createAnalyticsDisplayMobileFallback(
  payload: AnalyticsDisplayRenderPayload,
): ThreadGenUIMobileFallback {
  const summary = createAnalyticsDisplaySummary(payload);
  const lines = [
    ...summary.lines,
    summary.provenance,
    summary.freshness,
    ...(summary.appliedFilters?.map((filter) => `Filter: ${filter}`) ?? []),
  ].slice(0, threadGenUILimits.maxFallbackLines);

  return {
    title: summary.title,
    summary: lines[0] ?? "Analytical display",
    lines,
  };
}

export function createAnalyticsDisplayGenUIPart({
  id,
  payload,
  status = "ready",
  promotion,
}: AnalyticsDisplayGenUIPartOptions): ThreadGenUIPart {
  const spec = {
    root: "analytics",
    elements: {
      analytics: {
        component: THREAD_GENUI_ANALYTICS_COMPONENT,
        props: payload as unknown as Record<string, unknown>,
      },
    },
  } satisfies ThreadGenUIData["spec"];

  return {
    type: THREAD_GENUI_PART_TYPE,
    id,
    data: {
      schemaVersion: THREAD_GENUI_SCHEMA_VERSION,
      catalogVersion: THREAD_GENUI_CATALOG_VERSION,
      spec,
      status,
      mobileFallback: createAnalyticsDisplayMobileFallback(payload),
      promotion,
      specHash: createThreadGenUISpecHash(spec),
    },
  };
}

export function isAnalyticsDisplayRenderPayload(
  value: unknown,
): value is AnalyticsDisplayRenderPayload {
  const candidate = value as Partial<AnalyticsDisplayRenderPayload>;
  return (
    candidate?.kind === ANALYTICS_DISPLAY_KIND &&
    candidate.analyticsDisplayVersion === ANALYTICS_DISPLAY_VERSION
  );
}

function analyticsDiagnosticToGenUI(
  diagnostic: AnalyticsDisplayDiagnostic,
  elementPath: string,
): ThreadGenUIDiagnostic {
  const suffix =
    diagnostic.path && diagnostic.path !== "$"
      ? `.props${diagnostic.path.slice(1)}`
      : ".props";

  return {
    code: diagnostic.code,
    message: diagnostic.message,
    path: `${elementPath}${suffix}`,
    severity: diagnostic.severity,
  };
}
