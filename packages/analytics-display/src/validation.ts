import { errorDiagnostic } from "./diagnostics.js";
import { hasHtmlMetacharacters } from "./formatters.js";
import { analyticsDisplayLimits } from "./limits.js";
import {
  ANALYTICS_DISPLAY_KIND,
  ANALYTICS_DISPLAY_VERSION,
  CHART_KINDS,
  FILTER_OPERATORS,
  PALETTE_TOKENS,
  REDACTION_MODES,
  SENSITIVITY_LEVELS,
  VALUE_TYPES,
  type AnalyticsColumnSpec,
  type AnalyticsDisplayDiagnostic,
  type AnalyticsDisplayPayloadInput,
  type AnalyticsDisplayRenderPayload,
  type AnalyticsPrimitive,
} from "./spec.js";

export type AnalyticsDisplayValidationResult =
  | { ok: true; payload: AnalyticsDisplayRenderPayload }
  | { ok: false; diagnostics: AnalyticsDisplayDiagnostic[] };

const FORBIDDEN_REFERENCE_KEYS = new Set([
  "component",
  "dashboardId",
  "dashboard_id",
  "datasetId",
  "dataset_id",
  "href",
  "renderer",
  "route",
  "url",
]);

const FORBIDDEN_SPEC_STYLE_KEYS = new Set([
  "backgroundColor",
  "className",
  "color",
  "dangerouslySetInnerHTML",
  "fill",
  "stroke",
  "style",
]);

const chartKindSet = new Set<string>(CHART_KINDS);
const paletteTokenSet = new Set<string>(PALETTE_TOKENS);
const filterOperatorSet = new Set<string>(FILTER_OPERATORS);
const valueTypeSet = new Set<string>(VALUE_TYPES);
const sensitivitySet = new Set<string>(SENSITIVITY_LEVELS);
const redactionSet = new Set<string>(REDACTION_MODES);
const freshnessStatusSet = new Set(["fresh", "stale", "unknown"]);
const diagnosticSeveritySet = new Set(["error", "warning"]);
const sensitivityPolicySet = new Set([
  "display_limited",
  "redacted",
  "aggregate_only",
]);

export function validateAnalyticsDisplayPayload(
  input: AnalyticsDisplayPayloadInput,
): AnalyticsDisplayValidationResult {
  const diagnostics: AnalyticsDisplayDiagnostic[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      diagnostics: [
        errorDiagnostic(
          "ANALYTICS_DISPLAY_PAYLOAD_NOT_OBJECT",
          "Analytics display payload must be an object.",
        ),
      ],
    };
  }

  collectForbiddenReferenceDiagnostics(input, "$", diagnostics);
  validatePayloadSize(input, diagnostics);
  validateEnvelope(input, diagnostics);

  const spec = isRecord(input.spec) ? input.spec : undefined;
  const rows =
    isRecord(input.data) && Array.isArray(input.data.rows)
      ? input.data.rows
      : undefined;

  if (spec) {
    collectForbiddenSpecStyleDiagnostics(spec, "$.spec", diagnostics);
    validateSpec(spec, diagnostics);
  } else {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_SPEC_REQUIRED",
        "Analytics display payload must include spec.",
        "$.spec",
      ),
    );
  }

  if (rows) {
    validateRows(rows, spec, diagnostics);
  } else {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_ROWS_REQUIRED",
        "Analytics display payload must include data.rows.",
        "$.data.rows",
      ),
    );
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { ok: false, diagnostics };
  }

  return {
    ok: true,
    payload: input as unknown as AnalyticsDisplayRenderPayload,
  };
}

