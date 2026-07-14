/**
 * Admin REST analyst data-source projection tests (THINK-283 U6).
 *
 * The list/detail surfaces read `dataSource` off each tenant MCP server row:
 * schema and durable refresh state must project for sourced rows, legacy
 * metadata must read as `public` with host-inferred kind, and built-in /
 * non-analyst rows must keep their existing shape.
 */

import { describe, expect, it } from "vitest";

import { analystDataSourceForRow } from "./skills.js";

const HOST_INTERNAL = `thinkwork-${process.env.STAGE || "dev"}-db.cluster-x.us-east-1.rds.amazonaws.com`;

function sourcedRow(source: Record<string, unknown>, extraMeta = {}) {
  return {
    slug: "warehouse",
    runtime_metadata: { analyst_source: source, ...extraMeta },
  };
}

describe("analystDataSourceForRow (THINK-283)", () => {
  it("projects schema, stored kind, and refresh state for a sourced row", () => {
    const projected = analystDataSourceForRow(
      sourcedRow(
        {
          host: "external.example.com",
          database: "warehouse",
          schema: "raw_jde",
          kind: "internal", // stored kind WINS over host inference
        },
        {
          analyst_refresh: {
            status: "failed",
            detail: 'refresh failed at step "artifacts" — retry the refresh',
            updatedAt: "2026-07-13T12:00:00.000Z",
          },
        },
      ),
    );
    expect(projected).toEqual({
      kind: "internal",
      host: "external.example.com",
      database: "warehouse",
      schema: "raw_jde",
      refresh: {
        status: "failed",
        detail: 'refresh failed at step "artifacts" — retry the refresh',
        updatedAt: "2026-07-13T12:00:00.000Z",
      },
    });
  });

  it("legacy metadata projects public + host-inferred kind + null refresh", () => {
    const internal = analystDataSourceForRow(
      sourcedRow({ host: HOST_INTERNAL, database: "sales" }),
    );
    expect(internal).toMatchObject({
      kind: "internal",
      schema: "public",
      refresh: null,
    });
    const external = analystDataSourceForRow(
      sourcedRow({ host: "db.example.com", database: "sales" }),
    );
    expect(external).toMatchObject({ kind: "external", schema: "public" });
  });

  it("built-in and non-analyst rows keep their existing shape", () => {
    expect(
      analystDataSourceForRow({ slug: "postgres-dev", runtime_metadata: {} }),
    ).toEqual({
      kind: "internal",
      host: null,
      database: "thinkwork",
      schema: "public",
      refresh: null,
    });
    expect(
      analystDataSourceForRow({ slug: "github", runtime_metadata: {} }),
    ).toBeNull();
  });
});
