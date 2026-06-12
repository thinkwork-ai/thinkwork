import { describe, expect, it } from "vitest";
import {
  agentsMdContentMayDiffer,
  parseWorkspaceProjection,
  selectLatestProjection,
} from "./workspace-projection";

const FULL_SNAPSHOT = {
  model: "claude-x",
  workspace_projection: {
    renderedPrefix: "tenants/acme/threads/thread-1/",
    sources: [
      {
        owner: "agent",
        prefix: "tenants/acme/agents/main/",
        etagSummary: "3:abc123def456",
      },
      { owner: "space:revenue", prefix: "tenants/acme/spaces/revenue/" },
    ],
    agentsMdKey: "tenants/acme/threads/thread-1/AGENTS.md",
    agentsMdEtag: "etag-render-1",
    injectedFiles: ["AGENTS.md", "CONTEXT.md"],
    generatedAt: "2026-06-12T10:00:00.000Z",
    fetches: [
      {
        target: { kind: "space", slug: "ops" },
        outcome: "success",
        fileCount: 12,
        totalBytes: 34_000,
        at: "2026-06-12T10:01:00.000Z",
      },
      {
        target: { kind: "space", slug: "finance" },
        outcome: "denied",
        fileCount: 0,
        totalBytes: 0,
        deniedReason: "not_authorized",
        at: "2026-06-12T10:02:00.000Z",
      },
    ],
    reconcile: {
      rejectedCount: 2,
      rejections: [
        { path: "AGENTS.md", code: "read_only_generated_file" },
        { path: "fetched/spaces/ops/notes.md", code: "fetched_path_read_only" },
      ],
      updatedAt: "2026-06-12T10:05:00.000Z",
    },
  },
};

describe("parseWorkspaceProjection", () => {
  it("parses a full snapshot object", () => {
    const projection = parseWorkspaceProjection(FULL_SNAPSHOT);
    expect(projection).not.toBeNull();
    expect(projection!.renderedPrefix).toBe("tenants/acme/threads/thread-1/");
    expect(projection!.sources).toHaveLength(2);
    expect(projection!.sources[0]).toEqual({
      owner: "agent",
      prefix: "tenants/acme/agents/main/",
      etagSummary: "3:abc123def456",
    });
    expect(projection!.sources[1].etagSummary).toBeNull();
    expect(projection!.agentsMdKey).toBe(
      "tenants/acme/threads/thread-1/AGENTS.md",
    );
    expect(projection!.agentsMdEtag).toBe("etag-render-1");
    expect(projection!.injectedFiles).toEqual(["AGENTS.md", "CONTEXT.md"]);
    expect(projection!.generatedAt).toBe("2026-06-12T10:00:00.000Z");
    expect(projection!.fetches).toHaveLength(2);
    expect(projection!.fetches[1]).toMatchObject({
      kind: "space",
      slug: "finance",
      outcome: "denied",
      deniedReason: "not_authorized",
    });
    expect(projection!.reconcile).toMatchObject({
      rejectedCount: 2,
      rejections: [
        { path: "AGENTS.md", code: "read_only_generated_file" },
        { path: "fetched/spaces/ops/notes.md", code: "fetched_path_read_only" },
      ],
    });
  });

  it("parses an AWSJSON string snapshot", () => {
    const projection = parseWorkspaceProjection(JSON.stringify(FULL_SNAPSHOT));
    expect(projection?.agentsMdKey).toBe(
      "tenants/acme/threads/thread-1/AGENTS.md",
    );
  });

  it("returns null when workspace_projection is absent (pre-feature turn)", () => {
    expect(parseWorkspaceProjection(null)).toBeNull();
    expect(parseWorkspaceProjection(undefined)).toBeNull();
    expect(parseWorkspaceProjection({})).toBeNull();
    expect(parseWorkspaceProjection({ model: "claude-x" })).toBeNull();
    expect(parseWorkspaceProjection("not json {")).toBeNull();
    expect(parseWorkspaceProjection(42)).toBeNull();
  });

  it("tolerates malformed/partial snapshots without crashing", () => {
    const projection = parseWorkspaceProjection({
      workspace_projection: {
        sources: [{ bogus: true }, null, "string", { owner: "agent" }],
        injectedFiles: [1, null, "AGENTS.md"],
        fetches: ["junk", { outcome: "partial" }],
        reconcile: { rejections: [{ path: "x.md" }, { code: "no-path" }] },
      },
    });
    expect(projection).not.toBeNull();
    expect(projection!.renderedPrefix).toBeNull();
    expect(projection!.agentsMdKey).toBeNull();
    expect(projection!.agentsMdEtag).toBeNull();
    expect(projection!.generatedAt).toBeNull();
    // Entries with no owner/prefix are dropped; valid partials kept.
    expect(projection!.sources).toEqual([
      { owner: "agent", prefix: null, etagSummary: null },
    ]);
    expect(projection!.injectedFiles).toEqual(["AGENTS.md"]);
    expect(projection!.fetches).toEqual([
      {
        kind: null,
        slug: null,
        outcome: "partial",
        fileCount: null,
        totalBytes: null,
        deniedReason: null,
        at: null,
      },
    ]);
    // Rejection without a path is dropped; missing code defaults.
    expect(projection!.reconcile).toEqual({
      rejectedCount: 1,
      rejections: [{ path: "x.md", code: "unknown" }],
      updatedAt: null,
    });
  });

  it("treats an empty projection object as present but empty", () => {
    const projection = parseWorkspaceProjection({ workspace_projection: {} });
    expect(projection).not.toBeNull();
    expect(projection!.sources).toEqual([]);
    expect(projection!.fetches).toEqual([]);
    expect(projection!.reconcile).toBeNull();
  });
});

