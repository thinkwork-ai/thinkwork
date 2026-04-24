import { describe, it, expect } from "vitest";
import { validateTemplateSandbox } from "./sandbox-config.js";

describe("validateTemplateSandbox", () => {
  it("accepts null as opt-out", () => {
    expect(validateTemplateSandbox(null)).toEqual({ ok: true, value: null });
  });

  it("accepts undefined as opt-out", () => {
    expect(validateTemplateSandbox(undefined)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("accepts a minimal valid object", () => {
    expect(
      validateTemplateSandbox({ environment: "default-public" }),
    ).toEqual({
      ok: true,
      value: { environment: "default-public" },
    });
  });

  it("accepts internal-only", () => {
    const r = validateTemplateSandbox({ environment: "internal-only" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value?.environment).toBe("internal-only");
  });

  it("parses a JSON-string payload (matches other template-field behavior)", () => {
    const r = validateTemplateSandbox(
      JSON.stringify({ environment: "default-public" }),
    );
    expect(r.ok).toBe(true);
  });

  it("rejects a string that is not valid JSON", () => {
    const r = validateTemplateSandbox("{ bogus");
    expect(r).toEqual({ ok: false, error: "sandbox: invalid JSON payload" });
  });

  it("rejects an array at the top level", () => {
    const r = validateTemplateSandbox([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/must be an object/);
  });

  it("rejects unknown environment", () => {
    const r = validateTemplateSandbox({ environment: "bogus" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/must be one of/);
  });

  it("rejects missing environment", () => {
    const r = validateTemplateSandbox({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/environment: required string/);
  });

  it("rejects a payload with `required_connections` (retired field)", () => {
    const r = validateTemplateSandbox({
      environment: "default-public",
      required_connections: ["github"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.error).toMatch(/required_connections is no longer accepted/);
  });

  it("rejects an empty `required_connections` array (still the retired field)", () => {
    const r = validateTemplateSandbox({
      environment: "default-public",
      required_connections: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.error).toMatch(/required_connections is no longer accepted/);
  });
});
