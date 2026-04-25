import { describe, expect, it } from "vitest";
import { validateTemplateBrowser } from "./browser-config.js";

describe("validateTemplateBrowser", () => {
  it("returns null for absent config", () => {
    expect(validateTemplateBrowser(undefined)).toEqual({
      ok: true,
      value: null,
    });
    expect(validateTemplateBrowser(null)).toEqual({ ok: true, value: null });
  });

  it("accepts an enabled config object", () => {
    expect(validateTemplateBrowser({ enabled: true })).toEqual({
      ok: true,
      value: { enabled: true },
    });
  });

  it("accepts an enabled config JSON string", () => {
    expect(validateTemplateBrowser('{"enabled":true}')).toEqual({
      ok: true,
      value: { enabled: true },
    });
  });

  it("rejects malformed JSON strings", () => {
    expect(validateTemplateBrowser("{")).toEqual({
      ok: false,
      error: "browser must be valid JSON",
    });
  });

  it("rejects non-object values", () => {
    expect(validateTemplateBrowser(true)).toEqual({
      ok: false,
      error: "browser must be an object or null",
    });
  });

  it("requires enabled to be true when config is present", () => {
    expect(validateTemplateBrowser({ enabled: false })).toEqual({
      ok: false,
      error: "browser.enabled must be true when present",
    });
  });

  it("rejects raw browser/session primitives", () => {
    expect(
      validateTemplateBrowser({ enabled: true, sessionId: "abc" }),
    ).toEqual({
      ok: false,
      error: "browser has unsupported field(s): sessionId",
    });
  });
});
