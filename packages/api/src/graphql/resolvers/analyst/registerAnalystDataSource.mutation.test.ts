/**
 * registerAnalystDataSource resolver tests (THINK-239).
 *
 * Mirrors the provisionAnalystConnector test shape: mock every lib dep and
 * assert the auth gate, input/slug validation mapping, ceremony ORDER, and
 * that a read-only-posture failure aborts before any write.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphQLError } from "graphql";

const h = vi.hoisted(() => {
  const calls: string[] = [];
  const configMap: Record<string, string | undefined> = {};

  class AnalystRegistrationInputError extends Error {}
  class AnalystRegistrationPostureError extends Error {}
  class AnalystRegistrationConflictError extends Error {}

  const state = {
    caller: { userId: "user-1", tenantId: "tenant-1" } as {
      userId: string | null;
      tenantId: string | null;
    },
    adminError: null as Error | null,
    validateError: null as Error | null,
    slugError: null as Error | null,
    probeError: null as Error | null,
    brokerSecretError: null as Error | null,
    model: {
      version: 2 as const,
      tables: [{ schema: "public", name: "orders", columns: [] }],
    },
    folder: { agents: 2, files: [], skipped: [] as unknown[] },
  };
  return {
    calls,
    configMap,
    state,
    AnalystRegistrationInputError,
    AnalystRegistrationPostureError,
    AnalystRegistrationConflictError,
  };
});

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: (key: string) => h.configMap[key],
}));

vi.mock("@thinkwork/database-pg/analyst", () => ({
  renderStoredAnalystSchemaMarkdown: () => {
    h.calls.push("render");
    return "# schema";
  },
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: async () => {
    h.calls.push("requireAdmin");
    if (h.state.adminError) throw h.state.adminError;
    return "admin";
  },
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCaller: async () => h.state.caller,
}));

vi.mock("../../../lib/analyst/connection-folder.js", () => ({
  materializeAnalystConnectionFolder: async (input: { signedBy?: string }) => {
    h.calls.push(`materialize:signedBy=${input.signedBy}`);
    return h.state.folder;
  },
}));

vi.mock("../../../lib/analyst/provision-connector.js", () => ({
  ensureAnalystBrokerSecretValue: async (input: {
    secretRef: string;
    tenantId: string;
  }) => {
    h.calls.push(`brokerSecret:${input.secretRef}:${input.tenantId}`);
    if (h.state.brokerSecretError) throw h.state.brokerSecretError;
    return "unchanged";
  },
}));

vi.mock("../../../lib/analyst/register-data-source.js", () => ({
  AnalystRegistrationInputError: h.AnalystRegistrationInputError,
  AnalystRegistrationPostureError: h.AnalystRegistrationPostureError,
  AnalystRegistrationConflictError: h.AnalystRegistrationConflictError,
  validateRegisterInput: (input: { slug: string; name: string }) => {
    h.calls.push("validate");
    if (h.state.validateError) throw h.state.validateError;
    return {
      name: input.name,
      slug: input.slug,
      host: "h",
      port: 5432,
      database: "d",
      dbUser: "u",
      password: "p",
      tls: "verify-full",
    };
  },
  assertSlugAvailable: async () => {
    h.calls.push("assertSlug");
    if (h.state.slugError) throw h.state.slugError;
  },
  probeAndModelExternalSource: async () => {
    h.calls.push("probe");
    if (h.state.probeError) throw h.state.probeError;
    return h.state.model;
  },
  analystSourceCredentialSecretName: () =>
    "thinkwork/dev/analyst/tenant-1/sales-pg-reader-credential",
  writeSourceCredentialSecret: async () => {
    h.calls.push("secret");
    return "arn:secret:sales";
  },
  resolveTenantSlug: async () => {
    h.calls.push("tenantSlug");
    return "acme";
  },
  writeSourceModelToS3: async () => {
    h.calls.push("s3");
    return { modelKey: "k1", schemaKey: "k2" };
  },
  insertExternalSourceRow: async (opts: { source?: { kind?: string } }) => {
    h.calls.push(`row:kind=${opts.source?.kind}`);
    return { id: "srv-9" };
  },
}));

const ctx = { auth: { email: "op@example.com" } } as never;
const INPUT = {
  name: "Sales Postgres",
  slug: "sales-pg",
  host: "h",
  port: 5432,
  database: "d",
  dbUser: "u",
  password: "p",
  tls: "VERIFY_FULL" as const,
};

async function load() {
  const mod = await import("./registerAnalystDataSource.mutation.js");
  return mod.registerAnalystDataSource;
}

describe("registerAnalystDataSource (THINK-239)", () => {
  beforeEach(() => {
    h.calls.length = 0;
    for (const k of Object.keys(h.configMap)) delete h.configMap[k];
    h.configMap.THINKWORK_API_URL = "https://api.example";
    h.configMap.ANALYST_BROKER_SECRET_ARN = "arn:broker";
    h.configMap.WORKSPACE_BUCKET = "workspace-bucket";
    h.state.caller = { userId: "user-1", tenantId: "tenant-1" };
    h.state.adminError = null;
    h.state.validateError = null;
    h.state.slugError = null;
    h.state.probeError = null;
    h.state.brokerSecretError = null;
    h.state.model = {
      version: 2,
      tables: [{ schema: "public", name: "orders", columns: [] }],
    };
    h.state.folder = { agents: 2, files: [], skipped: [] };
  });

  it("rejects a non-admin caller before any ceremony step", async () => {
    h.state.adminError = new GraphQLError("Tenant admin role required", {
      extensions: { code: "FORBIDDEN" },
    });
    const resolver = await load();
    await expect(resolver(undefined, { input: INPUT }, ctx)).rejects.toThrow(
      "Tenant admin role required",
    );
    expect(h.calls).toEqual(["requireAdmin"]);
  });

  it("rejects when the caller has no tenant context", async () => {
    h.state.caller = { userId: "user-1", tenantId: null };
    const resolver = await load();
    await expect(resolver(undefined, { input: INPUT }, ctx)).rejects.toThrow(
      "Tenant context required",
    );
    expect(h.calls).toEqual([]);
  });

  it("maps a slug/input validation failure to BAD_USER_INPUT before writes", async () => {
    h.state.validateError = new h.AnalystRegistrationInputError(
      'slug "postgres-dev" is reserved for a built-in data source — choose another.',
    );
    const resolver = await load();
    await expect(resolver(undefined, { input: INPUT }, ctx)).rejects.toThrow(
      /reserved/,
    );
    expect(h.calls).toEqual(["requireAdmin", "validate"]);
  });

  it("maps a slug conflict to CONFLICT before touching the source", async () => {
    h.state.slugError = new h.AnalystRegistrationConflictError(
      'a data source with slug "sales-pg" is already registered for this tenant',
    );
    const resolver = await load();
    await expect(resolver(undefined, { input: INPUT }, ctx)).rejects.toThrow(
      /already registered/,
    );
    // No probe/secret/row after the conflict.
    expect(h.calls).toEqual([
      "requireAdmin",
      "validate",
      "brokerSecret:arn:broker:tenant-1",
      "assertSlug",
    ]);
  });

  it("aborts on a read-only-posture failure before any write step", async () => {
    h.state.probeError = new h.AnalystRegistrationPostureError(
      "the supplied credential holds non-SELECT privileges (orders:INSERT)",
    );
    const resolver = await load();
    await expect(resolver(undefined, { input: INPUT }, ctx)).rejects.toThrow(
      /non-SELECT/,
    );
    // Probe ran; nothing was written (no secret/s3/row/profile/materialize).
    expect(h.calls).toEqual([
      "requireAdmin",
      "validate",
      "brokerSecret:arn:broker:tenant-1",
      "assertSlug",
      "probe",
    ]);
  });

  it("runs the full ceremony in order and returns the result", async () => {
    h.state.model = {
      version: 2,
      tables: [
        { schema: "public", name: "orders", columns: [] },
        { schema: "public", name: "customers", columns: [] },
      ],
    };
    h.state.folder = { agents: 3, files: [], skipped: [{}] };
    const resolver = await load();
    const result = await resolver(undefined, { input: INPUT }, ctx);
    expect(h.calls).toEqual([
      "requireAdmin",
      "validate",
      "brokerSecret:arn:broker:tenant-1",
      "assertSlug",
      "probe",
      "secret",
      "tenantSlug",
      "render",
      "s3",
      "row:kind=external",
      "materialize:signedBy=operator:op@example.com",
    ]);
    expect(result).toEqual({
      serverId: "srv-9",
      slug: "sales-pg",
      tables: 2,
      foldersWritten: 3,
      foldersSkipped: 1,
    });
  });

  it("fails fast when platform config is missing", async () => {
    delete h.configMap.WORKSPACE_BUCKET;
    const resolver = await load();
    await expect(resolver(undefined, { input: INPUT }, ctx)).rejects.toThrow(
      /WORKSPACE_BUCKET/,
    );
    // Validated the input, then bailed before slug/probe.
    expect(h.calls).toEqual(["requireAdmin", "validate"]);
  });

  it("aborts with BAD_USER_INPUT when the broker credential cannot hold a value", async () => {
    h.state.brokerSecretError = new Error("AccessDeniedException: nope");
    const resolver = await load();
    const err = await resolver(undefined, { input: INPUT }, ctx).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(GraphQLError);
    expect((err as GraphQLError).extensions.code).toBe("BAD_USER_INPUT");
    expect((err as GraphQLError).message).toMatch(
      /broker credential .*arn:broker.* is unusable/,
    );
    // Fails before the slug check or any source contact.
    expect(h.calls).toEqual([
      "requireAdmin",
      "validate",
      "brokerSecret:arn:broker:tenant-1",
    ]);
  });
});
