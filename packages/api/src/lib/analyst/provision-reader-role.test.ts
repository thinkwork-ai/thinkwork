/**
 * provisionReaderRole tests (THINK-239, schema-scoped by THINK-283) — the
 * runbook posture applied programmatically. Asserts the schema-first
 * validation order, the create-vs-rotate branch, exact hardening statements,
 * per-current-table SELECT grants (never ALL TABLES, never default
 * privileges), the legacy default-ACL repair, out-of-selection revokes,
 * effective-surface verification, and identifier safety.
 */

import { describe, expect, it, vi } from "vitest";

import {
  assertSafeIdentifier,
  assertSelectableSchemaName,
  generateReaderPassword,
  isSystemPgSchema,
  provisionReaderRole,
  readerRoleName,
  type ProvisionClient,
} from "./provision-reader-role.js";

interface FakeDb {
  /** Schemas present in pg_namespace (user + selected). */
  schemas: string[];
  /** Base tables per schema (relkind r/p only — views never appear here). */
  tables: Record<string, string[]>;
  roleExists: boolean;
  /** Rows returned by the unexpected-SELECT verification query. */
  unexpectedSelect?: Record<string, unknown>[];
  /** Rows returned by the effective-write verification query. */
  effectiveWrite?: Record<string, unknown>[];
  /** Rows returned by the schema-CREATE verification query. */
  schemaCreate?: Record<string, unknown>[];
}

function fakeClient(db: FakeDb) {
  const queries: { text: string; params?: unknown[] }[] = [];
  const client: ProvisionClient = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      queries.push({ text, params });
      if (text.startsWith("SELECT 1 FROM pg_namespace")) {
        return {
          rows: db.schemas.includes(String(params?.[0])) ? [{ ok: 1 }] : [],
        };
      }
      // Privilege-verification matchers FIRST — their SQL also contains the
      // catalog fragments the discovery matchers key on.
      if (text.includes("has_table_privilege($1, c.oid, 'SELECT')")) {
        return { rows: db.unexpectedSelect ?? [] };
      }
      if (text.includes("'INSERT, UPDATE, DELETE, TRUNCATE'")) {
        return { rows: db.effectiveWrite ?? [] };
      }
      if (text.includes("has_schema_privilege")) {
        return { rows: db.schemaCreate ?? [] };
      }
      if (
        text.includes("c.relkind IN ('r', 'p')") &&
        text.includes("relname AS name")
      ) {
        const tables = db.tables[String(params?.[0])] ?? [];
        return { rows: tables.map((name) => ({ name })) };
      }
      if (text.startsWith("SELECT 1 FROM pg_roles")) {
        return { rows: db.roleExists ? [{ "?column?": 1 }] : [] };
      }
      if (
        text.includes("FROM pg_namespace n") &&
        text.includes("n.nspname <> $1")
      ) {
        return {
          rows: db.schemas
            .filter((s) => s !== String(params?.[0]))
            .map((name) => ({ name })),
        };
      }
      return { rows: [] };
    }),
  };
  return { client, queries };
}

const WAREHOUSE: FakeDb = {
  schemas: ["public", "raw_jde", "platform"],
  tables: {
    public: [],
    raw_jde: ["orders"],
    platform: ["mirror_batch"],
  },
  roleExists: false,
};

describe("readerRoleName", () => {
  it("underscores hyphens and truncates to 63 chars", () => {
    expect(readerRoleName("sales-pg")).toBe("sales_pg_reader");
    const long = "a".repeat(80);
    expect(readerRoleName(long).length).toBe(63);
  });
});

