import { afterEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { S3Client } from "@aws-sdk/client-s3";
import type { Database } from "@thinkwork/database-pg";
import type {
  ResolvedWorkspaceRenderTuple,
  WorkspaceTupleRepository,
} from "./workspace-renderer/types.js";
import {
  THREAD_LAST_RENDER_VERSION,
  computeRoutingSignature,
  evaluateRenderSkip,
  probeSourcePrefixesUnchanged,
  readThreadLastRender,
  writeThreadLastRender,
  type ThreadLastRenderMarker,
} from "./workspace-render-skip.js";

const dialect = new PgDialect();

function render(fragment: unknown): { sql: string; params: unknown[] } {
  const query = dialect.sqlToQuery(fragment as SQL);
  return { sql: query.sql, params: query.params as unknown[] };
}

const validMarker: ThreadLastRenderMarker = {
  version: THREAD_LAST_RENDER_VERSION,
  generatedAt: "2026-08-03T00:00:00.000Z",
  renderedPrefix: "tenants/acme/rendered/agent-1/space-1/",
  sourcePrefixes: [
    "tenants/acme/agents/agent-1/",
    "tenants/acme/spaces/space-1/",
  ],
  routingSignature: "sig-1",
  configFingerprint: "cfg-1",
};

/** Read-only fake: select().from().where() resolves to the given rows. */
function selectDb(rows: unknown[]): Database {
  return {
    select: () => ({
      from: () => ({
        where: async () => rows,
      }),
    }),
    update: () => {
      throw new Error("read path must not update");
    },
  } as unknown as Database;
}

interface CapturedUpdate {
  set: Record<string, unknown>;
  where: SQL;
}

function updateDb(captured: CapturedUpdate[]): Database {
  return {
    select: () => {
      throw new Error("write path must not read");
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

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.RENDER_SKIP_MAX_AGE_MS;
});

describe("readThreadLastRender", () => {
  it("round-trips a valid marker from threads.metadata.lastRender", async () => {
    const db = selectDb([{ metadata: { lastRender: validMarker, other: 1 } }]);
    await expect(
      readThreadLastRender({ tenantId: "t1", threadId: "th1" }, { db }),
    ).resolves.toEqual(validMarker);
  });

  it("returns null for a wrong version", async () => {
    const db = selectDb([
      { metadata: { lastRender: { ...validMarker, version: 999 } } },
    ]);
    await expect(
      readThreadLastRender({ tenantId: "t1", threadId: "th1" }, { db }),
    ).resolves.toBeNull();
  });

  it.each([
    ["missing renderedPrefix", { ...validMarker, renderedPrefix: "" }],
    ["empty sourcePrefixes", { ...validMarker, sourcePrefixes: [] }],
    [
      "non-string routingSignature",
      { ...validMarker, routingSignature: undefined },
    ],
    ["non-string configFingerprint", { ...validMarker, configFingerprint: 42 }],
    ["unparseable generatedAt", { ...validMarker, generatedAt: "not-a-date" }],
  ])("returns null for %s", async (_label, marker) => {
    const db = selectDb([{ metadata: { lastRender: marker } }]);
    await expect(
      readThreadLastRender({ tenantId: "t1", threadId: "th1" }, { db }),
    ).resolves.toBeNull();
  });

  it("returns null when the row or metadata is missing", async () => {
    await expect(
      readThreadLastRender(
        { tenantId: "t1", threadId: "th1" },
        { db: selectDb([]) },
      ),
    ).resolves.toBeNull();
    await expect(
      readThreadLastRender(
        { tenantId: "t1", threadId: "th1" },
        { db: selectDb([{ metadata: null }]) },
      ),
    ).resolves.toBeNull();
  });

  it("returns null on a db error (never throws)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = {
      select: () => {
        throw new Error("boom");
      },
    } as unknown as Database;
    await expect(
      readThreadLastRender({ tenantId: "t1", threadId: "th1" }, { db }),
    ).resolves.toBeNull();
  });
});

