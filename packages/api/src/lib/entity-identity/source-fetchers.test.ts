/**
 * Postgres source-fetcher discovery (THINK-321 U7 hardening).
 *
 * The analyst broker inlines at most 200 result rows per query envelope, so
 * schema discovery MUST be scoped to the candidate tables for the requested
 * entity types — an unfiltered information_schema sweep on a real customer
 * database (TEI dispatch: ~2k rows) silently loses tables past the cap and
 * every plan "resolves to no granted table/columns".
 */

import { describe, expect, it } from "vitest";

import type { BrokerQueryEnvelope } from "./source-fetchers.js";
import {
  fetchPostgresSourceRecords,
  tableCandidatesForSlug,
} from "./source-fetchers.js";
import type { IdentityRule } from "./normalizers.js";

const nameRule: IdentityRule = {
  slug: "name",
  keyKind: "name",
  normalization: "name",
  unique: false,
  uniquenessScope: "tenant",
  sourcePrecedence: [],
  autoLink: true,
  version: 1,
};

function envelope(
  rows: Array<[string, string]>,
  truncated = false,
): BrokerQueryEnvelope {
  return {
    columns: [{ name: "table_name" }, { name: "column_name" }],
    rows,
    row_count: rows.length,
    truncated,
  };
}

function baseArgs(query: (sql: string) => Promise<BrokerQueryEnvelope>) {
  return {
    tenantId: "11111111-1111-1111-1111-111111111111",
    jobId: "job-1",
    sourceSystem: "lastmile",
    connectorSlug: "lastmile-data",
    entityTypeSlugs: ["customer", "ship_to"],
    rulesByType: new Map([
      ["customer", [nameRule]],
      ["ship_to", [nameRule]],
    ]),
    cursor: null,
    limit: 10,
    query,
  };
}

describe("fetchPostgresSourceRecords discovery", () => {
  it("scopes discovery to candidate tables so the broker inline cap cannot hide them", async () => {
    const seen: string[] = [];
    const result = await fetchPostgresSourceRecords(
      baseArgs(async (sql: string) => {
        seen.push(sql);
        if (sql.includes("information_schema")) {
          for (const candidate of [
            ...tableCandidatesForSlug("customer"),
            ...tableCandidatesForSlug("ship_to"),
          ]) {
            expect(sql).toContain(`'${candidate}'`);
          }
          return envelope([
            ["customer", "id"],
            ["customer", "name"],
            ["ship_to", "id"],
            ["ship_to", "name"],
          ]);
        }
        // Page fetches: return no rows so both types drain immediately.
        return envelope([]);
      }),
    );
    expect(seen[0]).toContain("table_name IN (");
    expect(
      (result.warnings ?? []).filter((w) => w.includes("no granted table")),
    ).toEqual([]);
  });

  it("surfaces a warning when even the scoped discovery is truncated", async () => {
    const result = await fetchPostgresSourceRecords(
      baseArgs(async (sql: string) => {
        if (sql.includes("information_schema")) {
          return envelope([["customer", "id"]], true);
        }
        return envelope([]);
      }),
    );
    expect(
      (result.warnings ?? []).some((w) => w.includes("discovery truncated")),
    ).toBe(true);
  });
});
