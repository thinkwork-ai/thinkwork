import {
  ANALYTICS_DISPLAY_VERSION,
  CHART_KINDS,
  FILTER_OPERATORS,
  PALETTE_TOKENS,
  REDACTION_MODES,
  SENSITIVITY_LEVELS,
  VALUE_TYPES,
} from "./spec.js";

export const analyticsDisplayCatalog = {
  version: ANALYTICS_DISPLAY_VERSION,
  elements: ["metric", "chart", "table"],
  chartKinds: CHART_KINDS,
  filterOperators: FILTER_OPERATORS,
  paletteTokens: PALETTE_TOKENS,
  valueTypes: VALUE_TYPES,
  sensitivityLevels: SENSITIVITY_LEVELS,
  redactionModes: REDACTION_MODES,
} as const;
