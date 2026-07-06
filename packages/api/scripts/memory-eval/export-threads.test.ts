import { describe, expect, it, vi } from "vitest";

import {
  buildSelectionSql,
  buildTranscriptSql,
  coerceRole,
  parseArgs,
  redactSecrets,
  runExportThreads,
  type ExportArgs,
  type QueryClient,
} from "./export-threads.js";

function buildArgs(overrides: Partial<ExportArgs> = {}): ExportArgs {
  return {
    databaseUrl: "postgres://user:pass@example/db",
    count: 18,
    out: "/tmp/memory-eval/threads-fixture.json",
    json: false,
    ...overrides,
  };
}

describe("parseArgs", () => {
  it("uses env defaults", () => {
    const args = parseArgs([], { DATABASE_URL: "postgres://env/db" });
    expect(args).toMatchObject({
      databaseUrl: "postgres://env/db",
      count: 18,
      out: "/tmp/memory-eval/threads-fixture.json",
      json: false,
    });
  });

  it("collects explicit flags", () => {
    const args = parseArgs([
      "--database-url",
      "postgres://cli/db",
      "--count",
      "9",
      "--out",
      "/tmp/out.json",
      "--json",
    ]);
    expect(args).toEqual({
      databaseUrl: "postgres://cli/db",
      count: 9,
      out: "/tmp/out.json",
      json: true,
    });
  });

  it("rejects a non-positive count", () => {
    expect(() => parseArgs(["--count", "0"])).toThrow(/positive integer/);
  });

  it("rejects unknown flags", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(/Unknown argument/);
  });
});

describe("buildSelectionSql / buildTranscriptSql", () => {
  it("excludes eval traffic and smoke/e2e-shaped titles", () => {
    const sql = buildSelectionSql();
    expect(sql).toMatch(/evalTraffic/);
    expect(sql).toMatch(/smoke\|e2e\|eval\|test fixture\|probe/);
    expect(sql).toMatch(/NTILE\(3\)/);
  });

  it("transcript sql filters empty content and orders by created_at", () => {
    const sql = buildTranscriptSql();
    expect(sql).toMatch(/content IS NOT NULL/);
    expect(sql).toMatch(/ORDER BY thread_id ASC, created_at ASC/);
  });
});

describe("coerceRole", () => {
  it("passes through assistant and system", () => {
    expect(coerceRole("assistant")).toBe("assistant");
    expect(coerceRole("system")).toBe("system");
  });

  it("coerces anything else to user", () => {
    expect(coerceRole("user")).toBe("user");
    expect(coerceRole("tool")).toBe("user");
    expect(coerceRole(undefined)).toBe("user");
  });
});

describe("redactSecrets", () => {
  it("scrubs AWS access keys", () => {
    expect(redactSecrets("key=AKIAABCDEFGHIJKLMNOP end")).toBe(
      "key=[REDACTED_AWS_KEY] end",
    );
  });

  it("scrubs bearer tokens", () => {
    expect(
      redactSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456"),
    ).toBe("Authorization: Bearer [REDACTED_TOKEN]");
  });

  it("leaves ordinary text untouched", () => {
    const text = "Let's ship the retain harness by Friday.";
    expect(redactSecrets(text)).toBe(text);
  });
});

describe("runExportThreads", () => {
  it("throws without a database URL", async () => {
    await expect(
      runExportThreads(buildArgs({ databaseUrl: undefined })),
    ).rejects.toThrow(/DATABASE_URL is required/);
  });

  it("assembles a fixture from the selection + transcript queries", async () => {
    const db: QueryClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("NTILE")) {
          return {
            rows: [
              {
                thread_id: "thread-1",
                title: "Plan the launch",
                tenant_id: "tenant-1",
                msg_count: 4,
                char_count: 400,
              },
            ],
          };
        }
        return {
          rows: [
            {
              thread_id: "thread-1",
              role: "user",
              content: "  Let's plan the launch.  ",
              created_at: "2026-07-01T00:00:00.000Z",
            },
            {
              thread_id: "thread-1",
              role: "assistant",
              content: "Sure, here's a plan.",
              created_at: "2026-07-01T00:01:00.000Z",
            },
          ],
        };
      }),
    };

    const fixture = await runExportThreads(buildArgs({ count: 6 }), { db });

    expect(fixture.count).toBe(1);
    expect(fixture.threads).toHaveLength(1);
    expect(fixture.threads[0]).toMatchObject({
      threadId: "thread-1",
      tenantId: "tenant-1",
      title: "Plan the launch",
    });
    expect(fixture.threads[0].messages).toEqual([
      {
        role: "user",
        content: "Let's plan the launch.",
        timestamp: "2026-07-01T00:00:00.000Z",
      },
      {
        role: "assistant",
        content: "Sure, here's a plan.",
        timestamp: "2026-07-01T00:01:00.000Z",
      },
    ]);
  });

  it("drops threads with no non-empty messages after filtering", async () => {
    const db: QueryClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("NTILE")) {
          return {
            rows: [
              {
                thread_id: "thread-empty",
                title: "Ghost thread",
                tenant_id: "tenant-1",
                msg_count: 4,
                char_count: 40,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const fixture = await runExportThreads(buildArgs({ count: 6 }), { db });
    expect(fixture.threads).toHaveLength(0);
  });
});
