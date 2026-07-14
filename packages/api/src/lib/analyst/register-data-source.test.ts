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
  it("normalizes a valid input", () => {
    expect(validateRegisterInput(VALID)).toEqual({
      name: "Sales Postgres",
      slug: "sales-pg",
      host: "sales.example.rds.amazonaws.com",
      port: 5432,
      database: "sales",
      dbUser: "analyst_ro",
      password: "s3cret",
      tls: "verify-full",
    });
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

function mockClient(
  handlers: (sql: string) => Record<string, unknown>[],
): RegisterProbeClient {
  return {
    query: async (text: string) => ({ rows: handlers(text) }),
    end: async () => {},
  };
}

const NORMALIZED: NormalizedRegisterInput = validateRegisterInput(VALID);

describe("probeAndModelExternalSource (THINK-239)", () => {
  it("rejects a credential holding non-SELECT privileges", async () => {
    const client = mockClient((sql) =>
      /role_table_grants/.test(sql)
        ? [{ table_name: "orders", privilege_type: "INSERT" }]
        : [],
    );
    await expect(
      probeAndModelExternalSource(NORMALIZED, {
        openClient: async () => client,
      }),
    ).rejects.toBeInstanceOf(AnalystRegistrationPostureError);
  });

  it("rejects when the credential sees no tables", async () => {
    const client = mockClient(() => []); // no write grants, no columns
    await expect(
      probeAndModelExternalSource(NORMALIZED, {
        openClient: async () => client,
      }),
    ).rejects.toThrow(/no tables/);
  });

  it("introspects a deterministic stored model on the happy path", async () => {
    const client = mockClient((sql) => {
      if (/role_table_grants/.test(sql)) return [];
      // columns query — deliberately out of order to prove sorting.
      return [
        { table_name: "orders", column_name: "total", pg_type: "numeric" },
        { table_name: "orders", column_name: "id", pg_type: "bigint" },
        { table_name: "customers", column_name: "id", pg_type: "uuid" },
        { table_name: "orders", column_name: "tags", pg_type: "text array" },
      ];
    });
    const model = await probeAndModelExternalSource(NORMALIZED, {
      openClient: async () => client,
    });
    expect(model).toEqual({
      // THINK-283: writers emit model v2 with schema on every table; the
      // pre-schema-scoping probe surface is public.
      version: 2,
      tables: [
        {
          schema: "public",
          name: "customers",
          columns: [{ name: "id", pgType: "uuid" }],
        },
        {
          schema: "public",
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

describe("registry row + metadata (THINK-239)", () => {
  it("builds the sourced URL and analyst_source metadata (claims minus slug)", () => {
    expect(externalSourceUrl("https://api.test/", "sales-pg")).toBe(
      "https://api.test/mcp/analyst/sales-pg",
    );
    expect(
      analystSourceRuntimeMetadata(NORMALIZED, "arn:secret:sales"),
    ).toEqual({
      host: "sales.example.rds.amazonaws.com",
      port: 5432,
      database: "sales",
      dbUser: "analyst_ro",
      tls: "verify-full",
      credentialSecretArn: "arn:secret:sales",
      tenantScoped: true,
    });
  });

  it("builds a born-approved row with a pinned url_hash and source metadata", () => {
    const values = externalSourceRowValues({
      tenantId: "tenant-1",
      input: NORMALIZED,
      apiBase: "https://api.test",
      brokerSecretRef: "arn:broker",
      credentialSecretArn: "arn:secret:sales",
    });
    expect(values.status).toBe("approved");
    expect(values.auth_type).toBe("service_credential");
    expect(values.url).toBe("https://api.test/mcp/analyst/sales-pg");
    expect(typeof values.url_hash).toBe("string");
    expect(values.url_hash.length).toBeGreaterThan(0);
    expect(
      (values.runtime_metadata as { analyst_source: { host: string } })
        .analyst_source.host,
    ).toBe("sales.example.rds.amazonaws.com");
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