describe("selectLatestProjection", () => {
  function turnWith(
    id: string,
    generatedAt: string | null,
    agentsMdEtag?: string,
  ) {
    return {
      id,
      contextSnapshot: {
        workspace_projection: {
          generatedAt,
          agentsMdKey: `prefix/${id}/AGENTS.md`,
          ...(agentsMdEtag ? { agentsMdEtag } : {}),
        },
      },
    };
  }

  it("picks the projection with the newest generatedAt", () => {
    const latest = selectLatestProjection([
      turnWith("turn-new", "2026-06-12T12:00:00Z", "etag-new"),
      turnWith("turn-old", "2026-06-12T09:00:00Z", "etag-old"),
      { id: "turn-none", contextSnapshot: {} },
    ]);
    expect(latest?.turnId).toBe("turn-new");
    expect(latest?.agentsMdKey).toBe("prefix/turn-new/AGENTS.md");
    expect(latest?.agentsMdEtag).toBe("etag-new");
  });

  it("returns null when no turn carries a projection", () => {
    expect(
      selectLatestProjection([{ id: "a", contextSnapshot: null }, { id: "b" }]),
    ).toBeNull();
  });

  it("falls back to the first projected turn when timestamps are missing", () => {
    // The turns query returns newest-first; missing generatedAt ties resolve
    // to the earliest array entry.
    const latest = selectLatestProjection([
      turnWith("turn-first", null),
      turnWith("turn-second", null),
    ]);
    expect(latest?.turnId).toBe("turn-first");
  });
});

describe("agentsMdContentMayDiffer", () => {
  const projection = parseWorkspaceProjection(FULL_SNAPSHOT)!;

  it("is false for the latest projected turn with a matching key", () => {
    expect(
      agentsMdContentMayDiffer("turn-1", projection, {
        turnId: "turn-1",
        generatedAt: projection.generatedAt,
        agentsMdKey: projection.agentsMdKey,
        agentsMdEtag: projection.agentsMdEtag,
      }),
    ).toBe(false);
  });

  it("is true when a later turn re-rendered the workspace (no etags)", () => {
    // latest carries no etag, so the heuristic decides.
    expect(
      agentsMdContentMayDiffer("turn-1", projection, {
        turnId: "turn-2",
        generatedAt: "2026-06-12T12:00:00Z",
        agentsMdKey: projection.agentsMdKey,
        agentsMdEtag: null,
      }),
    ).toBe(true);
  });

  it("is false when a later render produced the same etag (fact beats heuristic)", () => {
    // The heuristic alone would flag this (different turn, different key),
    // but equal etags prove the rendered bytes are identical.
    expect(
      agentsMdContentMayDiffer("turn-1", projection, {
        turnId: "turn-2",
        generatedAt: "2026-06-12T12:00:00Z",
        agentsMdKey: "prefix/turn-2/AGENTS.md",
        agentsMdEtag: projection.agentsMdEtag,
      }),
    ).toBe(false);
  });

  it("is true when etags are present on both sides and differ", () => {
    expect(
      agentsMdContentMayDiffer("turn-1", projection, {
        turnId: "turn-1",
        generatedAt: projection.generatedAt,
        agentsMdKey: projection.agentsMdKey,
        agentsMdEtag: "etag-render-2",
      }),
    ).toBe(true);
  });

  it("falls back to the heuristic when this turn's snapshot has no etag", () => {
    const noEtagProjection = { ...projection, agentsMdEtag: null };
    expect(
      agentsMdContentMayDiffer("turn-1", noEtagProjection, {
        turnId: "turn-2",
        generatedAt: "2026-06-12T12:00:00Z",
        agentsMdKey: projection.agentsMdKey,
        agentsMdEtag: "etag-render-2",
      }),
    ).toBe(true);
    expect(
      agentsMdContentMayDiffer("turn-1", noEtagProjection, {
        turnId: "turn-1",
        generatedAt: projection.generatedAt,
        agentsMdKey: projection.agentsMdKey,
        agentsMdEtag: "etag-render-2",
      }),
    ).toBe(false);
  });

  it("is false when no projection exists anywhere", () => {
    expect(agentsMdContentMayDiffer("turn-1", projection, null)).toBe(false);
  });
});
