import { afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  appendWorkspaceProjectionFetchEvent,
  buildWorkspaceProjectionReconcileSummary,
  buildWorkspaceProjectionSnapshot,
  isWorkspaceProjectionManifestLike,
  mergeWorkspaceProjectionReconcileSummary,
  recordDispatchWorkspaceProjectionSnapshot,
  writeWorkspaceProjectionSnapshot,
  WORKSPACE_PROJECTION_PROMPT_FILES,
  WORKSPACE_PROJECTION_RECONCILE_REJECTION_CAP,
  type WorkspaceProjectionFetchEvent,
  type WorkspaceProjectionManifestLike,
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

// ---------------------------------------------------------------------------
// U6 — dispatch-time snapshot
// ---------------------------------------------------------------------------

const RENDERED_PREFIX =
  "tenants/acme/rendered/agents/main/spaces/growth/threads/t1/";

const manifest: WorkspaceProjectionManifestLike = {
  generatedAt: "2026-06-12T01:02:03.000Z",
  sources: [
    { owner: "agent", prefix: "tenants/acme/agents/main/" },
    { owner: "space", prefix: "tenants/acme/spaces/growth/" },
    { owner: "user", prefix: "tenants/acme/users/jane/" },
  ],
  files: [
    {
      path: "AGENTS.md",
      sourcePrefix: "tenants/acme/agents/main/",
      etag: "e1",
      generated: true,
    },
    {
      path: "CONTEXT.md",
      sourcePrefix: "tenants/acme/agents/main/",
      etag: "e2",
    },
    {
      path: "SPACE.md",
      sourcePrefix: "tenants/acme/spaces/growth/",
      etag: "e3",
    },
    {
      path: "User/USER.md",
      sourcePrefix: "tenants/acme/users/jane/",
      etag: "e4",
    },
    {
      path: "notes/plan.md",
      sourcePrefix: "tenants/acme/spaces/growth/",
      etag: "e5",
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildWorkspaceProjectionSnapshot", () => {
  it("resolves agentsMdKey to `${renderedPrefix}AGENTS.md` (U2 contract)", () => {
    const snapshot = buildWorkspaceProjectionSnapshot({
      renderedPrefix: RENDERED_PREFIX,
      manifest,
    });
    expect(snapshot.agentsMdKey).toBe(`${RENDERED_PREFIX}AGENTS.md`);
  });

  it("captures the generated AGENTS.md etag as agentsMdEtag", () => {
    // The rendered AGENTS.md key is overwritten by every re-render, so the
    // etag is the only durable fact for staleness comparison (web panel /
    // evals consume it).
    const snapshot = buildWorkspaceProjectionSnapshot({
      renderedPrefix: RENDERED_PREFIX,
      manifest,
    });
    expect(snapshot.agentsMdEtag).toBe("e1");
  });

  it("agentsMdEtag is null without a generated AGENTS.md manifest entry", () => {
    // A non-generated AGENTS.md (hydrated source file) doesn't count…
    const nonGenerated = buildWorkspaceProjectionSnapshot({
      renderedPrefix: RENDERED_PREFIX,
      manifest: {
        ...manifest,
        files: manifest.files!.map((file) =>
          file.path === "AGENTS.md" ? { ...file, generated: undefined } : file,
        ),
      },
    });
    expect(nonGenerated.agentsMdEtag).toBeNull();
    // …and neither does a missing manifest (legacy renderer payload).
    expect(
      buildWorkspaceProjectionSnapshot({
        renderedPrefix: RENDERED_PREFIX,
        manifest: null,
      }).agentsMdEtag,
    ).toBeNull();
  });

  it("injectedFiles lists exactly the PROMPT_FILES present in the rendered manifest", () => {
    const snapshot = buildWorkspaceProjectionSnapshot({
      renderedPrefix: RENDERED_PREFIX,
      manifest,
    });
    // GUARDRAILS.md absent from the render; notes/plan.md is not a prompt file.
    expect(snapshot.injectedFiles).toEqual([
      "AGENTS.md",
      "CONTEXT.md",
      "SPACE.md",
      "User/USER.md",
    ]);
    for (const file of snapshot.injectedFiles) {
      expect(WORKSPACE_PROJECTION_PROMPT_FILES).toContain(file);
    }
  });

  it("carries the manifest sources with a per-source etag fingerprint", () => {
    const snapshot = buildWorkspaceProjectionSnapshot({
      renderedPrefix: RENDERED_PREFIX,
      manifest,
    });
    expect(
      snapshot.sources.map((s) => ({ owner: s.owner, prefix: s.prefix })),
    ).toEqual([
      { owner: "agent", prefix: "tenants/acme/agents/main/" },
      { owner: "space", prefix: "tenants/acme/spaces/growth/" },
      { owner: "user", prefix: "tenants/acme/users/jane/" },
    ]);
    // 2 files hydrated from the space source → "2:<12-hex>".
    expect(snapshot.sources[1].etagSummary).toMatch(/^2:[0-9a-f]{12}$/);
    // Summary changes when content (etag) changes — same prefix, new bytes.
    const mutated = buildWorkspaceProjectionSnapshot({
      renderedPrefix: RENDERED_PREFIX,
      manifest: {
        ...manifest,
        files: manifest.files!.map((file) =>
          file.path === "SPACE.md" ? { ...file, etag: "e3-changed" } : file,
        ),
      },
    });
    expect(mutated.sources[1].etagSummary).not.toBe(
      snapshot.sources[1].etagSummary,
    );
    expect(mutated.sources[0].etagSummary).toBe(
      snapshot.sources[0].etagSummary,
    );
  });

  it("uses the manifest generatedAt, falling back to now()", () => {
    expect(
      buildWorkspaceProjectionSnapshot({
        renderedPrefix: RENDERED_PREFIX,
        manifest,
      }).generatedAt,
    ).toBe("2026-06-12T01:02:03.000Z");
    expect(
      buildWorkspaceProjectionSnapshot({
        renderedPrefix: RENDERED_PREFIX,
        manifest: null,
        now: () => new Date("2026-06-12T09:00:00.000Z"),
      }).generatedAt,
    ).toBe("2026-06-12T09:00:00.000Z");
  });

  it("tolerates a missing manifest (legacy renderer payload): empty sources, no injected files", () => {
    const snapshot = buildWorkspaceProjectionSnapshot({
      renderedPrefix: RENDERED_PREFIX,
      manifest: null,
    });
    expect(snapshot.sources).toEqual([]);
    expect(snapshot.injectedFiles).toEqual([]);
    expect(snapshot.agentsMdKey).toBe(`${RENDERED_PREFIX}AGENTS.md`);
  });
});

describe("writeWorkspaceProjectionSnapshot", () => {
  const snapshot = buildWorkspaceProjectionSnapshot({
    renderedPrefix: RENDERED_PREFIX,
    manifest,
  });

  it("issues a single atomic UPDATE that merges over the existing projection (fetches preserved)", async () => {
    const captured: CapturedUpdate[] = [];
    await writeWorkspaceProjectionSnapshot("turn-1", snapshot, {
      db: fakeDb(captured),
    });

    expect(captured).toHaveLength(1);
    const { sql, params } = render(captured[0].set.context_snapshot);
    // Object-merge: existing projection (defaulted to {}) || snapshot —
    // right operand wins per key. The snapshot JSON never carries `fetches`
    // or `reconcile`, so events appended before a turn-loop RE-dispatch
    // survive the write.
    expect(sql).toContain(
      `coalesce("thread_turns"."context_snapshot" -> 'workspace_projection', '{}'::jsonb) || $1::jsonb`,
    );
    expect(sql).toContain(
      `coalesce("thread_turns"."context_snapshot", '{}'::jsonb)`,
    );
    expect(sql.match(/jsonb_set/g)).toHaveLength(1);
    expect(params).toEqual([JSON.stringify(snapshot)]);
    const wire = JSON.parse(params[0] as string) as Record<string, unknown>;
    expect("fetches" in wire).toBe(false);
    expect("reconcile" in wire).toBe(false);
    expect(wire.renderedPrefix).toBe(RENDERED_PREFIX);
  });

  it("scopes the UPDATE to the tenant when tenantId is provided", async () => {
    const captured: CapturedUpdate[] = [];
    await writeWorkspaceProjectionSnapshot("turn-1", snapshot, {
      db: fakeDb(captured),
      tenantId: "tenant-1",
    });
    const where = render(captured[0].where);
    expect(where.sql).toContain(`"id" = $1`);
    expect(where.sql).toContain(`"tenant_id" = $2`);
    expect(where.params).toEqual(["turn-1", "tenant-1"]);
  });
});

describe("recordDispatchWorkspaceProjectionSnapshot", () => {
  it("builds + writes the snapshot and returns it", async () => {
    const captured: CapturedUpdate[] = [];
    const result = await recordDispatchWorkspaceProjectionSnapshot({
      threadTurnId: "turn-1",
      tenantId: "tenant-1",
      renderedPrefix: RENDERED_PREFIX,
      hydrateManifest: manifest,
      source: "chat-agent-invoke",
      db: fakeDb(captured),
    });
    expect(captured).toHaveLength(1);
    expect(result?.agentsMdKey).toBe(`${RENDERED_PREFIX}AGENTS.md`);
    expect(render(captured[0].set.context_snapshot).params).toEqual([
      JSON.stringify(result),
    ]);
  });

  it("swallows a db failure: dispatch proceeds, error logged", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const failingDb = {
      update: () => {
        throw new Error("aurora unavailable");
      },
    } as unknown as Database;

    await expect(
      recordDispatchWorkspaceProjectionSnapshot({
        threadTurnId: "turn-1",
        renderedPrefix: RENDERED_PREFIX,
        hydrateManifest: manifest,
        source: "wakeup-processor",
        db: failingDb,
      }),
    ).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        "[wakeup-processor] workspace projection snapshot write failed",
      ),
      expect.any(Error),
    );
  });
});

