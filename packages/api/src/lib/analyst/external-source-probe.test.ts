/**
 * External analyst source probe — drift vs the stored model (THINK-239).
 *
 * The reconciler probes a registered source by reusing probeAnalystConnection
 * with a granted surface derived from the source's stored model.json (via
 * storedModelFromColumns). These tests exercise that exact reuse path: a
 * clean source verifies "ok"; a retyped or dropped column is reported as
 * schema_drift; a lingering write grant is reported as write_privilege.
 */

import { describe, expect, it } from "vitest";

import { storedModelFromColumns } from "@thinkwork/database-pg/analyst";

import {
  probeAnalystConnection,
  type AnalystTableDescriptor,
  type ProbePgClient,
} from "./connection-probe.js";

const STORED = storedModelFromColumns([
  { table: "orders", column: "id", pgType: "bigint" },
  { table: "orders", column: "total", pgType: "numeric" },
  { table: "customers", column: "id", pgType: "uuid" },
]);

const GRANTED: AnalystTableDescriptor[] = STORED.tables.map((t) => ({
  name: t.name,
  columns: t.columns.map((c) => ({ name: c.name, type: c.pgType })),
}));

interface LiveCol {
  table: string;
  column: string;
  dataType: string;
}

function probeClient(opts: {
  live: LiveCol[];
  writeGrants?: Array<{ table_name: string; privilege_type: string }>;
}): ProbePgClient {
  return {
    query: async (text: string, params?: unknown[]) => {
      if (/has_column_privilege/.test(text)) {
        const tbls = (params?.[1] as string[]) ?? [];
        const cols = (params?.[2] as string[]) ?? [];
        return {
          rows: tbls.map((t, i) => ({
            tbl: t,
            col: cols[i],
            table_exists: true,
            column_exists: true,
            can_select: true,
          })),
        };
      }
      if (/role_table_grants/.test(text)) {
        return { rows: opts.writeGrants ?? [] };
      }
      // information_schema.columns
      return {
        rows: opts.live.map((c) => ({
          table_name: c.table,
          column_name: c.column,
          data_type: c.dataType,
        })),
      };
    },
  };
}

const CLEAN_LIVE: LiveCol[] = [
  { table: "orders", column: "id", dataType: "bigint" },
  { table: "orders", column: "total", dataType: "numeric" },
  { table: "customers", column: "id", dataType: "uuid" },
];

describe("external analyst source probe (THINK-239)", () => {
  const deps = (client: ProbePgClient) => ({
    getClient: async () => client,
    grantedTables: GRANTED,
    role: "analyst_ro",
    now: () => new Date("2026-07-09T00:00:00Z"),
  });

  it("verifies ok when the live schema matches the stored model", async () => {
    const verdict = await probeAnalystConnection(
      deps(probeClient({ live: CLEAN_LIVE })),
    );
    expect(verdict.status).toBe("ok");
  });

  it("reports schema_drift when a stored column is retyped live", async () => {
    const drifted = CLEAN_LIVE.map((c) =>
      c.table === "orders" && c.column === "total"
        ? { ...c, dataType: "text" }
        : c,
    );
    const verdict = await probeAnalystConnection(
      deps(probeClient({ live: drifted })),
    );
    expect(verdict.status).toBe("fail");
    expect(verdict.reason).toBe("schema_drift");
    expect(verdict.detail).toContain("orders.total");
  });

  it("reports schema_drift when a stored column is missing live", async () => {
    const missing = CLEAN_LIVE.filter(
      (c) => !(c.table === "orders" && c.column === "total"),
    );
    const verdict = await probeAnalystConnection(
      deps(probeClient({ live: missing })),
    );
    expect(verdict.status).toBe("fail");
    expect(verdict.reason).toBe("schema_drift");
  });

  it("reports write_privilege when the source role holds a non-SELECT grant", async () => {
    const verdict = await probeAnalystConnection(
      deps(
        probeClient({
          live: CLEAN_LIVE,
          writeGrants: [{ table_name: "orders", privilege_type: "UPDATE" }],
        }),
      ),
    );
    expect(verdict.status).toBe("fail");
    expect(verdict.reason).toBe("write_privilege");
  });

  it("reports unreachable when the connect throws", async () => {
    const verdict = await probeAnalystConnection({
      getClient: async () => {
        throw new Error("ECONNREFUSED");
      },
      grantedTables: GRANTED,
      role: "analyst_ro",
      now: () => new Date("2026-07-09T00:00:00Z"),
    });
    expect(verdict.status).toBe("fail");
    expect(verdict.reason).toBe("unreachable");
  });
});
