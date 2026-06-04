import { describe, expect, it } from "vitest";
import { validateTemplateWebExtract } from "./web-extract-config.js";

describe("validateTemplateWebExtract", () => {
  it("accepts null and enabled opt-in objects", () => {
    expect(validateTemplateWebExtract(null)).toEqual({
      ok: true,
      value: null,
    });
    expect(validateTemplateWebExtract({ enabled: true })).toEqual({
      ok: true,
      value: { enabled: true },
    });
    expect(validateTemplateWebExtract('{"enabled":true}')).toEqual({
      ok: true,
      value: { enabled: true },
    });
  });

  it("rejects malformed or unsupported config", () => {
    expect(validateTemplateWebExtract("nope")).toEqual({
      ok: false,
      error: "webExtract must be valid JSON",
    });
    expect(validateTemplateWebExtract({ enabled: false })).toEqual({
      ok: false,
      error: "webExtract.enabled must be true when present",
    });
    expect(
      validateTemplateWebExtract({ enabled: true, provider: "firecrawl" }),
    ).toEqual({
      ok: false,
      error: "webExtract has unsupported field(s): provider",
    });
  });
});
