/**
 * Analyst connection probe tests (THINK-229 U5).
 *
 * The pg client is faked (query responses keyed by SQL shape) — no real DB.
 * The granted manifest is injected small so the drift/privilege assertions
 * are legible. Covers the plan's scenarios: healthy → ok; revoked SELECT →
 * fail naming the table; unexpected write privilege → fail; schema drift →
 * fail with drift detail; connect failure → fail reason "unreachable".
 */

import { describe, expect, it } from "vitest";

import {
  evaluateAnalystProbeGate,
  probeAnalystConnection,
  PROBE_STALE_AFTER_MS,
  type AnalystTableDescriptor,
  type ProbePgClient,
} from "./connection-probe.js";

const GRANTED: AnalystTableDescriptor[] = [
  {
    name: "threads",
    columns: [
      { name: "id", type: "uuid" },
      { name: "tenant_id", type: "uuid" },
      { name: "title", type: "text" },
      { name: "created_at", type: "timestamp with time zone" },
    ],
  },
  {
    name: "messages",
    columns: [
      { name: "id", type: "uuid" },
      { name: "body", type: "text" },
      { name: "token_count", type: "integer" },
    ],
  },
];

/** Live column rows a healthy DB returns for the granted surface. */
function healthyColumns(): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const table of GRANTED) {
    for (const column of table.columns) {
      rows.push({
        table_name: table.name,
        column_name: column.name,
        // information_schema spells timestamptz out in full — the probe's
        // normalizer must treat this as equal to the model's type.
        data_type: column.type,
      });
    }
  }
  return rows;
}

interface FakeResponses {
  privileges?: Record<string, boolean>; // table -> can_select (default true)
  writeGrants?: { table_name: string; privilege_type: string }[];
  columns?: Record<string, unknown>[];
  /** Tables in the manifest that do NOT exist on the live DB (dev drift). */
  absentTables?: string[];
}

