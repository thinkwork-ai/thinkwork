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
  evaluateAnalystRefreshGate,
  normalizePgType,
  probeAnalystConnection,
  PROBE_STALE_AFTER_MS,
  type AnalystTableDescriptor,
  type ProbePgClient,
} from "./connection-probe.js";

describe("normalizePgType", () => {
  it("collapses serial macros to their catalog base types", () => {
    expect(normalizePgType("bigserial")).toBe("bigint");
    expect(normalizePgType("serial")).toBe("integer");
    expect(normalizePgType("smallserial")).toBe("smallint");
  });

  it("maps internal udt spellings and array element types", () => {
    expect(normalizePgType("text[]")).toBe("text array");
    expect(normalizePgType("int4 array")).toBe("integer array");
    expect(normalizePgType("int8")).toBe("bigint");
    expect(normalizePgType("bool")).toBe("boolean");
  });
});

const GRANTED: AnalystTableDescriptor[] = [
  {
    schema: "public",
    name: "threads",
    columns: [
      { name: "id", type: "uuid" },
      { name: "tenant_id", type: "uuid" },
      { name: "title", type: "text" },
      { name: "created_at", type: "timestamp with time zone" },
    ],
  },
  {
    schema: "public",
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
        table_schema: table.schema,
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
  /** "table.column" -> can_select override (wins over table-level). */
  columnPrivileges?: Record<string, boolean>;
  /** Granted columns MISSING from the live table (falls to drift check). */
  missingColumns?: string[]; // "table.column"
  writeGrants?: { table_name: string; privilege_type: string }[];
  columns?: Record<string, unknown>[];
  /** Tables in the manifest that do NOT exist on the live DB (dev drift). */
  absentTables?: string[];
  /** THINK-283 (sourceSchema set): every SELECT-able relation of the role. */
  readableSurface?: Record<string, unknown>[];
  /** THINK-283 (sourceSchema set): effective write surface. */
  effectiveWrite?: Record<string, unknown>[];
  /** THINK-283 (sourceSchema set): schemas the role can CREATE in. */
  schemaCreate?: Record<string, unknown>[];
}

function fakeClient(responses: FakeResponses = {}): ProbePgClient {
  return {
    async query(text: string, params?: unknown[]) {
      if (text.includes("has_column_privilege")) {
        const schemas = (params?.[1] as string[]) ?? [];
        const tables = (params?.[2] as string[]) ?? [];
        const cols = (params?.[3] as string[]) ?? [];
        return {
          rows: tables.map((tbl, i) => {
            const col = cols[i];
            const key = `${tbl}.${col}`;
            const absent = responses.absentTables?.includes(tbl) === true;
            const columnMissing =
              absent || responses.missingColumns?.includes(key) === true;
            return {
              sch: schemas[i],
              tbl,
              col,
              table_exists: !absent,
              column_exists: !columnMissing,
              can_select: columnMissing
                ? null
                : (responses.columnPrivileges?.[key] ??
                  responses.privileges?.[tbl] ??
                  true),
            };
          }),
        };
      }
      // THINK-283 sourced exact-surface checks (sourceSchema set).
      if (text.includes("'INSERT, UPDATE, DELETE, TRUNCATE'")) {
        return { rows: responses.effectiveWrite ?? [] };
      }
      if (text.includes("has_table_privilege($1, c.oid, 'SELECT')")) {
        return { rows: responses.readableSurface ?? [] };
      }
      if (text.includes("has_schema_privilege")) {
        return { rows: responses.schemaCreate ?? [] };
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

  it("revoked SELECT on a single granted column → fail naming table.column", async () => {
    // Column-level grants are the migration's shape for tables with denied
    // columns (0227 grants SELECT (col, ...) on routines). The probe checks
    // per-column, so a one-column revocation is caught precisely.
    const verdict = await probeAnalystConnection({
      ...baseDeps,
      getClient: async () =>
        fakeClient({ columnPrivileges: { "messages.body": false } }),
    });
    expect(verdict.status).toBe("fail");
    expect(verdict.reason).toBe("select_revoked");
    expect(verdict.detail).toContain("messages.body");
  });

  it("granted column MISSING from an existing live table → drift, not revocation", async () => {
    // A dropped column has no privilege to check — it must surface as
    // schema_drift (the model's SQL assumptions are stale), never as
    // select_revoked.
    const verdict = await probeAnalystConnection({
      ...baseDeps,
      getClient: async () =>
        fakeClient({
          missingColumns: ["messages.body"],
          columns: healthyColumns().filter(
            (row) =>
              !(row.table_name === "messages" && row.column_name === "body"),
          ),
        }),
    });
    expect(verdict.status).toBe("fail");
    expect(verdict.reason).toBe("schema_drift");
    expect(verdict.detail).toContain("messages.body");
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

  it("serial-macro and array-element spellings are NOT drift", async () => {
    // Model spellings come from Drizzle getSQLType (bigserial, text[]);
    // the live catalog reports the base type (bigint) and, after the
    // probe's udt_name CASE, 'text array'. Both observed as false drift
    // on dev 2026-07-09.
    const granted: AnalystTableDescriptor[] = [
      {
        schema: "public",
        name: "events",
        columns: [
          { name: "id", type: "bigserial" },
          { name: "tags", type: "text[]" },
        ],
      },
    ];
    const verdict = await probeAnalystConnection({
      ...baseDeps,
      grantedTables: granted,
      getClient: async () =>
        fakeClient({
          columns: [
            { table_name: "events", column_name: "id", data_type: "bigint" },
            {
              table_name: "events",
              column_name: "tags",
              data_type: "text array",
            },
          ],
        }),
    });
    expect(verdict.status).toBe("ok");
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

describe("THINK-283 exact-surface checks (sourceSchema set)", () => {
  const sourcedGranted: AnalystTableDescriptor[] = [
    {
      schema: "raw_jde",
      name: "orders",
      columns: [{ name: "id", type: "uuid" }],
    },
  ];
  const sourcedColumns = [
    {
      table_schema: "raw_jde",
      table_name: "orders",
      column_name: "id",
      data_type: "uuid",
    },
  ];
  const expectedSurface = [{ schema: "raw_jde", name: "orders", relkind: "r" }];
  const sourcedDeps = (responses: FakeResponses) => ({
    grantedTables: sourcedGranted,
    now: () => new Date("2026-07-13T12:00:00.000Z"),
    role: "warehouse_reader",
    sourceSchema: "raw_jde",
    getClient: async () =>
      fakeClient({
        columns: sourcedColumns,
        readableSurface: expectedSurface,
        ...responses,
      }),
  });

  it("expected qualified surface with no extras → ok", async () => {
    const verdict = await probeAnalystConnection(sourcedDeps({}));
    expect(verdict.status).toBe("ok");
  });

  it("covers AE3: a newly granted UNMODELED table withholds the source instead of expanding the model", async () => {
    const verdict = await probeAnalystConnection(
      sourcedDeps({
        readableSurface: [
          ...expectedSurface,
          { schema: "raw_jde", name: "new_orders", relkind: "r" },
        ],
      }),
    );
    expect(verdict.status).toBe("fail");
    expect(verdict.reason).toBe("unexpected_surface");
    expect(verdict.detail).toContain("raw_jde.new_orders");
    expect(verdict.detail).toContain("refresh");
  });

  it("access to another user schema is an isolation failure with a qualified reason", async () => {
    const verdict = await probeAnalystConnection(
      sourcedDeps({
        readableSurface: [
          ...expectedSurface,
          { schema: "platform", name: "mirror_batch", relkind: "r" },
        ],
      }),
    );
    expect(verdict.status).toBe("fail");
    expect(verdict.reason).toBe("unexpected_surface");
    expect(verdict.detail).toContain("platform.mirror_batch");
  });

  it("a newly selectable VIEW (owner-privilege bypass) is detected even with no direct grant row", async () => {
    const verdict = await probeAnalystConnection(
      sourcedDeps({
        readableSurface: [
          ...expectedSurface,
          { schema: "raw_jde", name: "orders_view", relkind: "v" },
        ],
      }),
    );
    expect(verdict.status).toBe("fail");
    expect(verdict.reason).toBe("unexpected_surface");
    expect(verdict.detail).toContain("orders_view (v)");
  });

  it("effective write privileges and schema-creation rights withhold", async () => {
    const writable = await probeAnalystConnection(
      sourcedDeps({
        effectiveWrite: [{ schema: "raw_jde", name: "orders" }],
      }),
    );
    expect(writable.status).toBe("fail");
    expect(writable.reason).toBe("write_privilege");

    const creatable = await probeAnalystConnection(
      sourcedDeps({ schemaCreate: [{ schema: "raw_jde" }] }),
    );
    expect(creatable.status).toBe("fail");
    expect(creatable.reason).toBe("unexpected_surface");
    expect(creatable.detail).toContain("CREATE");
  });
});

describe("THINK-283 refresh gate (evaluateAnalystRefreshGate)", () => {
  const ANALYST_SOURCED_URL = "https://api.test/mcp/analyst/warehouse";

  it("absent key → served (never-refreshed sources keep working)", () => {
    expect(evaluateAnalystRefreshGate({}, ANALYST_SOURCED_URL)).toBeNull();
    expect(
      evaluateAnalystRefreshGate(
        { analyst_probe: { status: "ok", checkedAt: "x" } },
        ANALYST_SOURCED_URL,
      ),
    ).toBeNull();
  });

  it("running and failed refresh states withhold with operator detail", () => {
    const running = evaluateAnalystRefreshGate(
      { analyst_refresh: { status: "running", attemptId: "a1" } },
      ANALYST_SOURCED_URL,
    );
    expect(running).not.toBeNull();
    expect(running!.detail).toContain("in progress");

    const failed = evaluateAnalystRefreshGate(
      {
        analyst_refresh: {
          status: "failed",
          detail: "model upload failed — retry the refresh",
        },
      },
      ANALYST_SOURCED_URL,
    );
    expect(failed).not.toBeNull();
    expect(failed!.detail).toContain("model upload failed");
  });

  it("a completed (ok) refresh serves; a malformed blob fails closed", () => {
    expect(
      evaluateAnalystRefreshGate(
        { analyst_refresh: { status: "ok", attemptId: "a1" } },
        ANALYST_SOURCED_URL,
      ),
    ).toBeNull();
    const malformed = evaluateAnalystRefreshGate(
      { analyst_refresh: { status: "??" } },
      ANALYST_SOURCED_URL,
    );
    expect(malformed).not.toBeNull();
    expect(malformed!.detail).toContain("malformed");
  });

  it("state isolation: a fresh OK probe verdict does NOT clear a refresh withhold", () => {
    const meta = {
      analyst_probe: {
        status: "ok",
        checkedAt: new Date("2026-07-13T12:00:00.000Z").toISOString(),
      },
      analyst_refresh: { status: "running", attemptId: "a1" },
    };
    // The probe gate passes...
    expect(
      evaluateAnalystProbeGate(
        meta,
        ANALYST_SOURCED_URL,
        Date.parse("2026-07-13T12:01:00.000Z"),
      ),
    ).toBeNull();
    // ...but the refresh gate still withholds — the two states are separate.
    expect(
      evaluateAnalystRefreshGate(meta, ANALYST_SOURCED_URL),
    ).not.toBeNull();
  });

  it("refresh state on a non-analyst URL → not gated (mislabel guard)", () => {
    expect(
      evaluateAnalystRefreshGate(
        { analyst_refresh: { status: "failed" } },
        "https://api.test/mcp/other",
      ),
    ).toBeNull();
  });
});
