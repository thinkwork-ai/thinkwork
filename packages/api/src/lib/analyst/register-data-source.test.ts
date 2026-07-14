/**
 * Analyst multi-source registration core tests (THINK-239).
 *
 * Pure validation + the read-only-posture/introspection probe against a mock
 * client. No DB, S3, or Secrets Manager — those effects are exercised through
 * the resolver test with mocked lib deps.
 */

import { describe, expect, it } from "vitest";

import {
  AnalystRegistrationInputError,
  AnalystRegistrationPostureError,
  analystSourceCredentialSecretName,
  analystSourceRuntimeMetadata,
  externalSourceRowValues,
  externalSourceUrl,
  probeAndModelExternalSource,
  tlsFromInput,
  validateRegisterInput,
  type NormalizedRegisterInput,
  type RegisterProbeClient,
} from "./register-data-source.js";

const VALID = {
  name: "Sales Postgres",
  slug: "sales-pg",
  host: "sales.example.rds.amazonaws.com",
  port: 5432,
  database: "sales",
  dbUser: "analyst_ro",
  password: "s3cret",
  tls: "VERIFY_FULL" as const,
};

describe("validateRegisterInput (THINK-239)", () => {
  it("normalizes a valid input (omitted schema defaults to public — THINK-283)", () => {
    expect(validateRegisterInput(VALID)).toEqual({
      name: "Sales Postgres",
      slug: "sales-pg",
      host: "sales.example.rds.amazonaws.com",
      port: 5432,
      database: "sales",
      dbUser: "analyst_ro",
      password: "s3cret",
      tls: "verify-full",
      schema: "public",
    });
  });

  it("THINK-283: preserves an explicit schema's exact case; rejects empty/system values", () => {
    expect(validateRegisterInput({ ...VALID, schema: " Sales " }).schema).toBe(
      "Sales",
    );
    expect(() => validateRegisterInput({ ...VALID, schema: "  " })).toThrow(
      /non-empty/,
    );
    expect(() =>
      validateRegisterInput({ ...VALID, schema: "pg_catalog" }),
    ).toThrow(/system schema/);
  });

  it("maps tls REQUIRED and defaults to verify-full", () => {
    expect(tlsFromInput("REQUIRED")).toBe("required");
    expect(tlsFromInput(null)).toBe("verify-full");
    expect(validateRegisterInput({ ...VALID, tls: "REQUIRED" }).tls).toBe(
      "required",
    );
  });

  it("rejects a bad slug shape", () => {
    for (const slug of [
      "",
      "-lead",
      "A",
      "x",
      "has_underscore",
      "toolongxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    ]) {
      expect(() => validateRegisterInput({ ...VALID, slug })).toThrow(
        AnalystRegistrationInputError,
      );
    }
  });

  it("rejects the reserved builtin slug", () => {
    expect(() =>
      validateRegisterInput({ ...VALID, slug: "postgres-dev" }),
    ).toThrow(/reserved/);
  });

  it("rejects missing required fields and bad ports", () => {
    expect(() => validateRegisterInput({ ...VALID, host: " " })).toThrow(
      /host/,
    );
    expect(() => validateRegisterInput({ ...VALID, password: "" })).toThrow(
      /password/,
    );
    expect(() => validateRegisterInput({ ...VALID, port: 0 })).toThrow(/port/);
    expect(() => validateRegisterInput({ ...VALID, port: 70000 })).toThrow(
      /port/,
    );
  });
});

/**
 * Route the probe's five queries (schema existence, effective write, schema
 * CREATE, out-of-schema SELECT, base-table columns) against a fake catalog.
 */
interface FakeSource {
  schemas?: string[];
  effectiveWrite?: Record<string, unknown>[];
  schemaCreate?: Record<string, unknown>[];
  outOfSchema?: Record<string, unknown>[];
  columns?: Record<string, unknown>[];
}

function mockClient(source: FakeSource): RegisterProbeClient {
  return {
    query: async (text: string, params?: unknown[]) => {
      if (text.startsWith("SELECT 1 FROM pg_namespace")) {
        return {
          rows: (source.schemas ?? ["public"]).includes(String(params?.[0]))
            ? [{ ok: 1 }]
            : [],
        };
      }
      if (text.includes("'INSERT, UPDATE, DELETE, TRUNCATE'")) {
        return { rows: source.effectiveWrite ?? [] };
      }
      if (text.includes("has_schema_privilege")) {
        return { rows: source.schemaCreate ?? [] };
      }
      if (text.includes("has_table_privilege(c.oid, 'SELECT')")) {
        return { rows: source.outOfSchema ?? [] };
      }
      if (text.includes("information_schema.columns")) {
        return { rows: source.columns ?? [] };
      }
      return { rows: [] };
    },
    end: async () => {},
  };
}

const NORMALIZED: NormalizedRegisterInput = validateRegisterInput(VALID);

describe("probeAndModelExternalSource (THINK-239/283)", () => {
  it("rejects a credential holding effective write privileges (incl. inherited/PUBLIC)", async () => {
    const client = mockClient({
      effectiveWrite: [{ schema: "public", name: "orders" }],
    });
    await expect(
      probeAndModelExternalSource(NORMALIZED, {
        openClient: async () => client,
      }),
    ).rejects.toBeInstanceOf(AnalystRegistrationPostureError);
  });

  it("rejects schema-creation capability (read-only posture escape)", async () => {
    const client = mockClient({ schemaCreate: [{ schema: "public" }] });
    await expect(
      probeAndModelExternalSource(NORMALIZED, {
        openClient: async () => client,
      }),
    ).rejects.toThrow(/can CREATE/);
  });

  it("covers AE2: a missing selected schema names the schema in the error", async () => {
    const client = mockClient({ schemas: ["public"] });
    await expect(
      probeAndModelExternalSource(
        { ...NORMALIZED, schema: "sales" },
        { openClient: async () => client },
      ),
    ).rejects.toThrow(/schema "sales" does not exist/);
  });

  it("covers AE2: an empty/no-SELECT schema names the schema and fails", async () => {
    const client = mockClient({ schemas: ["public"], columns: [] });
    await expect(
      probeAndModelExternalSource(NORMALIZED, {
        openClient: async () => client,
      }),
    ).rejects.toThrow(/no base tables in schema "public"/);
  });

  it("rejects a credential that can read outside the selected schema", async () => {
    const client = mockClient({
      schemas: ["public", "sales"],
      outOfSchema: [{ schema: "platform", name: "mirror_batch", relkind: "r" }],
      columns: [{ table_name: "orders", column_name: "id", pg_type: "uuid" }],
    });
    await expect(
      probeAndModelExternalSource(
        { ...NORMALIZED, schema: "sales" },
        { openClient: async () => client },
      ),
    ).rejects.toThrow(/outside schema "sales"/);
  });

  it("rejects accessible views/matviews/foreign tables inside the selection", async () => {
    const client = mockClient({
      schemas: ["public"],
      outOfSchema: [{ schema: "public", name: "orders_view", relkind: "v" }],
      columns: [{ table_name: "orders", column_name: "id", pg_type: "uuid" }],
    });
    await expect(
      probeAndModelExternalSource(NORMALIZED, {
        openClient: async () => client,
      }),
    ).rejects.toThrow(/orders_view \(v\)/);
  });

  it("introspects a deterministic schema-qualified stored model on the happy path", async () => {
    const client = mockClient({
      schemas: ["public", "sales"],
      // columns query — deliberately out of order to prove sorting.
      columns: [
        { table_name: "orders", column_name: "total", pg_type: "numeric" },
        { table_name: "orders", column_name: "id", pg_type: "bigint" },
        { table_name: "customers", column_name: "id", pg_type: "uuid" },
        { table_name: "orders", column_name: "tags", pg_type: "text array" },
      ],
    });
    const model = await probeAndModelExternalSource(
      { ...NORMALIZED, schema: "sales" },
      { openClient: async () => client },
    );
    expect(model).toEqual({
      version: 2,
      tables: [
        {
          schema: "sales",
          name: "customers",
          columns: [{ name: "id", pgType: "uuid" }],
        },
        {
          schema: "sales",
          name: "orders",
          columns: [
            { name: "id", pgType: "bigint" },
            { name: "tags", pgType: "text array" },
            { name: "total", pgType: "numeric" },
          ],
        },
      ],
    });
  });
});

describe("registry row + metadata (THINK-239/283)", () => {
  it("builds the sourced URL and analyst_source metadata (claims minus slug)", () => {
    expect(externalSourceUrl("https://api.test/", "sales-pg")).toBe(
      "https://api.test/mcp/analyst/sales-pg",
    );
    const meta = analystSourceRuntimeMetadata(NORMALIZED, "arn:secret:sales", {
      kind: "external",
      sourceGeneration: "gen-1",
    });
    expect(meta).toEqual({
      host: "sales.example.rds.amazonaws.com",
      port: 5432,
      database: "sales",
      dbUser: "analyst_ro",
      tls: "verify-full",
      credentialSecretArn: "arn:secret:sales",
      tenantScoped: true,
      schema: "public",
      kind: "external",
      sourceGeneration: "gen-1",
    });
  });

  it("THINK-283: internal metadata carries clusterId and a fresh opaque generation", () => {
    const meta = analystSourceRuntimeMetadata(
      { ...NORMALIZED, schema: "raw_jde" },
      "arn:secret:wh",
      { kind: "internal", clusterId: "thinkwork-dev-aurora" },
    );
    expect(meta).toMatchObject({
      schema: "raw_jde",
      kind: "internal",
      clusterId: "thinkwork-dev-aurora",
    });
    expect(typeof meta.sourceGeneration).toBe("string");
    expect(meta.sourceGeneration.length).toBeGreaterThan(0);
    // Generations are opaque and unique per registration.
    const again = analystSourceRuntimeMetadata(
      { ...NORMALIZED, schema: "raw_jde" },
      "arn:secret:wh",
      { kind: "internal", clusterId: "thinkwork-dev-aurora" },
    );
    expect(again.sourceGeneration).not.toBe(meta.sourceGeneration);
  });

  it("builds a born-approved row with a pinned url_hash and source metadata", () => {
    const values = externalSourceRowValues({
      tenantId: "tenant-1",
      input: NORMALIZED,
      apiBase: "https://api.test",
      brokerSecretRef: "arn:broker",
      credentialSecretArn: "arn:secret:sales",
      source: { kind: "external" },
    });
    expect(values.status).toBe("approved");
    expect(values.auth_type).toBe("service_credential");
    expect(values.url).toBe("https://api.test/mcp/analyst/sales-pg");
    expect(typeof values.url_hash).toBe("string");
    expect(values.url_hash.length).toBeGreaterThan(0);
    const source = (
      values.runtime_metadata as {
        analyst_source: { host: string; schema: string; kind: string };
      }
    ).analyst_source;
    expect(source.host).toBe("sales.example.rds.amazonaws.com");
    expect(source.schema).toBe("public");
    expect(source.kind).toBe("external");
  });

  it("names the per-source credential secret under thinkwork/<stage>/analyst", () => {
    expect(
      analystSourceCredentialSecretName({
        stage: "dev",
        tenantId: "t1",
        slug: "sales-pg",
      }),
    ).toBe("thinkwork/dev/analyst/t1/sales-pg-reader-credential");
  });
});
