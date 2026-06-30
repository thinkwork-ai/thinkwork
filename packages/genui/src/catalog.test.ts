import { describe, expect, it } from "vitest";
import {
  isNativeGenUIComponent,
  isReservedAdapterComponent,
  isAnalyticalComponentName,
  threadGenUICatalog,
} from "./catalog.js";
import {
  THREAD_GENUI_CATALOG_VERSION,
  THREAD_GENUI_NATIVE_COMPONENTS,
  THREAD_GENUI_RESERVED_ADAPTER_COMPONENTS,
} from "./spec.js";

describe("threadGenUICatalog", () => {
  it("exposes the current catalog version", () => {
    expect(threadGenUICatalog.version).toBe(THREAD_GENUI_CATALOG_VERSION);
  });

  it("references the spec-defined native and adapter component lists", () => {
    expect(threadGenUICatalog.nativeComponents).toBe(
      THREAD_GENUI_NATIVE_COMPONENTS,
    );
    expect(threadGenUICatalog.reservedAdapterComponents).toBe(
      THREAD_GENUI_RESERVED_ADAPTER_COMPONENTS,
    );
  });
});

describe("isNativeGenUIComponent", () => {
  it("returns true for each spec-defined native component", () => {
    for (const component of THREAD_GENUI_NATIVE_COMPONENTS) {
      expect(isNativeGenUIComponent(component)).toBe(true);
    }
  });

  it("returns false for adapter components", () => {
    expect(isNativeGenUIComponent("analytics.display")).toBe(false);
  });

  it("returns false for unknown components", () => {
    expect(isNativeGenUIComponent("custom.widget")).toBe(false);
  });
});

describe("isReservedAdapterComponent", () => {
  it("returns true for analytics.display", () => {
    expect(isReservedAdapterComponent("analytics.display")).toBe(true);
  });

  it("returns false for native components", () => {
    expect(isReservedAdapterComponent("task.review")).toBe(false);
  });

  it("returns false for unknown components", () => {
    expect(isReservedAdapterComponent("chart.3d")).toBe(false);
  });
});

describe("isAnalyticalComponentName", () => {
  it("returns true for the canonical analytics.display component", () => {
    expect(isAnalyticalComponentName("analytics.display")).toBe(true);
  });

  it.each(["chart", "table", "metric"])(
    "returns true for short alias '%s'",
    (alias) => {
      expect(isAnalyticalComponentName(alias)).toBe(true);
    },
  );

  it.each(["analytics.dashboard", "chart.bar", "table.pivot", "metric.kpi"])(
    "returns true for prefixed name '%s'",
    (name) => {
      expect(isAnalyticalComponentName(name)).toBe(true);
    },
  );

  it("returns false for non-analytical components", () => {
    expect(isAnalyticalComponentName("task.review")).toBe(false);
    expect(isAnalyticalComponentName("form.action")).toBe(false);
    expect(isAnalyticalComponentName("widget")).toBe(false);
  });
});