function validateEnvelope(
  input: Record<string, unknown>,
  diagnostics: AnalyticsDisplayDiagnostic[],
) {
  if (input.kind !== ANALYTICS_DISPLAY_KIND) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_KIND_INVALID",
        "Analytics display payload kind must be analytics.display.",
        "$.kind",
      ),
    );
  }

  if (input.analyticsDisplayVersion !== ANALYTICS_DISPLAY_VERSION) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_VERSION_UNSUPPORTED",
        `Unsupported analytics display version. Expected ${ANALYTICS_DISPLAY_VERSION}.`,
        "$.analyticsDisplayVersion",
      ),
    );
  }

  if (
    !isRecord(input.freshness) ||
    typeof input.freshness.takenAt !== "string"
  ) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_FRESHNESS_REQUIRED",
        "Analytics display payload must include freshness.takenAt.",
        "$.freshness.takenAt",
      ),
    );
  } else {
    if (
      input.freshness.oldestAt != null &&
      typeof input.freshness.oldestAt !== "string"
    ) {
      diagnostics.push(
        errorDiagnostic(
          "ANALYTICS_DISPLAY_FRESHNESS_OLDEST_AT_INVALID",
          "Analytics display freshness.oldestAt must be a string when provided.",
          "$.freshness.oldestAt",
        ),
      );
    }
    if (
      input.freshness.status != null &&
      !freshnessStatusSet.has(String(input.freshness.status))
    ) {
      diagnostics.push(
        errorDiagnostic(
          "ANALYTICS_DISPLAY_FRESHNESS_STATUS_INVALID",
          "Analytics display freshness.status uses an unsupported value.",
          "$.freshness.status",
        ),
      );
    }
  }

  if (
    !isRecord(input.provenance) ||
    !Array.isArray(input.provenance.sourceLabels) ||
    !input.provenance.sourceLabels.every((label) => typeof label === "string")
  ) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_PROVENANCE_REQUIRED",
        "Analytics display payload must include provenance.sourceLabels.",
        "$.provenance.sourceLabels",
      ),
    );
  } else if (
    input.provenance.dataSourceSlugs != null &&
    (!Array.isArray(input.provenance.dataSourceSlugs) ||
      !input.provenance.dataSourceSlugs.every(
        (slug) => typeof slug === "string",
      ))
  ) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_PROVENANCE_SLUGS_INVALID",
        "Analytics display provenance.dataSourceSlugs must contain strings when provided.",
        "$.provenance.dataSourceSlugs",
      ),
    );
  }

  validateDiagnostics(input.diagnostics, diagnostics);
  validateSensitivity(input.sensitivity, diagnostics);
}

function validateDiagnostics(
  value: unknown,
  diagnostics: AnalyticsDisplayDiagnostic[],
) {
  if (value == null) return;
  if (!Array.isArray(value)) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_DIAGNOSTICS_INVALID",
        "Analytics display diagnostics must be an array when provided.",
        "$.diagnostics",
      ),
    );
    return;
  }

  for (const [index, diagnostic] of value.entries()) {
    if (
      !isRecord(diagnostic) ||
      typeof diagnostic.code !== "string" ||
      typeof diagnostic.message !== "string" ||
      !diagnosticSeveritySet.has(String(diagnostic.severity)) ||
      (diagnostic.path != null && typeof diagnostic.path !== "string")
    ) {
      diagnostics.push(
        errorDiagnostic(
          "ANALYTICS_DISPLAY_DIAGNOSTIC_INVALID",
          "Analytics display diagnostics must include code, message, and severity.",
          `$.diagnostics[${index}]`,
        ),
      );
    }
  }
}

function validateSensitivity(
  value: unknown,
  diagnostics: AnalyticsDisplayDiagnostic[],
) {
  if (value == null) return;
  if (!isRecord(value) || typeof value.containsSensitiveFields !== "boolean") {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_SENSITIVITY_INVALID",
        "Analytics display sensitivity metadata must include containsSensitiveFields.",
        "$.sensitivity",
      ),
    );
    return;
  }

  if (
    value.sensitiveColumns != null &&
    (!Array.isArray(value.sensitiveColumns) ||
      !value.sensitiveColumns.every((column) => typeof column === "string"))
  ) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_SENSITIVITY_COLUMNS_INVALID",
        "Analytics display sensitivity.sensitiveColumns must contain strings when provided.",
        "$.sensitivity.sensitiveColumns",
      ),
    );
  }

  if (value.policy != null && !sensitivityPolicySet.has(String(value.policy))) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_SENSITIVITY_POLICY_INVALID",
        "Analytics display sensitivity.policy uses an unsupported value.",
        "$.sensitivity.policy",
      ),
    );
  }
}

