/**
 * Analyst query gate — tenant row-scope GUC (THINK-234).
 *
 * Two layers:
 *   - Always-on mock-client tests: tenantId validation fails closed BEFORE
 *     any statement runs, and the set_config for the tenant GUC is issued
 *     PARAMETERIZED immediately after DISCARD ALL (call-order assertion on a
 *     fake client — the Cursor path throws a sentinel to stop the pipeline
 *     before it needs a real connection).
 *   - Real-Postgres tests, gated on ANALYST_BROKER_TEST_DATABASE_URL (same
 *     harness as analyst-query-broker.test.ts):
 *       docker run --rm -e POSTGRES_PASSWORD=analyst -e POSTGRES_DB=analyst_test \
 *         -p 5439:5432 postgres:14
 *       ANALYST_BROKER_TEST_DATABASE_URL=postgres://postgres:analyst@127.0.0.1:5439/analyst_test
 */

import type { Client as PgClientType } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { gateAndExecute } from "../analyst-query-gate.js";

const TEST_DB_URL = process.env.ANALYST_BROKER_TEST_DATABASE_URL;
const TENANT_A = "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb";

// ---------------------------------------------------------------------------
// Mock-client tests (no DB): validation + call order
// ---------------------------------------------------------------------------

const CURSOR_SENTINEL = new Error("__cursor_reached__");

interface RecordedQuery {
  text: string;
  values?: unknown[];
}

/**
 * Fake pg Client that records string queries in order and throws a sentinel
 * the moment gateAndExecute reaches the (unmockable) Cursor path — i.e.
 * after DISCARD ALL and the set_config. Lets us assert the pre-cursor call
 * order without a real connection.
 */
function makeRecordingClient(): {
  client: PgClientType;
  calls: RecordedQuery[];
} {
  const calls: RecordedQuery[] = [];
  const client = {
    query(arg: unknown, values?: unknown[]) {
      if (typeof arg === "string") {
        calls.push({ text: arg, values });
        return Promise.resolve({ rows: [] });
      }
      // Cursor object — stop here; the DB pipeline is out of scope for this test.
      throw CURSOR_SENTINEL;
    },
  } as unknown as PgClientType;
  return { client, calls };
}

describe("analyst gate — tenant GUC (mock client, always-on)", () => {
  it("sets the tenant GUC via set_config($1) immediately after DISCARD ALL", async () => {
    const { client, calls } = makeRecordingClient();
    await expect(
      gateAndExecute(client, "SELECT 1", { tenantId: TENANT_A }),
    ).rejects.toBe(CURSOR_SENTINEL);

    expect(calls).toHaveLength(2);
    expect(calls[0]!.text).toBe("DISCARD ALL");
    expect(calls[1]!.text).toBe(
      "SELECT set_config('thinkwork.analyst_tenant', $1, false)",
    );
    // Parameterized — the tenant is bound, never interpolated into the text.
    expect(calls[1]!.values).toEqual([TENANT_A]);
  });

  it("rejects a missing tenantId BEFORE any query runs (fail closed)", async () => {
    const { client, calls } = makeRecordingClient();
    await expect(
      gateAndExecute(client, "SELECT 1", {
        tenantId: undefined as unknown as string,
      }),
    ).rejects.toThrow(/valid UUID tenantId/);
    expect(calls).toHaveLength(0);
  });

  it("rejects an empty tenantId BEFORE any query runs", async () => {
    const { client, calls } = makeRecordingClient();
    await expect(
      gateAndExecute(client, "SELECT 1", { tenantId: "" }),
    ).rejects.toThrow(/valid UUID tenantId/);
    expect(calls).toHaveLength(0);
  });

  it("rejects a non-UUID tenantId carrying a SQL quote (no interpolation reaches the DB)", async () => {
    const { client, calls } = makeRecordingClient();
    await expect(
      gateAndExecute(client, "SELECT 1", {
        tenantId: "'; SELECT 1 --",
      }),
    ).rejects.toThrow(/valid UUID tenantId/);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Real-Postgres tests (env-gated): the GUC actually lands in the session
// ---------------------------------------------------------------------------

describe.skipIf(!TEST_DB_URL)(
  "analyst gate — tenant GUC (real Postgres)",
  () => {
    let client: PgClientType;

    beforeAll(async () => {
      const { Client } = await import("pg");
      client = new Client({ connectionString: TEST_DB_URL });
      await client.connect();
    });

    afterAll(async () => {
      await client.end();
    });

    it("sets thinkwork.analyst_tenant to the passed tenant within the same session", async () => {
      const result = await gateAndExecute(
        client,
        "SELECT current_setting('thinkwork.analyst_tenant', true) AS t",
        { tenantId: TENANT_A },
      );
      expect(result.rows).toEqual([[TENANT_A]]);
    });

    it("re-sets (overwrites) the GUC on a subsequent call with a different tenant", async () => {
      // DISCARD ALL wipes it each call, so the value must be re-established from
      // the new tenant — never a stale carry-over.
      const first = await gateAndExecute(
        client,
        "SELECT current_setting('thinkwork.analyst_tenant', true) AS t",
        { tenantId: TENANT_A },
      );
      expect(first.rows).toEqual([[TENANT_A]]);

      const second = await gateAndExecute(
        client,
        "SELECT current_setting('thinkwork.analyst_tenant', true) AS t",
        { tenantId: TENANT_B },
      );
      expect(second.rows).toEqual([[TENANT_B]]);
    });
  },
);