describe("generateReaderPassword", () => {
  it("produces a 32+ char base64url secret with no quote chars", () => {
    const pw = generateReaderPassword();
    expect(pw.length).toBeGreaterThanOrEqual(32);
    expect(pw).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("assertSafeIdentifier", () => {
  it("rejects anything outside ^[a-z0-9_]+$", () => {
    expect(() => assertSafeIdentifier("ok_name1", "role")).not.toThrow();
    expect(() => assertSafeIdentifier("Bad-Name", "role")).toThrow(
      /not a safe SQL identifier/,
    );
    expect(() => assertSafeIdentifier('x"; DROP', "database")).toThrow();
  });
});

describe("schema name gates (THINK-283)", () => {
  it("isSystemPgSchema covers pg_* and information_schema", () => {
    expect(isSystemPgSchema("pg_catalog")).toBe(true);
    expect(isSystemPgSchema("pg_toast")).toBe(true);
    expect(isSystemPgSchema("pg_temp_3")).toBe(true);
    expect(isSystemPgSchema("information_schema")).toBe(true);
    expect(isSystemPgSchema("public")).toBe(false);
    expect(isSystemPgSchema("raw_jde")).toBe(false);
  });

  it("assertSelectableSchemaName rejects empty, NUL, and system schemas", () => {
    expect(() => assertSelectableSchemaName("raw_jde")).not.toThrow();
    expect(() => assertSelectableSchemaName("")).toThrow(/empty or contains/);
    expect(() => assertSelectableSchemaName("bad\0name")).toThrow(
      /empty or contains/,
    );
    expect(() => assertSelectableSchemaName("pg_catalog")).toThrow(
      /system schema/,
    );
  });
});

describe("provisionReaderRole (THINK-283 schema-scoped)", () => {
  it("covers AE1: provisions raw_jde with per-table grants and no platform access", async () => {
    const { client, queries } = fakeClient({ ...WAREHOUSE });
    const surface = await provisionReaderRole({
      client,
      database: "thinkwork_warehouse",
      roleName: "warehouse_reader",
      password: "pw-Abc_123",
      schema: "raw_jde",
    });
    expect(surface.grantedTables).toEqual(["orders"]);
    const texts = queries.map((q) => q.text);

    // Role creation with pinned attributes.
    const create = texts.find((t) => t.startsWith("CREATE ROLE"))!;
    expect(create).toContain('CREATE ROLE "warehouse_reader" WITH LOGIN');
    expect(create).toContain(
      "NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION",
    );

    // search_path narrows to the selected schema, not public.
    expect(texts).toContain(
      'ALTER ROLE "warehouse_reader" SET search_path = raw_jde',
    );

    // Grants: CONNECT + selected-schema USAGE + per-CURRENT-table SELECT.
    expect(texts).toContain(
      'GRANT CONNECT ON DATABASE "thinkwork_warehouse" TO "warehouse_reader"',
    );
    expect(texts).toContain(
      'GRANT USAGE ON SCHEMA raw_jde TO "warehouse_reader"',
    );
    expect(texts).toContain(
      'GRANT SELECT ON raw_jde.orders TO "warehouse_reader"',
    );

    // Covers AE3: NO bulk grant and NO future-object grant anywhere.
    expect(
      texts.some((t) => t.startsWith("GRANT") && t.includes("ON ALL TABLES")),
    ).toBe(false);
    expect(
      texts.some(
        (t) => t.includes("ALTER DEFAULT PRIVILEGES") && t.includes("GRANT"),
      ),
    ).toBe(false);

    // Legacy default-ACL repair runs on every provisioning.
    expect(texts).toContain(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM "warehouse_reader"',
    );

    // Out-of-selection revokes hit the OTHER user schemas only.
    expect(texts).toContain(
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA platform FROM "warehouse_reader"',
    );
    expect(texts).toContain(
      'REVOKE ALL ON SCHEMA platform FROM "warehouse_reader"',
    );
    expect(texts).toContain(
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM "warehouse_reader"',
    );
    // PUBLIC-wide statements stay limited to the CREATE/TEMP hardening.
    expect(
      texts
        .filter((t) => t.endsWith("FROM PUBLIC"))
        .every(
          (t) =>
            t === "REVOKE CREATE ON SCHEMA public FROM PUBLIC" ||
            t.startsWith("REVOKE TEMP ON DATABASE"),
        ),
    ).toBe(true);
  });

  it("fails BEFORE any role mutation when the schema is missing", async () => {
    const { client, queries } = fakeClient({ ...WAREHOUSE });
    await expect(
      provisionReaderRole({
        client,
        database: "thinkwork_warehouse",
        roleName: "warehouse_reader",
        password: "pw",
        schema: "nope",
      }),
    ).rejects.toThrow(/schema "nope" does not exist/);
    expect(queries.every((q) => q.text.startsWith("SELECT"))).toBe(true);
  });

  it("covers AE2: an empty selected schema fails with the schema named and no writes", async () => {
    const { client, queries } = fakeClient({ ...WAREHOUSE });
    await expect(
      provisionReaderRole({
        client,
        database: "thinkwork_warehouse",
        roleName: "warehouse_reader",
        password: "pw",
        schema: "public",
      }),
    ).rejects.toThrow(/schema "public" .* no eligible base tables/);
    expect(queries.every((q) => q.text.startsWith("SELECT"))).toBe(true);
  });

  it("quotes mixed-case/punctuation schema and table names as single identifiers", async () => {
    const { client, queries } = fakeClient({
      schemas: ["public", "RawJde"],
      tables: { public: [], RawJde: ["Order Items"] },
      roleExists: false,
    });
    await provisionReaderRole({
      client,
      database: "warehouse",
      roleName: "warehouse_reader",
      password: "pw",
      schema: "RawJde",
    });
    const texts = queries.map((q) => q.text);
    expect(texts).toContain(
      'ALTER ROLE "warehouse_reader" SET search_path = "RawJde"',
    );
    expect(texts).toContain(
      'GRANT SELECT ON "RawJde"."Order Items" TO "warehouse_reader"',
    );
    // The raw names never appear unquoted in ACL statements.
    expect(
      texts.some((t) => t.startsWith("GRANT") && t.includes("RawJde.Order")),
    ).toBe(false);
  });

  it("rotates the password (no attribute re-set) when the role already exists", async () => {
    const { client, queries } = fakeClient({ ...WAREHOUSE, roleExists: true });
    await provisionReaderRole({
      client,
      database: "thinkwork_warehouse",
      roleName: "warehouse_reader",
      password: "new-Pw_9",
      schema: "raw_jde",
    });
    const texts = queries.map((q) => q.text);
    expect(texts.some((t) => t.startsWith("CREATE ROLE"))).toBe(false);
    expect(texts).toContain(
      `ALTER ROLE "warehouse_reader" WITH PASSWORD 'new-Pw_9'`,
    );
    // Grants are still re-applied on the retry path.
    expect(texts).toContain(
      'GRANT SELECT ON raw_jde.orders TO "warehouse_reader"',
    );
  });

  it("fails on residual effective SELECT outside the selection (inherited/PUBLIC grants)", async () => {
    const { client } = fakeClient({
      ...WAREHOUSE,
      unexpectedSelect: [
        { schema: "platform", name: "mirror_batch", relkind: "r" },
      ],
    });
    await expect(
      provisionReaderRole({
        client,
        database: "thinkwork_warehouse",
        roleName: "warehouse_reader",
        password: "pw",
        schema: "raw_jde",
      }),
    ).rejects.toThrow(/platform\.mirror_batch/);
  });

  it("fails when a selected-schema VIEW is effectively readable (unsupported surface)", async () => {
    const { client } = fakeClient({
      ...WAREHOUSE,
      unexpectedSelect: [
        { schema: "raw_jde", name: "orders_view", relkind: "v" },
      ],
    });
    await expect(
      provisionReaderRole({
        client,
        database: "thinkwork_warehouse",
        roleName: "warehouse_reader",
        password: "pw",
        schema: "raw_jde",
      }),
    ).rejects.toThrow(/orders_view \(v\)/);
  });

  it("fails on effective write privileges or schema-creation rights", async () => {
    const writable = fakeClient({
      ...WAREHOUSE,
      effectiveWrite: [{ schema: "raw_jde", name: "orders" }],
    });
    await expect(
      provisionReaderRole({
        client: writable.client,
        database: "thinkwork_warehouse",
        roleName: "warehouse_reader",
        password: "pw",
        schema: "raw_jde",
      }),
    ).rejects.toThrow(/effective write privileges/);

    const creatable = fakeClient({
      ...WAREHOUSE,
      schemaCreate: [{ schema: "raw_jde" }],
    });
    await expect(
      provisionReaderRole({
        client: creatable.client,
        database: "thinkwork_warehouse",
        roleName: "warehouse_reader",
        password: "pw",
        schema: "raw_jde",
      }),
    ).rejects.toThrow(/can CREATE in schema/);
  });

  it("refuses an unsafe database identifier before any statement", async () => {
    const { client, queries } = fakeClient({ ...WAREHOUSE });
    await expect(
      provisionReaderRole({
        client,
        database: 'sales"; DROP DATABASE x; --',
        roleName: "sales_pg_reader",
        password: "pw_123456789012345678901234567890",
        schema: "public",
      }),
    ).rejects.toThrow(/not a safe SQL identifier/);
    expect(queries.length).toBe(0);
  });

  it("refuses a system schema before any statement", async () => {
    const { client, queries } = fakeClient({ ...WAREHOUSE });
    await expect(
      provisionReaderRole({
        client,
        database: "warehouse",
        roleName: "warehouse_reader",
        password: "pw",
        schema: "pg_catalog",
      }),
    ).rejects.toThrow(/system schema/);
    expect(queries.length).toBe(0);
  });
});