function validateSpec(
  spec: Record<string, unknown>,
  diagnostics: AnalyticsDisplayDiagnostic[],
) {
  validateLabel(spec.title, "$.spec.title", diagnostics);
  validateOptionalText(spec.description, "$.spec.description", diagnostics);

  const columns = Array.isArray(spec.columns) ? spec.columns : [];
  if (!columns.length) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_COLUMNS_REQUIRED",
        "Analytics display spec must include columns.",
        "$.spec.columns",
      ),
    );
  }

  const columnKeys = new Set<string>();
  for (const [index, rawColumn] of columns.entries()) {
    if (!isRecord(rawColumn)) {
      diagnostics.push(
        errorDiagnostic(
          "ANALYTICS_DISPLAY_COLUMN_NOT_OBJECT",
          "Analytics display column specs must be objects.",
          `$.spec.columns[${index}]`,
        ),
      );
      continue;
    }
    validateColumn(rawColumn, index, diagnostics);
    if (typeof rawColumn.key === "string") columnKeys.add(rawColumn.key);
  }

  const elements = Array.isArray(spec.elements) ? spec.elements : [];
  if (!elements.length) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_ELEMENTS_REQUIRED",
        "Analytics display spec must include at least one element.",
        "$.spec.elements",
      ),
    );
  }

  if (elements.length > analyticsDisplayLimits.maxElements) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_TOO_MANY_ELEMENTS",
        `Analytics display supports at most ${analyticsDisplayLimits.maxElements} elements.`,
        "$.spec.elements",
      ),
    );
  }

  for (const [index, rawElement] of elements.entries()) {
    validateElement(rawElement, index, columnKeys, diagnostics);
  }
  validateUniqueElementIds(elements, diagnostics);

  if (Array.isArray(spec.filters)) {
    for (const [index, rawFilter] of spec.filters.entries()) {
      if (!isRecord(rawFilter)) {
        diagnostics.push(
          errorDiagnostic(
            "ANALYTICS_DISPLAY_FILTER_NOT_OBJECT",
            "Analytics display filter specs must be objects.",
            `$.spec.filters[${index}]`,
          ),
        );
        continue;
      }
      validateLabel(
        rawFilter.label,
        `$.spec.filters[${index}].label`,
        diagnostics,
      );
      if (!filterOperatorSet.has(String(rawFilter.operator))) {
        diagnostics.push(
          errorDiagnostic(
            "ANALYTICS_DISPLAY_FILTER_OPERATOR_INVALID",
            "Analytics display filter uses an unsupported operator.",
            `$.spec.filters[${index}].operator`,
          ),
        );
      }
      if (
        typeof rawFilter.columnKey === "string" &&
        !columnKeys.has(rawFilter.columnKey)
      ) {
        diagnostics.push(
          errorDiagnostic(
            "ANALYTICS_DISPLAY_FILTER_COLUMN_UNKNOWN",
            "Analytics display filter references an unknown column.",
            `$.spec.filters[${index}].columnKey`,
          ),
        );
      }
    }
  }

  if (isRecord(spec.emptyState)) {
    validateLabel(
      spec.emptyState.title,
      "$.spec.emptyState.title",
      diagnostics,
    );
    validateOptionalText(
      spec.emptyState.description,
      "$.spec.emptyState.description",
      diagnostics,
    );
  }
}

function validateColumn(
  column: Record<string, unknown>,
  index: number,
  diagnostics: AnalyticsDisplayDiagnostic[],
) {
  if (typeof column.key !== "string" || !column.key) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_COLUMN_KEY_REQUIRED",
        "Analytics display column must include a key.",
        `$.spec.columns[${index}].key`,
      ),
    );
  }
  validateLabel(column.label, `$.spec.columns[${index}].label`, diagnostics);

  if (!valueTypeSet.has(String(column.type))) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_COLUMN_TYPE_INVALID",
        "Analytics display column uses an unsupported value type.",
        `$.spec.columns[${index}].type`,
      ),
    );
  }

  if (
    column.sensitivity != null &&
    !sensitivitySet.has(String(column.sensitivity))
  ) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_COLUMN_SENSITIVITY_INVALID",
        "Analytics display column uses an unsupported sensitivity level.",
        `$.spec.columns[${index}].sensitivity`,
      ),
    );
  }

  if (column.redaction != null && !redactionSet.has(String(column.redaction))) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_COLUMN_REDACTION_INVALID",
        "Analytics display column uses an unsupported redaction mode.",
        `$.spec.columns[${index}].redaction`,
      ),
    );
  }

  if (
    (column.sensitivity === "sensitive" || column.sensitivity === "pii") &&
    column.redaction !== "redacted" &&
    column.redaction !== "aggregate"
  ) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_SENSITIVE_COLUMN_NOT_MINIMIZED",
        "Sensitive analytical columns must be redacted or aggregate-only before embedding.",
        `$.spec.columns[${index}]`,
      ),
    );
  }
}

