/**
 * Stored analyst model contract tests (THINK-283 U1).
 *
 * Characterizes the legacy v1 artifact behavior (schema-less tables read as
 * `public`) and pins the v2 contract: schema-qualified table identity,
 * SQL-safe qualified rendering, and fail-closed normalization of malformed
 * artifacts. Legacy v1 model.json files persist in S3 — the v1 fixtures here
 * are wire-format regression guards, not conveniences.
 */

import { describe, expect, it } from "vitest";

import {
  ANALYST_DEFAULT_SOURCE_SCHEMA,
  normalizeStoredAnalystModel,
  qualifiedPgTableRef,
  quotePgIdentifier,
  renderStoredAnalystSchemaMarkdown,
  storedModelFromColumns,
  storedTableDescriptor,
  type StoredAnalystModelV1,
} from "../src/analyst/semantic-model";

/** Verbatim shape of a pre-THINK-283 model.json artifact. */
const V1_ARTIFACT: StoredAnalystModelV1 = {
  version: 1,
  tables: [
    {
      name: "orders",
      columns: [
        { name: "id", pgType: "uuid" },
        { name: "total", pgType: "numeric" },
      ],
    },
  ],
};

describe("normalizeStoredAnalystModel (THINK-283)", () => {
  it("characterization: a v1 artifact normalizes to public without changing column metadata", () => {
    const normalized = normalizeStoredAnalystModel(V1_ARTIFACT);
    expect(normalized).toEqual({
      version: 2,
      tables: [
        {
          schema: "public",
          name: "orders",
          columns: [
            { name: "id", pgType: "uuid" },
            { name: "total", pgType: "numeric" },
          ],
        },
      ],
    });
  });

  it("a v2 artifact passes through with its raw schema identity intact", () => {
    const v2 = {
      version: 2,
      tables: [
        {
          schema: "raw_jde",
          name: "orders",
          columns: [{ name: "id", pgType: "uuid" }],
        },
      ],
    };
    expect(normalizeStoredAnalystModel(v2)).toEqual(v2);
  });

  it("mixed-case/punctuation catalog identity is preserved verbatim in JSON", () => {
    const v2 = {
      version: 2,
      tables: [
        {
          schema: "RawJde",
          name: "Order Items",
          columns: [{ name: "id", pgType: "uuid" }],
        },
      ],
    };
    expect(normalizeStoredAnalystModel(v2).tables[0]).toMatchObject({
      schema: "RawJde",
      name: "Order Items",
    });
  });

  it("malformed artifacts throw rather than being trusted", () => {
    expect(() => normalizeStoredAnalystModel(null)).toThrow(/not an object/);
    expect(() =>
      normalizeStoredAnalystModel({ version: 3, tables: [] }),
    ).toThrow(/unsupported version/);
    expect(() =>
      normalizeStoredAnalystModel({ version: 2, tables: "nope" }),
    ).toThrow(/not an array/);
    // Empty schema identifier on a v2 table is corrupt, not defaultable.
    expect(() =>
      normalizeStoredAnalystModel({
        version: 2,
        tables: [{ schema: "", name: "orders", columns: [] }],
      }),
    ).toThrow(/invalid schema/);
    // A v2 table missing schema entirely is corrupt too — only v1 defaults.
    expect(() =>
      normalizeStoredAnalystModel({
        version: 2,
        tables: [{ name: "orders", columns: [] }],
      }),
    ).toThrow(/invalid schema/);
    expect(() =>
      normalizeStoredAnalystModel({
        version: 1,
        tables: [{ name: "orders", columns: [{ name: 7, pgType: "uuid" }] }],
      }),
    ).toThrow(/malformed/);
  });
});

describe("storedModelFromColumns (THINK-283)", () => {
  it("emits v2 with per-table schema, deterministically sorted", () => {
    const model = storedModelFromColumns([
      { schema: "raw_jde", table: "orders", column: "id", pgType: "uuid" },
      {
        schema: "raw_jde",
        table: "orders",
        column: "total",
        pgType: "numeric",
      },
      { schema: "raw_jde", table: "customers", column: "id", pgType: "uuid" },
    ]);
    expect(model.version).toBe(2);
    expect(model.tables.map(storedTableDescriptor)).toEqual([
      "raw_jde.customers",
      "raw_jde.orders",
    ]);
  });

  it("rows without a schema default to public (pre-THINK-283 callers)", () => {
    const model = storedModelFromColumns([
      { table: "orders", column: "id", pgType: "uuid" },
    ]);
    expect(model.tables[0]!.schema).toBe(ANALYST_DEFAULT_SOURCE_SCHEMA);
  });

  it("same-named tables in different schemas stay distinct", () => {
    const model = storedModelFromColumns([
      { schema: "public", table: "orders", column: "id", pgType: "uuid" },
      { schema: "raw_jde", table: "orders", column: "id", pgType: "uuid" },
    ]);
    expect(model.tables).toHaveLength(2);
    const descriptors = model.tables.map(storedTableDescriptor);
    expect(descriptors).toEqual(["public.orders", "raw_jde.orders"]);
    expect(new Set(descriptors).size).toBe(2);
  });
});

describe("PostgreSQL identifier quoting (THINK-283)", () => {
  it("bare lowercase identifiers render unquoted", () => {
    expect(qualifiedPgTableRef("raw_jde", "orders")).toBe("raw_jde.orders");
  });

  it("mixed-case and punctuation-bearing identifiers are quoted, never folded", () => {
    expect(quotePgIdentifier("RawJde")).toBe('"RawJde"');
    expect(quotePgIdentifier("order items")).toBe('"order items"');
    expect(quotePgIdentifier("1st")).toBe('"1st"');
    expect(qualifiedPgTableRef("RawJde", "Order Items")).toBe(
      '"RawJde"."Order Items"',
    );
  });

  it("embedded double quotes are doubled — quoting cannot be escaped", () => {
    expect(quotePgIdentifier('evil"name')).toBe('"evil""name"');
  });
});

describe("renderStoredAnalystSchemaMarkdown (THINK-283)", () => {
  it("renders schema-qualified table references for v2 models", () => {
    const markdown = renderStoredAnalystSchemaMarkdown(
      storedModelFromColumns([
        { schema: "raw_jde", table: "orders", column: "id", pgType: "uuid" },
      ]),
      { sourceName: "thinkwork_warehouse" },
    );
    expect(markdown).toContain("## raw_jde.orders");
    expect(markdown).toContain("| id | uuid |");
    expect(markdown).not.toContain("## orders\n");
  });

  it("characterization: a v1 artifact renders as public.<table> without changing column rows", () => {
    const markdown = renderStoredAnalystSchemaMarkdown(V1_ARTIFACT, {
      sourceName: "sales",
    });
    expect(markdown).toContain("## public.orders");
    expect(markdown).toContain("| total | numeric |");
  });

  it("quoted identifiers render SQL-copyable, not lowercased or split", () => {
    const markdown = renderStoredAnalystSchemaMarkdown(
      {
        version: 2,
        tables: [
          {
            schema: "RawJde",
            name: "Order Items",
            columns: [{ name: "id", pgType: "uuid" }],
          },
        ],
      },
      { sourceName: "warehouse" },
    );
    expect(markdown).toContain('## "RawJde"."Order Items"');
    expect(markdown).not.toContain("rawjde");
  });
});