describe("isWorkspaceProjectionManifestLike", () => {
  it("accepts manifest-shaped objects and rejects everything else", () => {
    expect(isWorkspaceProjectionManifestLike(manifest)).toBe(true);
    expect(isWorkspaceProjectionManifestLike({})).toBe(true);
    expect(isWorkspaceProjectionManifestLike(null)).toBe(false);
    expect(isWorkspaceProjectionManifestLike([])).toBe(false);
    expect(isWorkspaceProjectionManifestLike({ sources: "nope" })).toBe(false);
    expect(isWorkspaceProjectionManifestLike({ files: 42 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// U6 — finalize-time reconcile summary merge
// ---------------------------------------------------------------------------

describe("buildWorkspaceProjectionReconcileSummary", () => {
  it("counts every rejection but caps the detail list at 20", () => {
    const files = [
      { path: "ok.md", status: "written" },
      ...Array.from({ length: 25 }, (_, i) => ({
        path: `bad-${i}.md`,
        status: "rejected",
        code: "lane_violation",
      })),
    ];
    const summary = buildWorkspaceProjectionReconcileSummary(
      { files },
      () => new Date("2026-06-12T10:00:00.000Z"),
    );
    expect(summary.rejectedCount).toBe(25);
    expect(summary.rejections).toHaveLength(
      WORKSPACE_PROJECTION_RECONCILE_REJECTION_CAP,
    );
    expect(summary.rejections[0]).toEqual({
      path: "bad-0.md",
      code: "lane_violation",
    });
    expect(summary.updatedAt).toBe("2026-06-12T10:00:00.000Z");
  });

  it("yields an empty summary for a clean reconcile", () => {
    const summary = buildWorkspaceProjectionReconcileSummary({
      files: [{ path: "ok.md", status: "written" }],
    });
    expect(summary.rejectedCount).toBe(0);
    expect(summary.rejections).toEqual([]);
  });
});

describe("mergeWorkspaceProjectionReconcileSummary", () => {
  const summary = buildWorkspaceProjectionReconcileSummary(
    {
      files: [
        {
          path: "Spaces/other/file.md",
          status: "rejected",
          code: "lane_violation",
        },
      ],
    },
    () => new Date("2026-06-12T10:00:00.000Z"),
  );

  it("sets ONLY the reconcile key — dispatch fields and fetches untouched", async () => {
    const captured: CapturedUpdate[] = [];
    await mergeWorkspaceProjectionReconcileSummary("turn-1", summary, {
      db: fakeDb(captured),
    });

    expect(captured).toHaveLength(1);
    const { sql, params } = render(captured[0].set.context_snapshot);
    // Nested jsonb_set pair: default the projection object, then set the
    // `reconcile` key — never a whole-object replace, so renderedPrefix /
    // sources / fetches written earlier in the turn survive.
    expect(sql).toContain("{workspace_projection,reconcile}");
    expect(sql).toContain(
      `coalesce("thread_turns"."context_snapshot" -> 'workspace_projection', '{}'::jsonb)`,
    );
    expect(sql.match(/jsonb_set/g)).toHaveLength(2);
    expect(params).toEqual([JSON.stringify(summary)]);
  });

  it("scopes to the tenant when provided", async () => {
    const captured: CapturedUpdate[] = [];
    await mergeWorkspaceProjectionReconcileSummary("turn-1", summary, {
      db: fakeDb(captured),
      tenantId: "tenant-1",
    });
    const where = render(captured[0].where);
    expect(where.params).toEqual(["turn-1", "tenant-1"]);
  });
});