function validateElement(
  element: unknown,
  index: number,
  columnKeys: Set<string>,
  diagnostics: AnalyticsDisplayDiagnostic[],
) {
  if (!isRecord(element)) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_ELEMENT_NOT_OBJECT",
        "Analytics display element must be an object.",
        `$.spec.elements[${index}]`,
      ),
    );
    return;
  }

  if (typeof element.id !== "string" || !element.id.trim()) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_ELEMENT_ID_REQUIRED",
        "Analytics display elements must include a stable non-empty id.",
        `$.spec.elements[${index}].id`,
      ),
    );
  }

  validateLabel(element.title, `$.spec.elements[${index}].title`, diagnostics);

  if (element.type === "metric") {
    validateColumnRef(
      element.valueKey,
      columnKeys,
      `$.spec.elements[${index}].valueKey`,
      diagnostics,
    );
    validatePalette(
      element.palette,
      `$.spec.elements[${index}].palette`,
      diagnostics,
      false,
    );
    return;
  }

  if (element.type === "chart") {
    if (!chartKindSet.has(String(element.chartKind))) {
      diagnostics.push(
        errorDiagnostic(
          "ANALYTICS_DISPLAY_CHART_KIND_INVALID",
          "Analytics display chart uses an unsupported chart kind.",
          `$.spec.elements[${index}].chartKind`,
        ),
      );
    }
    validateColumnRef(
      element.categoryKey,
      columnKeys,
      `$.spec.elements[${index}].categoryKey`,
      diagnostics,
    );
    const series = Array.isArray(element.series) ? element.series : [];
    if (!series.length || series.length > analyticsDisplayLimits.maxSeries) {
      diagnostics.push(
        errorDiagnostic(
          "ANALYTICS_DISPLAY_CHART_SERIES_INVALID",
          `Analytics display charts require 1-${analyticsDisplayLimits.maxSeries} series.`,
          `$.spec.elements[${index}].series`,
        ),
      );
    }
    for (const [seriesIndex, rawSeries] of series.entries()) {
      if (!isRecord(rawSeries)) {
        diagnostics.push(
          errorDiagnostic(
            "ANALYTICS_DISPLAY_CHART_SERIES_NOT_OBJECT",
            "Analytics display chart series specs must be objects.",
            `$.spec.elements[${index}].series[${seriesIndex}]`,
          ),
        );
        continue;
      }
      validateLabel(
        rawSeries.label,
        `$.spec.elements[${index}].series[${seriesIndex}].label`,
        diagnostics,
      );
      validateColumnRef(
        rawSeries.valueKey,
        columnKeys,
        `$.spec.elements[${index}].series[${seriesIndex}].valueKey`,
        diagnostics,
      );
      validatePalette(
        rawSeries.palette,
        `$.spec.elements[${index}].series[${seriesIndex}].palette`,
        diagnostics,
        true,
      );
    }
    return;
  }

  if (element.type === "table") {
    const columns = Array.isArray(element.columns) ? element.columns : [];
    if (
      !columns.length ||
      columns.length > analyticsDisplayLimits.maxTableColumns
    ) {
      diagnostics.push(
        errorDiagnostic(
          "ANALYTICS_DISPLAY_TABLE_COLUMNS_INVALID",
          `Analytics display tables require 1-${analyticsDisplayLimits.maxTableColumns} columns.`,
          `$.spec.elements[${index}].columns`,
        ),
      );
    }
    for (const [columnIndex, rawColumn] of columns.entries()) {
      if (!isRecord(rawColumn)) {
        diagnostics.push(
          errorDiagnostic(
            "ANALYTICS_DISPLAY_TABLE_COLUMN_NOT_OBJECT",
            "Analytics display table column specs must be objects.",
            `$.spec.elements[${index}].columns[${columnIndex}]`,
          ),
        );
        continue;
      }
      validateLabel(
        rawColumn.label,
        `$.spec.elements[${index}].columns[${columnIndex}].label`,
        diagnostics,
      );
      validateColumnRef(
        rawColumn.key,
        columnKeys,
        `$.spec.elements[${index}].columns[${columnIndex}].key`,
        diagnostics,
      );
    }
    return;
  }

  diagnostics.push(
    errorDiagnostic(
      "ANALYTICS_DISPLAY_ELEMENT_TYPE_INVALID",
      "Analytics display element type must be metric, chart, or table.",
      `$.spec.elements[${index}].type`,
    ),
  );
}