function fakeClient(responses: FakeResponses = {}): ProbePgClient {
  return {
    async query(text: string, params?: unknown[]) {
      if (text.includes("has_table_privilege")) {
        const tables = (params?.[1] as string[]) ?? [];
        return {
          rows: tables.map((tbl) => {
            const absent = responses.absentTables?.includes(tbl) === true;
            return {
              tbl,
              table_exists: !absent,
              can_select: absent ? null : (responses.privileges?.[tbl] ?? true),
            };
          }),
        };
      }
      if (text.includes("role_table_grants")) {
        return { rows: responses.writeGrants ?? [] };
      }
      if (text.includes("information_schema.columns")) {
        return { rows: responses.columns ?? healthyColumns() };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

const baseDeps = {
  grantedTables: GRANTED,
  now: () => new Date("2026-07-08T12:00:00.000Z"),
  role: "analyst_reader",
};

describe("probeAnalystConnection", () => {
  it("healthy connection → ok verdict", async () => {
    const verdict = await probeAnalystConnection({
      ...baseDeps,
      getClient: async () => fakeClient(),
    });
    expect(verdict.status).toBe("ok");
    expect(verdict.reason).toBeUndefined();
    expect(verdict.checkedAt).toBe("2026-07-08T12:00:00.000Z");
  });

  it("revoked SELECT on one manifest table → fail naming the table", async () => {
    const verdict = await probeAnalystConnection({
      ...baseDeps,
      getClient: async () => fakeClient({ privileges: { messages: false } }),
    });
    expect(verdict.status).toBe("fail");
    expect(verdict.reason).toBe("select_revoked");
    expect(verdict.detail).toContain("messages");
  });

  it("manifest table ABSENT from the live DB → tolerated (dev drift, to_regclass semantics), verdict ok", async () => {
    // The grant migration's generated section skips missing tables with
    // to_regclass guards (dev drifts from the Drizzle schema —
    // crm_work_links 2026-07-08). The probe mirrors that: an absent table
    // was never granted and cannot be queried, so it is neither a
    // privilege breach nor schema drift. Columns for the absent table are
    // also missing from information_schema.
    const verdict = await probeAnalystConnection({
      ...baseDeps,
      getClient: async () =>
        fakeClient({
          absentTables: ["messages"],
          columns: healthyColumns().filter(
            (row) => row.table_name !== "messages",
          ),
        }),
    });
    expect(verdict.status).toBe("ok");
  });

  it("unexpected write privilege → fail (grant-surface breach)", async () => {
    const verdict = await probeAnalystConnection({
      ...baseDeps,
      getClient: async () =>
        fakeClient({
          writeGrants: [{ table_name: "threads", privilege_type: "UPDATE" }],
        }),
    });
    expect(verdict.status).toBe("fail");
    expect(verdict.reason).toBe("write_privilege");
    expect(verdict.detail).toContain("threads");
    expect(verdict.detail).toContain("UPDATE");
  });

  it("schema drift (column type change) → fail with drift detail", async () => {
    const drifted = healthyColumns().map((row) =>
      row.table_name === "messages" && row.column_name === "token_count"
        ? { ...row, data_type: "text" } // integer → text
        : row,
    );
    const verdict = await probeAnalystConnection({
      ...baseDeps,
      getClient: async () => fakeClient({ columns: drifted }),
    });
    expect(verdict.status).toBe("fail");
    expect(verdict.reason).toBe("schema_drift");
    expect(verdict.detail).toContain("messages.token_count");
    expect(verdict.detail).toContain("integer");
    expect(verdict.detail).toContain("text");
  });

  it("connect failure → fail reason unreachable", async () => {
    const verdict = await probeAnalystConnection({
      ...baseDeps,
      getClient: async () => {
        throw new Error("ECONNREFUSED analyst cluster");
      },
    });
    expect(verdict.status).toBe("fail");
    expect(verdict.reason).toBe("unreachable");
    expect(verdict.detail).toContain("ECONNREFUSED");
  });

  it("benign type-spelling difference is NOT drift", async () => {
    // Model says "timestamp with time zone"; live says the same — normalizer
    // collapses both to timestamptz. A representational difference must not
    // read as drift.
    const cols = healthyColumns().map((row) =>
      row.column_name === "created_at"
        ? { ...row, data_type: "timestamp with time zone" }
        : row,
    );
    const verdict = await probeAnalystConnection({
      ...baseDeps,
      getClient: async () => fakeClient({ columns: cols }),
    });
    expect(verdict.status).toBe("ok");
  });
});

describe("evaluateAnalystProbeGate", () => {
  const ANALYST_URL = "https://api.example.com/mcp/analyst";
  const OTHER_URL = "https://api.example.com/mcp/crm";
  const NOW = Date.parse("2026-07-08T12:00:00.000Z");

  it("no verdict key → served (never gated)", () => {
    expect(evaluateAnalystProbeGate(null, ANALYST_URL, NOW)).toBeNull();
    expect(evaluateAnalystProbeGate({}, ANALYST_URL, NOW)).toBeNull();
    expect(
      evaluateAnalystProbeGate({ recordLinkHints: {} }, ANALYST_URL, NOW),
    ).toBeNull();
  });

  it("fresh ok verdict → served", () => {
    const meta = {
      analyst_probe: {
        status: "ok",
        checkedAt: "2026-07-08T11:45:00.000Z",
      },
    };
    expect(evaluateAnalystProbeGate(meta, ANALYST_URL, NOW)).toBeNull();
  });

  it("fail verdict → withheld with the verdict detail", () => {
    const meta = {
      analyst_probe: {
        status: "fail",
        reason: "select_revoked",
        detail: 'analyst_reader lost SELECT on granted table "messages"',
        checkedAt: "2026-07-08T11:45:00.000Z",
      },
    };
    const gate = evaluateAnalystProbeGate(meta, ANALYST_URL, NOW);
    expect(gate).not.toBeNull();
    expect(gate!.detail).toContain("messages");
  });

  it("stale ok verdict on an analyst row → withheld", () => {
    const meta = {
      analyst_probe: {
        status: "ok",
        checkedAt: new Date(NOW - PROBE_STALE_AFTER_MS - 1000).toISOString(),
      },
    };
    const gate = evaluateAnalystProbeGate(meta, ANALYST_URL, NOW);
    expect(gate).not.toBeNull();
    expect(gate!.detail).toContain("stale");
  });

  it("verdict on a non-analyst URL → not gated (mislabel guard)", () => {
    const meta = {
      analyst_probe: {
        status: "fail",
        detail: "should not gate a foreign row",
        checkedAt: "2026-07-08T11:45:00.000Z",
      },
    };
    expect(evaluateAnalystProbeGate(meta, OTHER_URL, NOW)).toBeNull();
  });
});
