import { describe, expect, it, vi } from "vitest";

import {
  buildSafeReport,
  parseArgs,
  redactIdentifier,
  runHindsightFoundationAudit,
  sanitizeForReport,
  validateSchemaName,
  type AuditArgs,
  type QueryClient,
} from "./hindsight-memory-foundation-audit.js";

function buildArgs(overrides: Partial<AuditArgs> = {}): AuditArgs {
  return {
    stage: "dev",
    schema: "hindsight",
    json: true,
    probeQuery: "ThinkWork memory foundation evidence",
    ...overrides,
  };
}

function buildDb(results: Array<{ rows: unknown[] } | Error>): QueryClient {
  let index = 0;
  return {
    query: vi.fn(async () => {
      const result = results[index++] ?? { rows: [] };
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

describe("parseArgs", () => {
  it("uses env defaults for endpoint and database URL", () => {
    const args = parseArgs(["--stage", "dev"], {
      HINDSIGHT_ENDPOINT: "https://hindsight.dev.example",
      DATABASE_URL: "postgres://user:pass@example/db",
    });

    expect(args).toMatchObject({
      stage: "dev",
      endpoint: "https://hindsight.dev.example",
      databaseUrl: "postgres://user:pass@example/db",
      schema: "hindsight",
      json: false,
      probeQuery: "ThinkWork memory foundation evidence",
    });
  });

  it("collects explicit flags", () => {
    expect(
      parseArgs([
        "--stage",
        "prod",
        "--endpoint",
        "https://hindsight.example",
        "--database-url",
        "postgres://db",
        "--schema",
        "memory",
        "--probe-bank",
        "space_space-1",
        "--probe-query",
        "space policy",
        "--json",
      ]),
    ).toMatchObject({
      stage: "prod",
      endpoint: "https://hindsight.example",
      databaseUrl: "postgres://db",
      schema: "memory",
      probeBankId: "space_space-1",
      probeQuery: "space policy",
      json: true,
    });
  });

  it("rejects unknown flags", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(/Unknown argument/);
  });
});

describe("redaction helpers", () => {
  it("redacts stable identifiers while preserving useful shape", () => {
    expect(redactIdentifier("user_12345678-90ab-cdef-1234-567890abcdef")).toBe(
      "user_12345678...",
    );
    expect(redactIdentifier("short")).toBe("short");
    expect(redactIdentifier(null)).toBeNull();
  });

  it("omits raw memory-looking fields and emails from report data", () => {
    const sanitized = sanitizeForReport({
      id: "12345678-90ab-cdef-1234-567890abcdef",
      bank_id: "user_12345678-90ab-cdef-1234-567890abcdef",
      content: "remember that eric@example.com prefers private details",
      text: "raw memory text",
      raw_content: "raw retained provider response",
      safeCount: 7,
      nested: {
        source_facts: ["raw source fact"],
        sourceFactText: "raw source fact text",
        ownerEmail: "buyer@example.com",
      },
    });

    expect(sanitized).toEqual({
      id: "12345678...",
      bank_id: "user_12345678...",
      content: "[omitted]",
      text: "[omitted]",
      raw_content: "[omitted]",
      safeCount: 7,
      nested: {
        source_facts: "[omitted]",
        sourceFactText: "[omitted]",
        ownerEmail: "[redacted-email]",
      },
    });
  });

  it("buildSafeReport sanitizes accidental raw content leakage", () => {
    expect(() =>
      buildSafeReport({
        generatedAt: "2026-06-27T00:00:00.000Z",
        stage: "dev",
        schema: "hindsight",
        probes: {
          unsafe: {
            status: "ok",
            rows: [{ content: "raw user memory" }],
          },
        },
      }),
    ).not.toThrow();
  });
});

describe("validateSchemaName", () => {
  it("accepts normal postgres identifiers", () => {
    expect(validateSchemaName("hindsight")).toBe("hindsight");
    expect(validateSchemaName("memory_2026")).toBe("memory_2026");
  });

  it("rejects injection-shaped schema names", () => {
    expect(() => validateSchemaName("hindsight;drop table users")).toThrow(
      /Invalid schema/,
    );
  });
});

describe("runHindsightFoundationAudit", () => {
  it("summarizes aggregate database sections without raw content", async () => {
    const db = buildDb([
      { rows: [{ table_name: "banks", row_count: "14" }] },
      { rows: [{ fact_type: "observation", row_count: "8089" }] },
      {
        rows: [
          {
            context: "thinkwork_thread",
            fact_type: "world",
            row_count: "25",
          },
        ],
      },
      {
        rows: [
          {
            observations: "10",
            with_proof_count: "10",
            with_source_memory_ids: "9",
            proof_matches_source_count: "8",
            proof_source_mismatch_count: "2",
          },
        ],
      },
      {
        rows: [
          {
            documents: "5",
            with_timestamp: "0",
            with_tags: "0",
            with_document_tags: "0",
            with_observation_scopes: "0",
          },
        ],
      },
      {
        rows: [
          {
            context: "thinkwork_thread",
            documents: "5",
            with_timestamp: "5",
            with_tags: "5",
            with_document_tags: "5",
            with_observation_scopes: "5",
          },
        ],
      },
      {
        rows: [
          {
            memory_units: "20",
            tagged_units: "1",
            with_event_date: "20",
            with_occurred_start: "5",
            with_mentioned_at: "20",
          },
        ],
      },
      {
        rows: [
          {
            row_type: "documents",
            total: "3",
            with_timestamp: "3",
            with_tags: "3",
            with_document_tags: "3",
            with_observation_scopes: "3",
            observations: "0",
            with_source_memory_ids: "0",
          },
          {
            row_type: "memory_units",
            total: "7",
            with_timestamp: "0",
            with_tags: "7",
            with_document_tags: "0",
            with_observation_scopes: "0",
            observations: "5",
            with_source_memory_ids: "5",
          },
        ],
      },
      {
        rows: [
          {
            bank_family: "space",
            banks: "2",
            documents: "3",
            memory_units: "7",
            observations: "5",
            with_source_memory_ids: "5",
          },
          {
            bank_family: "user",
            banks: "8",
            documents: "20",
            memory_units: "50",
            observations: "18",
            with_source_memory_ids: "16",
          },
        ],
      },
      {
        rows: [
          {
            observations: "10",
            with_proof_count: "10",
            with_source_memory_ids: "9",
            proof_matches_source_count: "8",
            proof_source_mismatch_count: "2",
            missing_source_memory_ids: "1",
          },
        ],
      },
      { rows: [{ table_name: "mental_models", row_count: "0" }] },
      {
        rows: [
          {
            operation_type: "retain",
            status: "completed",
            row_count: "99",
          },
        ],
      },
    ]);

    const report = await runHindsightFoundationAudit(buildArgs(), {
      db,
      now: () => new Date("2026-06-27T12:00:00.000Z"),
    });

    expect(report.probes.databaseTableCounts.status).toBe("ok");
    expect(report.probes.factTypes.rows).toEqual([
      { fact_type: "observation", row_count: 8089 },
    ]);
    expect(report.probes.retainParamsByContext.rows).toEqual([
      {
        context: "thinkwork_thread",
        documents: 5,
        with_timestamp: 5,
        with_tags: 5,
        with_document_tags: 5,
        with_observation_scopes: 5,
      },
    ]);
    expect(report.probes.spaceMemoryRetainCoverage.rows).toEqual([
      {
        row_type: "documents",
        total: 3,
        with_timestamp: 3,
        with_tags: 3,
        with_document_tags: 3,
        with_observation_scopes: 3,
        observations: 0,
        with_source_memory_ids: 0,
      },
      {
        row_type: "memory_units",
        total: 7,
        with_timestamp: 0,
        with_tags: 7,
        with_document_tags: 0,
        with_observation_scopes: 0,
        observations: 5,
        with_source_memory_ids: 5,
      },
    ]);
    expect(report.probes.directBrainBankPosture.rows).toContainEqual({
      bank_family: "space",
      banks: 2,
      documents: 3,
      memory_units: 7,
      observations: 5,
      with_source_memory_ids: 5,
    });
    expect(report.probes.evidenceAvailability.rows).toEqual([
      {
        observations: 10,
        with_proof_count: 10,
        with_source_memory_ids: 9,
        proof_matches_source_count: 8,
        proof_source_mismatch_count: 2,
        missing_source_memory_ids: 1,
      },
    ]);
    expect(JSON.stringify(report)).not.toContain("raw user memory");
  });

  it("degrades failed probe sections and continues", async () => {
    const db = buildDb([
      { rows: [{ table_name: "banks", row_count: "14" }] },
      new Error("column source_memory_ids does not exist"),
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);

    const report = await runHindsightFoundationAudit(buildArgs(), {
      db,
      now: () => new Date("2026-06-27T12:00:00.000Z"),
    });

    expect(report.probes.databaseTableCounts.status).toBe("ok");
    expect(report.probes.factTypes.status).toBe("degraded");
    expect(report.probes.factTypes.error).toContain("column source_memory_ids");
  });

  it("probes service health with a redacted structural payload", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "healthy",
        database: "connected",
        content: "should not appear",
      }),
    });

    const report = await runHindsightFoundationAudit(
      buildArgs({ endpoint: "https://hindsight.example" }),
      {
        db: buildDb(Array.from({ length: 12 }, () => ({ rows: [] }))),
        fetchImpl,
        now: () => new Date("2026-06-27T12:00:00.000Z"),
      },
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://hindsight.example/health",
      expect.objectContaining({ method: "GET" }),
    );
    expect(report.probes.serviceHealth).toMatchObject({
      status: "ok",
      data: {
        status: "healthy",
        database: "connected",
        content: "[omitted]",
      },
    });
  });

  it("skips live recall evidence when no probe bank is configured", async () => {
    const report = await runHindsightFoundationAudit(
      buildArgs({ endpoint: "https://hindsight.example" }),
      {
        db: buildDb(Array.from({ length: 12 }, () => ({ rows: [] }))),
        fetchImpl: vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ banks: [] }),
        }),
        now: () => new Date("2026-06-27T12:00:00.000Z"),
      },
    );

    expect(report.probes.recallEvidenceShape).toMatchObject({
      status: "skipped",
      reason: "HINDSIGHT_AUDIT_RECALL_BANK_ID is not configured",
    });
  });

  it("probes live recall evidence shape without exposing source text", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/health")) {
        return { ok: true, json: async () => ({ status: "healthy" }) };
      }
      if (url.endsWith("/v1/default/banks")) {
        return { ok: true, json: async () => ({ banks: [] }) };
      }
      return {
        ok: true,
        json: async () => ({
          memories: [
            {
              id: "memory-1",
              content: "raw memory content",
              source_fact_ids: ["fact-1"],
              source_memory_ids: ["memory-source-1"],
              source_facts: [{ text: "raw source fact" }],
            },
            {
              id: "memory-2",
              sourceFactIds: ["fact-2"],
            },
          ],
          source_facts: [{ text: "raw top-level source fact" }],
        }),
      };
    }) as any;

    const report = await runHindsightFoundationAudit(
      buildArgs({
        endpoint: "https://hindsight.example",
        probeBankId: "space_space-1",
        probeQuery: "policy",
      }),
      {
        db: buildDb(Array.from({ length: 12 }, () => ({ rows: [] }))),
        fetchImpl,
        now: () => new Date("2026-06-27T12:00:00.000Z"),
      },
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://hindsight.example/v1/default/banks/space_space-1/memories/recall",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"source_facts":true'),
      }),
    );
    expect(report.probes.recallEvidenceShape).toMatchObject({
      status: "ok",
      data: {
        result_count: 2,
        results_with_source_fact_ids: 2,
        results_with_source_memory_ids: 1,
        results_with_embedded_source_facts: 1,
        top_level_source_fact_count: 1,
      },
    });
    expect(JSON.stringify(report)).not.toContain("raw source fact");
    expect(JSON.stringify(report)).not.toContain("raw memory content");
  });
});