function validateRows(
  rows: unknown[],
  spec: Record<string, unknown> | undefined,
  diagnostics: AnalyticsDisplayDiagnostic[],
) {
  if (rows.length > analyticsDisplayLimits.maxRows) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_TOO_MANY_ROWS",
        `Analytics display payload supports at most ${analyticsDisplayLimits.maxRows} rows.`,
        "$.data.rows",
      ),
    );
  }

  const columns = Array.isArray(spec?.columns)
    ? spec.columns.filter(isAnalyticsColumnCandidate)
    : [];
  const columnKeys = new Set(columns.map((column) => column.key));
  for (const [rowIndex, rawRow] of rows.entries()) {
    if (!isRecord(rawRow)) {
      diagnostics.push(
        errorDiagnostic(
          "ANALYTICS_DISPLAY_ROW_NOT_OBJECT",
          "Analytics display rows must be objects.",
          `$.data.rows[${rowIndex}]`,
        ),
      );
      continue;
    }

    for (const [key, value] of Object.entries(rawRow)) {
      if (!columnKeys.has(key)) {
        diagnostics.push(
          errorDiagnostic(
            "ANALYTICS_DISPLAY_ROW_COLUMN_UNKNOWN",
            "Analytics display rows must only include declared columns.",
            `$.data.rows[${rowIndex}].${key}`,
          ),
        );
        continue;
      }
      if (!isAnalyticsPrimitive(value)) {
        diagnostics.push(
          errorDiagnostic(
            "ANALYTICS_DISPLAY_ROW_VALUE_INVALID",
            "Analytics display row values must be strings, numbers, booleans, or null.",
            `$.data.rows[${rowIndex}].${key}`,
          ),
        );
      }
      validateRowStringValue(
        value,
        `$.data.rows[${rowIndex}].${key}`,
        diagnostics,
      );
    }
  }

  const sensitiveColumns = columns.filter(
    (column) =>
      column.sensitivity === "sensitive" || column.sensitivity === "pii",
  );
  for (const column of sensitiveColumns) {
    if (column.redaction === "redacted") {
      for (const [rowIndex, row] of rows.entries()) {
        if (
          isRecord(row) &&
          row[column.key] !== null &&
          row[column.key] !== undefined &&
          row[column.key] !== "[redacted]"
        ) {
          diagnostics.push(
            errorDiagnostic(
              "ANALYTICS_DISPLAY_SENSITIVE_VALUE_EMBEDDED",
              "Sensitive analytical values must not be embedded in Thread render payloads.",
              `$.data.rows[${rowIndex}].${column.key}`,
            ),
          );
        }
      }
    }
  }

  const chartElements = Array.isArray(spec?.elements)
    ? spec.elements.filter(
        (element) => isRecord(element) && element.type === "chart",
      )
    : [];
  if (
    chartElements.length &&
    rows.length > analyticsDisplayLimits.maxChartPoints
  ) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_TOO_MANY_CHART_POINTS",
        `Analytics display charts support at most ${analyticsDisplayLimits.maxChartPoints} points.`,
        "$.data.rows",
      ),
    );
  }
}

function validateUniqueElementIds(
  elements: unknown[],
  diagnostics: AnalyticsDisplayDiagnostic[],
) {
  const seen = new Map<string, number>();
  for (const [index, element] of elements.entries()) {
    if (
      !isRecord(element) ||
      typeof element.id !== "string" ||
      !element.id.trim()
    )
      continue;

    const firstIndex = seen.get(element.id);
    if (firstIndex != null) {
      diagnostics.push(
        errorDiagnostic(
          "ANALYTICS_DISPLAY_ELEMENT_ID_DUPLICATE",
          "Analytics display element ids must be unique.",
          `$.spec.elements[${index}].id`,
        ),
      );
    } else {
      seen.set(element.id, index);
    }
  }
}

function validateColumnRef(
  value: unknown,
  columnKeys: Set<string>,
  path: string,
  diagnostics: AnalyticsDisplayDiagnostic[],
) {
  if (typeof value !== "string" || !columnKeys.has(value)) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_COLUMN_UNKNOWN",
        "Analytics display element references an unknown column.",
        path,
      ),
    );
  }
}

