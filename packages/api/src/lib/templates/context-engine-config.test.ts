import { describe, expect, it } from "vitest";
import { validateTemplateContextEngine } from "./context-engine-config.js";

describe("validateTemplateContextEngine", () => {
  it("accepts enabled opt-in objects and JSON strings", () => {
    expect(validateTemplateContextEngine({ enabled: true })).toEqual({
      ok: true,
      value: { enabled: true },
    });
    expect(validateTemplateContextEngine('{"enabled":true}')).toEqual({
      ok: true,
      value: { enabled: true },
    });
  });

  it("treats null and undefined as disabled", () => {
    expect(validateTemplateContextEngine(null)).toEqual({
      ok: true,
      value: null,
    });
    expect(validateTemplateContextEngine(undefined)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("accepts provider and memory mode overrides", () => {
    expect(
      validateTemplateContextEngine({
        enabled: true,
        providers: { ids: ["memory", "wiki", "memory"] },
        providerOptions: { memory: { queryMode: "reflect" } },
      }),
    ).toEqual({
      ok: true,
      value: {
        enabled: true,
        providers: { ids: ["memory", "wiki"] },
        providerOptions: { memory: { queryMode: "reflect" } },
      },
    });
  });

  it("rejects disabled or invalid expanded shapes", () => {
    expect(validateTemplateContextEngine({ enabled: false }).ok).toBe(false);
    expect(
      validateTemplateContextEngine({ enabled: true, mode: "all" }).ok,
    ).toBe(false);
    expect(
      validateTemplateContextEngine({
        enabled: true,
        providers: { ids: ["memory", ""] },
      }).ok,
    ).toBe(false);
    expect(
      validateTemplateContextEngine({
        enabled: true,
        providerOptions: { memory: { queryMode: "summary" } },
      }).ok,
    ).toBe(false);
  });
});
