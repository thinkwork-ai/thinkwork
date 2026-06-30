import { describe, expect, it } from "vitest";
import { analyticsDisplayCatalog } from "./catalog.js";
import {
  ANALYTICS_DISPLAY_VERSION,
  CHART_KINDS,
  FILTER_OPERATORS,
  PALETTE_TOKENS,
  VALUE_TYPES,
  SENSITIVITY_LEVELS,
  REDACTION_MODES,
} from "./spec.js";

describe("analyticsDisplayCatalog", () => {
  it("exposes the current version", () => {
    expect(analyticsDisplayCatalog.version).toBe(ANALYTICS_DISPLAY_VERSION);
  });

  it("lists the three element types", () => {
    expect(analyticsDisplayCatalog.elements).toEqual([
      "metric",
      "chart",
      "table",
    ]);
  });

  it("references the spec-defined chart kinds", () => {
    expect(analyticsDisplayCatalog.chartKinds).toBe(CHART_KINDS);
    expect([...analyticsDisplayCatalog.chartKinds]).toEqual([
      "bar",
      "line",
      "area",
      "pie",
    ]);
  });

  it("references the spec-defined filter operators", () => {
    expect(analyticsDisplayCatalog.filterOperators).toBe(FILTER_OPERATORS);
  });

  it("references the spec-defined palette tokens", () => {
    expect(analyticsDisplayCatalog.paletteTokens).toBe(PALETTE_TOKENS);
    expect(analyticsDisplayCatalog.paletteTokens).toHaveLength(5);
  });

  it("references the spec-defined value types", () => {
    expect(analyticsDisplayCatalog.valueTypes).toBe(VALUE_TYPES);
  });

  it("references the spec-defined sensitivity levels", () => {
    expect(analyticsDisplayCatalog.sensitivityLevels).toBe(SENSITIVITY_LEVELS);
  });

  it("references the spec-defined redaction modes", () => {
    expect(analyticsDisplayCatalog.redactionModes).toBe(REDACTION_MODES);
  });
});
