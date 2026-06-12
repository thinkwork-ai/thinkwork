import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  appendWorkspaceProjectionFetchEvent,
  type WorkspaceProjectionFetchEvent,
} from "./workspace-projection-snapshot.js";
import type { Database } from "@thinkwork/database-pg";

const dialect = new PgDialect();

interface CapturedUpdate {
  set: Record<string, unknown>;
  where: SQL;
}

/**
 * Fake drizzle client that records update calls and fails loudly on any
 * read — the appender must be a single UPDATE with no select-then-update.
 */
function fakeDb(captured: CapturedUpdate[]): Database {
  return {
    select: () => {
      throw new Error(
        "appendWorkspaceProjectionFetchEvent must not read before writing",
      );
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async (condition: SQL) => {
          captured.push({ set: values, where: condition });
        },
      }),
    }),
  } as unknown as Database;
}

function render(fragment: unknown): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(fragment as SQL);
  return { sql: query.sql, params: query.params as unknown[] };
}

const event: WorkspaceProjectionFetchEvent = {
  target: { kind: "space", slug: "growth" },
  outcome: "success",
  fileCount: 3,
  totalBytes: 1234,
  at: "2026-06-12T00:00:00.000Z",
};

describe("appendWorkspaceProjectionFetchEvent", () => {
  it("issues a single atomic UPDATE using jsonb || concat (no read-modify-write)", async () => {
    const captured: CapturedUpdate[] = [];
    await appendWorkspaceProjectionFetchEvent("turn-1", event, {
      db: fakeDb(captured),
    });

    expect(captured).toHaveLength(1);
    const { sql, params } = render(captured[0].set.context_snapshot);

    // Atomic concat against the column's current value, defaulted to [].
    expect(sql).toContain(
      `coalesce("thread_turns"."context_snapshot" -> 'workspace_projection' -> 'fetches', '[]'::jsonb) || $1::jsonb`,
    );
    // The workspace_projection object itself is defaulted so the append
    // works on turns with no snapshot yet.
    expect(sql).toContain(
      `coalesce("thread_turns"."context_snapshot", '{}'::jsonb)`,
    );
    expect(sql.match(/jsonb_set/g)).toHaveLength(2);
    // The only parameter is the new event wrapped in a single-element array —
    // prior snapshot state is never read into JS and re-written.
    expect(params).toEqual([JSON.stringify([event])]);
  });

  it("persists both events when two appends race (each UPDATE is self-contained)", async () => {
    const captured: CapturedUpdate[] = [];
    const db = fakeDb(captured);
    const second: WorkspaceProjectionFetchEvent = {
      ...event,
      target: { kind: "user", slug: "jane" },
      outcome: "denied",
      fileCount: 0,
      totalBytes: 0,
      deniedReason: "not_authorized",
    };

    await Promise.all([
      appendWorkspaceProjectionFetchEvent("turn-1", event, { db }),
      appendWorkspaceProjectionFetchEvent("turn-1", second, { db }),
    ]);

    expect(captured).toHaveLength(2);
    const rendered = captured.map((update) =>
      render(update.set.context_snapshot),
    );
    // Each UPDATE carries only its own event as a parameter and concats it
    // onto whatever the row holds at execution time, so under row locking
    // neither append can overwrite the other.
    expect(rendered.map((r) => r.params)).toEqual(
      expect.arrayContaining([
        [JSON.stringify([event])],
        [JSON.stringify([second])],
      ]),
    );
    for (const r of rendered) {
      expect(r.sql).toContain("|| $1::jsonb");
    }
  });

  it("scopes the UPDATE to the tenant when tenantId is provided", async () => {
    const captured: CapturedUpdate[] = [];
    await appendWorkspaceProjectionFetchEvent("turn-1", event, {
      db: fakeDb(captured),
      tenantId: "tenant-1",
    });

    const where = render(captured[0].where);
    expect(where.sql).toContain(`"id" = $1`);
    expect(where.sql).toContain(`"tenant_id" = $2`);
    expect(where.params).toEqual(["turn-1", "tenant-1"]);
  });

  it("omits tenant scoping when tenantId is not provided", async () => {
    const captured: CapturedUpdate[] = [];
    await appendWorkspaceProjectionFetchEvent("turn-1", event, {
      db: fakeDb(captured),
    });

    const where = render(captured[0].where);
    expect(where.params).toEqual(["turn-1"]);
    expect(where.sql).not.toContain("tenant_id");
  });
});
