/**
 * Tests for the pure classifyPreflight decision tree. The full
 * checkSandboxPreflight path goes through DB + Secrets Manager; those are
 * exercised empirically in dev, not mocked here.
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
  activeConnections: new Set(["github", "slack"]),
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
        templateSandbox: {
          environment: "default-public",
          required_connections: [],
        },
      }),
    ).toEqual({ status: "disabled" });
  });

  it("returns disabled when tenant row is missing", () => {
    expect(
      classifyPreflight({
        ...base,
        tenant: null,
        templateSandbox: {
          environment: "default-public",
          required_connections: [],
        },
      }),
    ).toEqual({ status: "disabled" });
  });
});

describe("classifyPreflight — interpreter-ready gate", () => {
  it("returns provisioning when the default-public interpreter is null", () => {
    const result = classifyPreflight({
      ...base,
      tenant: { ...base.tenant, interpreterPublicId: null },
      templateSandbox: {
        environment: "default-public",
        required_connections: [],
      },
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
      templateSandbox: {
        environment: "internal-only",
        required_connections: [],
      },
    });
    expect(result).toEqual({
      status: "provisioning",
      environment: "internal-only",
    });
  });

  it("R-Q10: a null public interpreter still allows internal-only use", () => {
    // The plan's R-Q10: interpreter-ready gate is per-environment.
    // default-public is null but the template asked for internal-only,
    // which is populated → ready.
    const result = classifyPreflight({
      ...base,
      tenant: { ...base.tenant, interpreterPublicId: null },
      templateSandbox: {
        environment: "internal-only",
        required_connections: [],
      },
    });
    expect(result.status).toBe("ready-pending-secrets");
  });
});

describe("classifyPreflight — required_connections gate", () => {
  it("returns missing-connection with only the missing type named", () => {
    const result = classifyPreflight({
      ...base,
      activeConnections: new Set(["github"]),
      templateSandbox: {
        environment: "default-public",
        required_connections: ["github", "slack"],
      },
    });
    expect(result).toEqual({
      status: "missing-connection",
      missing: ["slack"],
    });
  });

  it("returns missing-connection naming every missing type", () => {
    const result = classifyPreflight({
      ...base,
      activeConnections: new Set(),
      templateSandbox: {
        environment: "default-public",
        required_connections: ["github", "slack", "google"],
      },
    });
    expect(result).toEqual({
      status: "missing-connection",
      missing: ["github", "slack", "google"],
    });
  });

  it("rejects an unknown connection_type even if the user happens to have it", () => {
    // Defensive: Unit 3 template validator should have caught this, but the
    // pre-flight must not pass-through an unlisted identifier.
    const result = classifyPreflight({
      ...base,
      activeConnections: new Set(["notion"]),
      templateSandbox: {
        environment: "default-public",
        required_connections: ["notion" as any],
      },
    });
    expect(result).toEqual({
      status: "missing-connection",
      missing: ["notion"],
    });
  });

  it("empty required_connections is ready (internal-only script case)", () => {
    const result = classifyPreflight({
      ...base,
      activeConnections: new Set(),
      templateSandbox: {
        environment: "internal-only",
        required_connections: [],
      },
    });
    expect(result.status).toBe("ready-pending-secrets");
  });
});

describe("classifyPreflight — ready", () => {
  it("returns ready-pending-secrets with environment + interpreter id", () => {
    const result = classifyPreflight({
      ...base,
      templateSandbox: {
        environment: "default-public",
        required_connections: ["github", "slack"],
      },
    });
    expect(result).toEqual({
      status: "ready-pending-secrets",
      environment: "default-public",
      interpreterId: "ci-public-1",
    });
  });
});

describe("applySandboxPayloadFields", () => {
  it("does nothing when result is not ready", () => {
    const payload: Record<string, unknown> = {};
    applySandboxPayloadFields(
      payload,
      { status: "not-requested", reason: "template_did_not_opt_in" },
      { tenantId: "t", userId: "u", stage: "dev" },
    );
    expect(payload).toEqual({});
  });

  it("threads all sandbox_* fields onto the payload when ready", () => {
    const payload: Record<string, unknown> = { existing: "keep me" };
    applySandboxPayloadFields(
      payload,
      {
        status: "ready",
        environment: "default-public",
        interpreterId: "ci-abc",
        secretPaths: { github: "arn:aws:...:github" },
      },
      { tenantId: "tenant-1", userId: "user-1", stage: "dev" },
    );
    expect(payload).toEqual({
      existing: "keep me",
      sandbox_interpreter_id: "ci-abc",
      sandbox_environment: "default-public",
      sandbox_secret_paths: JSON.stringify({ github: "arn:aws:...:github" }),
      sandbox_tenant_id: "tenant-1",
      sandbox_user_id: "user-1",
      sandbox_stage: "dev",
    });
  });
});
