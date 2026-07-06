import { describe, expect, it, vi } from "vitest";

import type { ThreadsFixture } from "./export-threads.js";
import {
  fetchUnitsForDocument,
  parseArgs,
  postRetain,
  runRetainForFixture,
  serializeTranscript,
  type FetchImpl,
  type QueryClient,
  type RunRetainArgs,
} from "./run-retain.js";

function buildArgs(overrides: Partial<RunRetainArgs> = {}): RunRetainArgs {
  return {
    candidate: "gpt-oss-20b-baseline",
    hindsightUrl: "http://localhost:8888",
    bank: "evalrun",
    schema: "eval_baseline",
    fixture: "/tmp/memory-eval/threads-fixture.json",
    out: "/tmp/memory-eval/runs/gpt-oss-20b-baseline.units.json",
    databaseUrl: "postgresql://postgres:hindsight@localhost:5433/hindsight",
    timeoutMs: 300_000,
    ...overrides,
  };
}

describe("parseArgs", () => {
  it("reads candidate/schema from env", () => {
    const args = parseArgs(["--fixture", "f.json", "--out", "o.json"], {
      CANDIDATE: "gpt-oss-20b-baseline",
      CANDIDATE_SCHEMA: "eval_baseline",
    });
    expect(args).toMatchObject({
      candidate: "gpt-oss-20b-baseline",
      schema: "eval_baseline",
      fixture: "f.json",
      out: "o.json",
      hindsightUrl: "http://localhost:8888",
      bank: "evalrun",
    });
  });

  it("requires candidate, schema, fixture, out", () => {
    expect(() => parseArgs([])).toThrow(/--candidate is required/);
    expect(() => parseArgs(["--candidate", "c"])).toThrow(
      /--schema is required/,
    );
    expect(() => parseArgs(["--candidate", "c", "--schema", "s"])).toThrow(
      /--fixture is required/,
    );
    expect(() =>
      parseArgs(["--candidate", "c", "--schema", "s", "--fixture", "f"]),
    ).toThrow(/--out is required/);
  });

  it("strips a trailing slash from the hindsight URL", () => {
    const args = parseArgs([
      "--candidate",
      "c",
      "--schema",
      "s",
      "--fixture",
      "f",
      "--out",
      "o",
      "--hindsight-url",
      "http://localhost:8888/",
    ]);
    expect(args.hindsightUrl).toBe("http://localhost:8888");
  });
});

describe("serializeTranscript", () => {
  it("matches HindsightAdapter.retainConversation's line format", () => {
    const content = serializeTranscript([
      {
        role: "user",
        content: "Plan the launch.",
        timestamp: "2026-07-01T00:00:00.000Z",
      },
      {
        role: "assistant",
        content: "Sure, here's a plan.",
        timestamp: "2026-07-01T00:01:00.000Z",
      },
    ]);
    expect(content).toBe(
      "user (2026-07-01T00:00:00.000Z): Plan the launch.\n" +
        "assistant (2026-07-01T00:01:00.000Z): Sure, here's a plan.",
    );
  });

  it("drops empty-content messages", () => {
    const content = serializeTranscript([
      { role: "user", content: "  ", timestamp: "2026-07-01T00:00:00.000Z" },
      {
        role: "assistant",
        content: "Reply.",
        timestamp: "2026-07-01T00:01:00.000Z",
      },
    ]);
    expect(content).toBe("assistant (2026-07-01T00:01:00.000Z): Reply.");
  });
});

describe("postRetain", () => {
  it("posts the exact retainConversation wire shape", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        items_count: 1,
        usage: { totalTokens: 10 },
      }),
    })) as unknown as FetchImpl;

    const result = await postRetain(
      fetchImpl,
      "http://localhost:8888",
      "evalrun",
      "thread-1",
      "user (2026-07-01T00:00:00.000Z): hi",
      300_000,
    );

    expect(result.ok).toBe(true);
    expect(result.body).toMatchObject({ items_count: 1 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:8888/v1/default/banks/evalrun/memories",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              content: "user (2026-07-01T00:00:00.000Z): hi",
              document_id: "thread-1",
              update_mode: "replace",
              context: "thinkwork_thread",
            },
          ],
        }),
      }),
    );
  });
});

describe("fetchUnitsForDocument", () => {
  it("queries memory_units scoped to bank + document_id", async () => {
    const db: QueryClient = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: "unit-1",
            text: "Eric prefers pnpm over npm.",
            context: "thinkwork_thread",
            fact_type: "preference",
            document_id: "thread-1",
            created_at: "2026-07-01T00:00:00.000Z",
          },
        ],
      })),
    };

    const rows = await fetchUnitsForDocument(
      db,
      "eval_baseline",
      "evalrun",
      "thread-1",
    );
    expect(rows).toHaveLength(1);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("eval_baseline.memory_units"),
      ["evalrun", "thread-1"],
    );
  });

  it("rejects an unsafe schema name", async () => {
    const db: QueryClient = { query: vi.fn() };
    await expect(
      fetchUnitsForDocument(db, "eval; DROP TABLE x", "evalrun", "thread-1"),
    ).rejects.toThrow(/Invalid schema/);
  });
});

describe("runRetainForFixture", () => {
  it("retains each thread, reads back units, and records wall time", async () => {
    const fixture: ThreadsFixture = {
      generatedAt: "2026-07-01T00:00:00.000Z",
      count: 1,
      threads: [
        {
          threadId: "thread-1",
          tenantId: "tenant-1",
          title: "Plan the launch",
          messages: [
            {
              role: "user",
              content: "Plan the launch.",
              timestamp: "2026-07-01T00:00:00.000Z",
            },
          ],
        },
      ],
    };

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        items_count: 1,
        usage: { totalTokens: 5 },
      }),
    })) as unknown as FetchImpl;

    const db: QueryClient = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: "unit-1",
            text: "Wants to plan the launch.",
            context: "thinkwork_thread",
            fact_type: "fact",
            document_id: "thread-1",
            created_at: "2026-07-01T00:00:00.000Z",
          },
        ],
      })),
    };

    const report = await runRetainForFixture(buildArgs(), fixture, {
      fetchImpl,
      db,
    });

    expect(report.candidate).toBe("gpt-oss-20b-baseline");
    expect(report.threads).toHaveLength(1);
    expect(report.threads[0].ok).toBe(true);
    expect(report.threads[0].units).toHaveLength(1);
    expect(report.threads[0].itemsCount).toBe(1);
    expect(report.totalWallMs).toBeGreaterThanOrEqual(0);
  });

  it("records a failed retain without reading units back", async () => {
    const fixture: ThreadsFixture = {
      generatedAt: "2026-07-01T00:00:00.000Z",
      count: 1,
      threads: [
        {
          threadId: "thread-1",
          tenantId: "tenant-1",
          title: "Broken thread",
          messages: [
            {
              role: "user",
              content: "hi",
              timestamp: "2026-07-01T00:00:00.000Z",
            },
          ],
        },
      ],
    };

    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    })) as unknown as FetchImpl;
    const db: QueryClient = { query: vi.fn() };

    const report = await runRetainForFixture(buildArgs(), fixture, {
      fetchImpl,
      db,
    });

    expect(report.threads[0].ok).toBe(false);
    expect(report.threads[0].error).toMatch(/retain 500/);
    expect(report.threads[0].units).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });
});