function validatePalette(
  value: unknown,
  path: string,
  diagnostics: AnalyticsDisplayDiagnostic[],
  required: boolean,
) {
  if (value == null && !required) return;
  if (!paletteTokenSet.has(String(value))) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_PALETTE_TOKEN_INVALID",
        "Analytics display colors must use approved chart palette tokens.",
        path,
      ),
    );
  }
}

function validateLabel(
  value: unknown,
  path: string,
  diagnostics: AnalyticsDisplayDiagnostic[],
) {
  if (typeof value !== "string" || !value.trim()) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_LABEL_REQUIRED",
        "Analytics display labels must be non-empty strings.",
        path,
      ),
    );
    return;
  }

  if (hasHtmlMetacharacters(value)) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_LABEL_UNSAFE",
        "Analytics display labels must not contain HTML metacharacters.",
        path,
      ),
    );
  }

  if (value.length > analyticsDisplayLimits.maxLabelLength) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_LABEL_TOO_LONG",
        `Analytics display labels support at most ${analyticsDisplayLimits.maxLabelLength} characters.`,
        path,
      ),
    );
  }
}

function validateOptionalText(
  value: unknown,
  path: string,
  diagnostics: AnalyticsDisplayDiagnostic[],
) {
  if (value == null) return;
  validateLabel(value, path, diagnostics);
}

function validateRowStringValue(
  value: unknown,
  path: string,
  diagnostics: AnalyticsDisplayDiagnostic[],
) {
  if (typeof value !== "string") return;

  if (value.length > analyticsDisplayLimits.maxStringValueLength) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_STRING_VALUE_TOO_LONG",
        `Analytics display string values support at most ${analyticsDisplayLimits.maxStringValueLength} characters.`,
        path,
      ),
    );
  }
}

function validatePayloadSize(
  input: Record<string, unknown>,
  diagnostics: AnalyticsDisplayDiagnostic[],
) {
  let serialized = "";
  try {
    serialized = JSON.stringify(input);
  } catch {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_PAYLOAD_NOT_SERIALIZABLE",
        "Analytics display payload must be JSON serializable.",
        "$",
      ),
    );
    return;
  }

  if (serialized.length > analyticsDisplayLimits.maxSerializedPayloadBytes) {
    diagnostics.push(
      errorDiagnostic(
        "ANALYTICS_DISPLAY_PAYLOAD_TOO_LARGE",
        `Analytics display payloads support at most ${analyticsDisplayLimits.maxSerializedPayloadBytes} serialized bytes.`,
        "$",
      ),
    );
  }
}

function collectForbiddenReferenceDiagnostics(
  value: unknown,
  path: string,
  diagnostics: AnalyticsDisplayDiagnostic[],
) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      collectForbiddenReferenceDiagnostics(
        item,
        `${path}[${index}]`,
        diagnostics,
      );
    }
    return;
  }

  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = path === "$" ? `$.${key}` : `${path}.${key}`;
    if (FORBIDDEN_REFERENCE_KEYS.has(key)) {
      diagnostics.push(
        errorDiagnostic(
          "ANALYTICS_DISPLAY_REFERENCE_FORBIDDEN",
          "Inline analytical display payloads must be portable and cannot reference dashboards or datasets.",
          childPath,
        ),
      );
    }
    collectForbiddenReferenceDiagnostics(child, childPath, diagnostics);
  }
}

function collectForbiddenSpecStyleDiagnostics(
  value: unknown,
  path: string,
  diagnostics: AnalyticsDisplayDiagnostic[],
) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      collectForbiddenSpecStyleDiagnostics(
        item,
        `${path}[${index}]`,
        diagnostics,
      );
    }
    return;
  }

  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const childPath = path === "$" ? `$.${key}` : `${path}.${key}`;
    if (FORBIDDEN_SPEC_STYLE_KEYS.has(key)) {
      diagnostics.push(
        errorDiagnostic(
          "ANALYTICS_DISPLAY_RAW_STYLE_FORBIDDEN",
          "Analytics display specs must use approved palette tokens instead of raw style fields.",
          childPath,
        ),
      );
    }
    collectForbiddenSpecStyleDiagnostics(child, childPath, diagnostics);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAnalyticsPrimitive(
  value: unknown,
): value is AnalyticsPrimitive {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isAnalyticsColumnCandidate(
  value: unknown,
): value is AnalyticsColumnSpec {
  return isRecord(value) && typeof value.key === "string";
}