describe("writeThreadLastRender", () => {
  it("issues a single jsonb_set UPDATE that merges only lastRender", async () => {
    const captured: CapturedUpdate[] = [];
    await writeThreadLastRender(
      { tenantId: "t1", threadId: "th1", marker: validMarker },
      { db: updateDb(captured) },
    );

    expect(captured).toHaveLength(1);
    const { sql, params } = render(captured[0].set.metadata);
    expect(sql).toContain("jsonb_set(");
    expect(sql).toContain(`coalesce("threads"."metadata", '{}'::jsonb)`);
    expect(sql).toContain("'{lastRender}'");
    // Sole parameter is the marker payload — sibling metadata keys are
    // merged in SQL, never read into JS and re-written.
    expect(params).toEqual([JSON.stringify(validMarker)]);
  });

  it("swallows db errors (best-effort)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = {
      update: () => {
        throw new Error("boom");
      },
    } as unknown as Database;
    await expect(
      writeThreadLastRender(
        { tenantId: "t1", threadId: "th1", marker: validMarker },
        { db },
      ),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe("probeSourcePrefixesUnchanged", () => {
  const since = new Date("2026-08-03T00:00:00.000Z");
  const older = new Date("2026-08-02T00:00:00.000Z");
  const newer = new Date("2026-08-03T01:00:00.000Z");

  function fakeS3(
    pagesByPrefix: Record<
      string,
      Array<{ Contents?: { LastModified?: Date }[]; IsTruncated?: boolean }>
    >,
  ): Pick<S3Client, "send"> {
    const cursors: Record<string, number> = {};
    return {
      send: async (command: unknown) => {
        const { Prefix } = (command as { input: { Prefix: string } }).input;
        const pages = pagesByPrefix[Prefix] ?? [{ Contents: [] }];
        const index = cursors[Prefix] ?? 0;
        cursors[Prefix] = index + 1;
        const page = pages[Math.min(index, pages.length - 1)];
        return {
          Contents: page.Contents ?? [],
          IsTruncated: page.IsTruncated ?? false,
          NextContinuationToken: page.IsTruncated ? `tok-${index}` : undefined,
        };
      },
    } as Pick<S3Client, "send">;
  }

  it("returns true when every object is older than since", async () => {
    const s3 = fakeS3({
      "a/": [{ Contents: [{ LastModified: older }] }],
      "b/": [{ Contents: [{ LastModified: older }, { LastModified: older }] }],
    });
    await expect(
      probeSourcePrefixesUnchanged(
        { bucket: "bkt", sourcePrefixes: ["a/", "b/"], since },
        { s3 },
      ),
    ).resolves.toBe(true);
  });

  it("returns false when any object is newer than since", async () => {
    const s3 = fakeS3({
      "a/": [{ Contents: [{ LastModified: older }] }],
      "b/": [{ Contents: [{ LastModified: older }, { LastModified: newer }] }],
    });
    await expect(
      probeSourcePrefixesUnchanged(
        { bucket: "bkt", sourcePrefixes: ["a/", "b/"], since },
        { s3 },
      ),
    ).resolves.toBe(false);
  });

  it("returns false when a prefix is still truncated after the page cap", async () => {
    const truncatedPage = {
      Contents: [{ LastModified: older }],
      IsTruncated: true,
    };
    const s3 = fakeS3({
      "a/": Array.from({ length: 10 }, () => truncatedPage),
    });
    await expect(
      probeSourcePrefixesUnchanged(
        { bucket: "bkt", sourcePrefixes: ["a/"], since },
        { s3 },
      ),
    ).resolves.toBe(false);
  });

  it("returns false on an s3 error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s3 = {
      send: async () => {
        throw new Error("s3 down");
      },
    } as unknown as Pick<S3Client, "send">;
    await expect(
      probeSourcePrefixesUnchanged(
        { bucket: "bkt", sourcePrefixes: ["a/"], since },
        { s3 },
      ),
    ).resolves.toBe(false);
  });
});

describe("evaluateRenderSkip", () => {
  const freshMarker: ThreadLastRenderMarker = {
    ...validMarker,
    generatedAt: new Date().toISOString(),
  };
  const probeTrue = vi.fn(async () => true);
  const base = {
    marker: freshMarker,
    bucket: "bkt",
    currentRoutingSignature: freshMarker.routingSignature,
    currentConfigFingerprint: freshMarker.configFingerprint,
    deps: { probe: probeTrue },
  };

  it("rejects with no_marker", async () => {
    await expect(
      evaluateRenderSkip({ ...base, marker: null }),
    ).resolves.toEqual({ skip: false, reason: "no_marker" });
  });

  it("rejects with no_bucket", async () => {
    await expect(
      evaluateRenderSkip({ ...base, bucket: undefined }),
    ).resolves.toEqual({ skip: false, reason: "no_bucket" });
  });

  it("rejects an expired marker, honoring the maxAgeMs override", async () => {
    const marker = {
      ...freshMarker,
      generatedAt: new Date(Date.now() - 60_000).toISOString(),
    };
    await expect(
      evaluateRenderSkip({ ...base, marker, maxAgeMs: 30_000 }),
    ).resolves.toEqual({ skip: false, reason: "marker_expired" });
    // Same marker passes with a bigger allowance.
    await expect(
      evaluateRenderSkip({ ...base, marker, maxAgeMs: 120_000 }),
    ).resolves.toMatchObject({ skip: true });
  });

  it("honors the RENDER_SKIP_MAX_AGE_MS env override at call time", async () => {
    process.env.RENDER_SKIP_MAX_AGE_MS = "30000";
    const marker = {
      ...freshMarker,
      generatedAt: new Date(Date.now() - 60_000).toISOString(),
    };
    await expect(evaluateRenderSkip({ ...base, marker })).resolves.toEqual({
      skip: false,
      reason: "marker_expired",
    });
  });

  it("rejects on routing signature mismatch", async () => {
    await expect(
      evaluateRenderSkip({ ...base, currentRoutingSignature: "other" }),
    ).resolves.toEqual({ skip: false, reason: "routing_changed" });
  });

  it("rejects on config fingerprint mismatch", async () => {
    await expect(
      evaluateRenderSkip({ ...base, currentConfigFingerprint: "other" }),
    ).resolves.toEqual({ skip: false, reason: "config_changed" });
  });

  it("rejects when the source probe reports changes", async () => {
    const probeFalse = vi.fn(async () => false);
    await expect(
      evaluateRenderSkip({ ...base, deps: { probe: probeFalse } }),
    ).resolves.toEqual({ skip: false, reason: "sources_changed" });
    expect(probeFalse).toHaveBeenCalledWith({
      bucket: "bkt",
      sourcePrefixes: freshMarker.sourcePrefixes,
      since: new Date(Date.parse(freshMarker.generatedAt)),
    });
  });

  it("skips with the marker when everything is fresh", async () => {
    await expect(evaluateRenderSkip(base)).resolves.toEqual({
      skip: true,
      reason: "fresh",
      marker: freshMarker,
    });
  });
});

describe("computeRoutingSignature", () => {
  const tuple: ResolvedWorkspaceRenderTuple = {
    tenantId: "t1",
    tenantSlug: "acme",
    agentId: "a1",
    agentSlug: "helper",
    agentName: "Helper",
    spaceId: "s1",
    spaceSlug: "growth",
    spaceName: "Growth",
    spaceKind: "team",
    spaceAccessMode: "public",
    spacePrompt: null,
    threadId: null,
    threadSlug: null,
    userId: "u1",
    userName: "Jane",
    userSlug: "jane",
    capabilityRegistryTrust: false,
  } as ResolvedWorkspaceRenderTuple;

  function fakeRepository(overrides: {
    participants?: Array<{ id: string; name: string; slug: string }>;
    resolveThrows?: boolean;
  }): WorkspaceTupleRepository {
    return {
      resolve: async () => {
        if (overrides.resolveThrows) throw new Error("db down");
        return tuple;
      },
      listAuthorizedSpaces: async () => [
        {
          id: "s1",
          slug: "growth",
          name: "Growth",
          accessMode: "public",
          isActive: true,
        },
      ],
      listSpaceParticipants: async () =>
        overrides.participants ?? [
          { id: "u1", name: "Jane", slug: "jane" },
          { id: "u2", name: "Ken", slug: "ken" },
        ],
      listSavedCanvases: async () => [{ artifactId: "c1", name: "Roadmap" }],
    } as WorkspaceTupleRepository;
  }

  const timestampDb = selectDb([
    { updatedAt: new Date("2026-08-01T00:00:00.000Z") },
  ]);
  const input = { tenantId: "t1", agentId: "a1", spaceId: "s1", userId: "u1" };

  it("is deterministic for identical rows", async () => {
    const first = await computeRoutingSignature(input, {
      repository: fakeRepository({}),
      db: timestampDb,
    });
    const second = await computeRoutingSignature(input, {
      repository: fakeRepository({}),
      db: timestampDb,
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when a participant row changes", async () => {
    const before = await computeRoutingSignature(input, {
      repository: fakeRepository({}),
      db: timestampDb,
    });
    const after = await computeRoutingSignature(input, {
      repository: fakeRepository({
        participants: [
          { id: "u1", name: "Jane", slug: "jane" },
          { id: "u3", name: "New Person", slug: "new-person" },
        ],
      }),
      db: timestampDb,
    });
    expect(after).not.toBe(before);
  });

  it("returns a unique fail-closed value when the repository throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = await computeRoutingSignature(input, {
      repository: fakeRepository({ resolveThrows: true }),
      db: timestampDb,
    });
    const second = await computeRoutingSignature(input, {
      repository: fakeRepository({ resolveThrows: true }),
      db: timestampDb,
    });
    expect(first).toMatch(/^error:/);
    expect(second).toMatch(/^error:/);
    expect(first).not.toBe(second);
  });
});
