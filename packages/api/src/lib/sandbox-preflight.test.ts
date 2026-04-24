/**
 * Tests for the pure classifyPreflight decision tree. The full
 * checkSandboxPreflight path goes through DB; exercised empirically in
 * dev, not mocked here.
 */

import { describe, it, expect } from "vitest";
import {
  applySandboxPayloadFields,
  classifyPreflight,
} from "./sandbox-preflight.js";

const base = {
  tenant: {
    sandboxEnabled: true,
    interpreterPublicId: "ci-public-1",
    interpreterInternalId: "ci-internal-1",
  },
};

describe("classifyPreflight — null template", () => {
  it("returns not-requested when template has no sandbox block", () => {
    expect(classifyPreflight({ ...base, templateSandbox: null })).toEqual({
      status: "not-requested",
    });
  });
});

describe("classifyPreflight — tenant gate", () => {
  it("returns disabled when tenant.sandbox_enabled is false", () => {
    expect(
      classifyPreflight({
        ...base,
        tenant: { ...base.tenant, sandboxEnabled: false },
        templateSandbox: { environment: "default-public" },
      }),
    ).toEqual({ status: "disabled" });
  });

  it("returns disabled when tenant row is missing", () => {
    expect(
      classifyPreflight({
        ...base,
        tenant: null,
        templateSandbox: { environment: "default-public" },
      }),
    ).toEqual({ status: "disabled" });
  });
});

describe("classifyPreflight — interpreter-ready gate", () => {
  it("returns provisioning when the default-public interpreter is null", () => {
    const result = classifyPreflight({
      ...base,
      tenant: { ...base.tenant, interpreterPublicId: null },
      templateSandbox: { environment: "default-public" },
    });
    expect(result).toEqual({
      status: "provisioning",
      environment: "default-public",
    });
  });

  it("returns provisioning when the internal-only interpreter is null", () => {
    const result = classifyPreflight({
      ...base,
      tenant: { ...base.tenant, interpreterInternalId: null },
      templateSandbox: { environment: "internal-only" },
    });
    expect(result).toEqual({
      status: "provisioning",
      environment: "internal-only",
    });
  });

  it("R-Q10: a null public interpreter still allows internal-only use", () => {
    // Plan R-Q10: interpreter-ready gate is per-environment. default-
    // public is null but the template asked for internal-only which is
    // populated → ready.
    const result = classifyPreflight({
      ...base,
      tenant: { ...base.tenant, interpreterPublicId: null },
      templateSandbox: { environment: "internal-only" },
    });
    expect(result.status).toBe("ready");
  });
});

describe("classifyPreflight — ready", () => {
  it("returns ready with environment + interpreter id (no secrets)", () => {
    const result = classifyPreflight({
      ...base,
      templateSandbox: { environment: "default-public" },
    });
    expect(result).toEqual({
      status: "ready",
      environment: "default-public",
      interpreterId: "ci-public-1",
    });
  });
});

describe("applySandboxPayloadFields", () => {
  it("does nothing when result is not ready", () => {
    const payload: Record<string, unknown> = {};
    applySandboxPayloadFields(payload, {
      status: "not-requested",
      reason: "template_did_not_opt_in",
      caller: "execute_code",
    });
    expect(payload).toEqual({});
  });

  it("threads only sandbox_interpreter_id + sandbox_environment when ready", () => {
    const payload: Record<string, unknown> = { existing: "keep me" };
    applySandboxPayloadFields(payload, {
      status: "ready",
      environment: "default-public",
      interpreterId: "ci-abc",
      caller: "execute_code",
    });
    expect(payload).toEqual({
      existing: "keep me",
      sandbox_interpreter_id: "ci-abc",
      sandbox_environment: "default-public",
    });
    // Regression: the retired OAuth preamble fields must not appear.
    expect(payload).not.toHaveProperty("sandbox_secret_paths");
    expect(payload).not.toHaveProperty("sandbox_tenant_id");
    expect(payload).not.toHaveProperty("sandbox_user_id");
    expect(payload).not.toHaveProperty("sandbox_stage");
  });
});
