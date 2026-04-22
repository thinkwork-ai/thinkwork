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

  it("accepts a fully valid object", () => {
    const r = validateTemplateSandbox({
      environment: "default-public",
      required_connections: ["github", "slack"],
    });
    expect(r).toEqual({
      ok: true,
      value: {
        environment: "default-public",
        required_connections: ["github", "slack"],
      },
    });
  });

  it("accepts internal-only with empty required_connections", () => {
    const r = validateTemplateSandbox({
      environment: "internal-only",
      required_connections: [],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value?.environment).toBe("internal-only");
  });

  it("defaults missing required_connections to empty array", () => {
    const r = validateTemplateSandbox({ environment: "internal-only" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value?.required_connections).toEqual([]);
  });

  it("parses a JSON-string payload (matches other template-field behavior)", () => {
    const r = validateTemplateSandbox(
      JSON.stringify({
        environment: "default-public",
        required_connections: ["google"],
      }),
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

  it("rejects required_connections that is not an array", () => {
    const r = validateTemplateSandbox({
      environment: "default-public",
      required_connections: "github",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/must be an array/);
  });

  it("rejects unknown connection type (plan test scenario: 'notion')", () => {
    const r = validateTemplateSandbox({
      environment: "default-public",
      required_connections: ["notion"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/"notion" is not an allowed/);
  });

  it("rejects duplicate entries in required_connections", () => {
    const r = validateTemplateSandbox({
      environment: "default-public",
      required_connections: ["github", "github"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/duplicate entry/);
  });

  it("rejects non-string entries in required_connections", () => {
    const r = validateTemplateSandbox({
      environment: "default-public",
      required_connections: [42],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/entries must be strings/);
  });
});
