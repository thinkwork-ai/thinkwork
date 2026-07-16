/**
 * registerInternalAnalystDataSource resolver tests (THINK-239).
 *
 * Mocks every lib dep and asserts the auth gate, the thinkwork/database/cluster
 * rejections, the ceremony ORDER (including role auto-provisioning before any
 * write), and the returned result.
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
    clusters: [
      {
        clusterId: "thinkwork-dev-aurora",
        endpoint: "aurora.dev.rds.amazonaws.com",
        port: 5432,
      },
    ],
    adminCredential: { username: "master", password: "pw" } as {
      username: string;
      password: string;
    } | null,
    databases: ["sales", "thinkwork"],
    slugError: null as Error | null,
    probeError: null as Error | null,
    provisionError: null as Error | null,
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

vi.mock("../../../lib/analyst/register-internal-data-source.js", () => ({
  validateInternalRegisterInput: (input: {
    slug: string;
    name: string;
    clusterId: string;
    database: string;
  }) => {
    h.calls.push("validate");
    if (h.state.validateError) throw h.state.validateError;
    return {
      clusterId: input.clusterId,
      database: input.database,
      name: input.name,
      slug: input.slug,
      // THINK-283: the real validator always emits a normalized schema.
      schema: (input as { schema?: string | null }).schema?.trim() || "public",
    };
  },
}));

vi.mock("../../../lib/analyst/internal-clusters.js", () => ({
  resolveStage: () => "dev",
  describeInternalClusters: async () => {
    h.calls.push("describe");
    return h.state.clusters;
  },
  resolveAdminCredential: async () => {
    h.calls.push("resolveAdmin");
    return h.state.adminCredential;
  },
  enumerateDatabases: async () => {
    h.calls.push("enumerate");
    return h.state.databases;
  },
  openAdminClient: async () => {
    h.calls.push("openAdmin");
    return { end: async () => h.calls.push("closeAdmin") };
  },
}));

vi.mock("../../../lib/analyst/provision-reader-role.js", () => ({
  readerRoleName: (slug: string) => `${slug.replace(/-/g, "_")}_reader`,
  generateReaderPassword: () => "generated-pw",
  provisionReaderRole: async (params: { schema?: string }) => {
    h.calls.push(`provision:schema=${params.schema}`);
    if (h.state.provisionError) throw h.state.provisionError;
    return { grantedTables: ["orders"] };
  },
}));

vi.mock("../../../lib/analyst/register-data-source.js", () => ({
  AnalystRegistrationInputError: h.AnalystRegistrationInputError,
  AnalystRegistrationPostureError: h.AnalystRegistrationPostureError,
  AnalystRegistrationConflictError: h.AnalystRegistrationConflictError,
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
    "thinkwork/dev/analyst/tenant-1/sales-reader-credential",
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
  insertExternalSourceRow: async (opts: {
    input?: { schema?: string };
    source?: { kind?: string; clusterId?: string };
  }) => {
    h.calls.push(
      `row:kind=${opts.source?.kind},cluster=${opts.source?.clusterId},schema=${opts.input?.schema}`,
    );
    return { id: "srv-9" };
  },
}));

const ctx = { auth: { email: "op@example.com" } } as never;
const INPUT = {
  clusterId: "thinkwork-dev-aurora",
  database: "sales",
  name: "Sales Postgres",
  slug: "sales-pg",
};

async function load() {
  const mod = await import("./registerInternalAnalystDataSource.mutation.js");
  return mod.registerInternalAnalystDataSource;
}

describe("registerInternalAnalystDataSource (THINK-239)", () => {
  beforeEach(() => {
    h.calls.length = 0;
    for (const k of Object.keys(h.configMap)) delete h.configMap[k];
    h.configMap.THINKWORK_API_URL = "https://api.example";
    h.configMap.ANALYST_BROKER_SECRET_ARN = "arn:broker";
    h.configMap.WORKSPACE_BUCKET = "workspace-bucket";
    h.state.caller = { userId: "user-1", tenantId: "tenant-1" };
    h.state.adminError = null;
    h.state.validateError = null;
    h.state.clusters = [
      {
        clusterId: "thinkwork-dev-aurora",
        endpoint: "aurora.dev.rds.amazonaws.com",
        port: 5432,
      },
    ];
    h.state.adminCredential = { username: "master", password: "pw" };
    h.state.databases = ["sales", "thinkwork"];
    h.state.slugError = null;
    h.state.probeError = null;
    h.state.provisionError = null;
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

  it("maps an input validation failure to BAD_USER_INPUT before writes", async () => {
    h.state.validateError = new h.AnalystRegistrationInputError(
      'the "thinkwork" workspace database is registered through the built-in connector',
    );
    const resolver = await load();
    await expect(resolver(undefined, { input: INPUT }, ctx)).rejects.toThrow(
      /built-in connector/,
    );
    expect(h.calls).toEqual(["requireAdmin", "validate"]);
  });

  it("rejects an unknown cluster before provisioning", async () => {
    const resolver = await load();
    await expect(
      resolver(undefined, { input: { ...INPUT, clusterId: "nope" } }, ctx),
    ).rejects.toThrow(/was not found/);
    expect(h.calls).toEqual([
      "requireAdmin",
      "validate",
      "brokerSecret:arn:broker:tenant-1",
      "describe",
    ]);
  });

  it("rejects a database not present on the cluster", async () => {
    h.state.databases = ["other"];
    const resolver = await load();
    await expect(resolver(undefined, { input: INPUT }, ctx)).rejects.toThrow(
      /was not found on cluster/,
    );
    expect(h.calls).toEqual([
      "requireAdmin",
      "validate",
      "brokerSecret:arn:broker:tenant-1",
      "describe",
      "resolveAdmin",
      "enumerate",
    ]);
  });

  it("aborts on a read-only-posture failure after provisioning, before any write", async () => {
    h.state.probeError = new h.AnalystRegistrationPostureError(
      "the supplied credential holds non-SELECT privileges (orders:INSERT)",
    );
    const resolver = await load();
    await expect(resolver(undefined, { input: INPUT }, ctx)).rejects.toThrow(
      /non-SELECT/,
    );
    expect(h.calls).toEqual([
      "requireAdmin",
      "validate",
      "brokerSecret:arn:broker:tenant-1",
      "describe",
      "resolveAdmin",
      "enumerate",
      "assertSlug",
      "openAdmin",
      "provision:schema=public",
      "closeAdmin",
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
      "describe",
      "resolveAdmin",
      "enumerate",
      "assertSlug",
      "openAdmin",
      "provision:schema=public",
      "closeAdmin",
      "probe",
      "secret",
      "tenantSlug",
      "render",
      "s3",
      "row:kind=internal,cluster=thinkwork-dev-aurora,schema=public",
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
    // Fails before any cluster or write step.
    expect(h.calls).toEqual([
      "requireAdmin",
      "validate",
      "brokerSecret:arn:broker:tenant-1",
    ]);
  });

  it("fails fast when platform config is missing", async () => {
    delete h.configMap.WORKSPACE_BUCKET;
    const resolver = await load();
    await expect(resolver(undefined, { input: INPUT }, ctx)).rejects.toThrow(
      /WORKSPACE_BUCKET/,
    );
    expect(h.calls).toEqual(["requireAdmin", "validate"]);
  });

  it("THINK-283: passes the selected schema through to the provisioner", async () => {
    const resolver = await load();
    await resolver(undefined, { input: { ...INPUT, schema: "raw_jde" } }, ctx);
    expect(h.calls).toContain("provision:schema=raw_jde");
  });

  it("THINK-283: a schema validation failure in provisioning maps to BAD_USER_INPUT and stops the ceremony", async () => {
    h.state.provisionError = new h.AnalystRegistrationInputError(
      'schema "raw_jde" in database "sales" contains no eligible base tables',
    );
    const resolver = await load();
    const err = await resolver(
      undefined,
      { input: { ...INPUT, schema: "raw_jde" } },
      ctx,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GraphQLError);
    expect((err as GraphQLError).extensions.code).toBe("BAD_USER_INPUT");
    expect((err as GraphQLError).message).toMatch(/no eligible base tables/);
    // Admin connection closed; nothing written after the failure.
    expect(h.calls).toEqual([
      "requireAdmin",
      "validate",
      "brokerSecret:arn:broker:tenant-1",
      "describe",
      "resolveAdmin",
      "enumerate",
      "assertSlug",
      "openAdmin",
      "provision:schema=raw_jde",
      "closeAdmin",
    ]);
  });
});
