import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── DB mock (queue-based) ──────────────────────────────────────────────────
// The projection functions (upsert/delete, central + space-local) are
// exercised against a scriptable drizzle facade so the origin-scoping
// predicates (source_space_id IS NULL vs = spaceId) can be asserted.

const { dbState } = vi.hoisted(() => ({
  dbState: {
    selectResults: [] as unknown[][],
    selectCalls: [] as Array<{ table: unknown; where: unknown }>,
    insertCalls: [] as Array<{ table: unknown; values: unknown }>,
    updateCalls: [] as Array<{
      table: unknown;
      values: unknown;
      where: unknown;
    }>,
    deleteCalls: [] as Array<{ table: unknown; where: unknown }>,
  },
}));

vi.mock("./agents/tenant-platform-agent.js", () => ({
  resolveTenantPlatformAgent: vi.fn(),
}));

vi.mock("../graphql/utils.js", () => {
  const col = (name: string) => ({ __col: name });
  const table = (name: string, cols: string[]) => {
    const entries: Array<[string, unknown]> = cols.map((c) => [
      c,
      col(`${name}.${c}`),
    ]);
    entries.push(["__table", name]);
    return Object.fromEntries(entries);
  };
  return {
    db: {
      select: () => ({
        from: (t: unknown) => ({
          where: (w: unknown) => {
            dbState.selectCalls.push({ table: t, where: w });
            return Promise.resolve(dbState.selectResults.shift() ?? []);
          },
        }),
      }),
      insert: (t: unknown) => ({
        values: (v: unknown) => {
          dbState.insertCalls.push({ table: t, values: v });
          const row = Array.isArray(v) ? v[0] : v;
          const result = Promise.resolve([
            { id: "inserted-id", ...(row as Record<string, unknown>) },
          ]) as Promise<unknown[]> & { returning: () => Promise<unknown[]> };
          result.returning = () =>
            Promise.resolve([
              { id: "inserted-id", ...(row as Record<string, unknown>) },
            ]);
          return result;
        },
      }),
      update: (t: unknown) => ({
        set: (v: unknown) => ({
          where: (w: unknown) => ({
            returning: () => {
              dbState.updateCalls.push({ table: t, values: v, where: w });
              return Promise.resolve([
                { id: "updated-id", ...(v as Record<string, unknown>) },
              ]);
            },
          }),
        }),
      }),
      delete: (t: unknown) => ({
        where: (w: unknown) => {
          dbState.deleteCalls.push({ table: t, where: w });
          return Promise.resolve([]);
        },
      }),
    },
    eq: (c: unknown, v: unknown) => ({ op: "eq", col: c, val: v }),
    and: (...preds: unknown[]) => ({ op: "and", preds }),
    isNull: (c: unknown) => ({ op: "isNull", col: c }),
    agentProfiles: table("agent_profiles", [
      "id",
      "tenant_id",
      "slug",
      "name",
      "description",
      "routing_guidance",
      "instructions",
      "model_id",
      "enabled",
      "built_in_key",
      "source_space_id",
      "tool_policy",
      "skill_policy",
      "execution_controls",
      "created_at",
      "updated_at",
    ]),
    agentProfileSpaceAssignments: table("agent_profile_space_assignments", [
      "profile_id",
      "tenant_id",
      "space_id",
      "created_at",
    ]),
    modelCatalog: table("model_catalog", ["model_id", "is_available"]),
    spaces: table("spaces", ["id", "tenant_id", "slug", "name"]),
    tenants: table("tenants", ["id", "slug"]),
  };
});

import {
  agentProfileSlugFromWorkspacePath,
  deleteAgentProfileProjectionForFile,
  deleteSpaceAgentProfileProjectionForFile,
  isAgentProfileWorkspacePath,
  isSpaceAgentProfileWorkspacePath,
  parseAgentProfileFile,
  serializeAgentProfileFile,
  spaceAgentProfileSlugFromWorkspacePath,
  upsertAgentProfileProjectionFromFile,
  upsertSpaceAgentProfileProjectionFromFile,
} from "./agent-profile-workspace-files.js";

const TENANT_ID = "tenant-1";
const SPACE_ID = "space-b";
const MODEL_ID = "claude-haiku-4-5";
const VALID_CONTENT = `---\nname: Research\nmodel: ${MODEL_ID}\nenabled: true\n---\n\n# Instructions\n\nDo research.\n`;

interface Pred {
  op?: string;
  col?: { __col?: string };
  val?: unknown;
  preds?: unknown[];
}

function flattenPreds(pred: unknown): Pred[] {
  const out: Pred[] = [];
  const walk = (p: unknown) => {
    if (!p || typeof p !== "object") return;
    const anyP = p as Pred;
    if (anyP.op === "and" && Array.isArray(anyP.preds)) {
      anyP.preds.forEach(walk);
      return;
    }
    if (anyP.op) out.push(anyP);
  };
  walk(pred);
  return out;
}

function hasEq(pred: unknown, colName: string, val: unknown): boolean {
  return flattenPreds(pred).some(
    (p) => p.op === "eq" && p.col?.__col === colName && p.val === val,
  );
}

function hasIsNull(pred: unknown, colName: string): boolean {
  return flattenPreds(pred).some(
    (p) => p.op === "isNull" && p.col?.__col === colName,
  );
}

beforeEach(() => {
  dbState.selectResults.length = 0;
  dbState.selectCalls.length = 0;
  dbState.insertCalls.length = 0;
  dbState.updateCalls.length = 0;
  dbState.deleteCalls.length = 0;
});

describe("agent profile workspace files", () => {
  it("recognizes canonical Agent Profile markdown files", () => {
    expect(isAgentProfileWorkspacePath("agents/research.md")).toBe(true);
    expect(isAgentProfileWorkspacePath("/agents/research.md")).toBe(true);
    expect(isAgentProfileWorkspacePath("agents/research/CONTEXT.md")).toBe(
      false,
    );
    expect(agentProfileSlugFromWorkspacePath("agents/coding.md")).toBe(
      "coding",
    );
  });

  it("round-trips structured profile fields through markdown frontmatter", () => {
    const content = serializeAgentProfileFile({
      slug: "research",
      name: "Research",
      description: "Finds and synthesizes sources.",
      routingGuidance: "Use for source-backed research.",
      instructions: "Return concise cited findings.",
      modelId: "claude-haiku-4-5",
      enabled: true,
      builtInKey: "research",
      toolPolicy: {
        builtInTools: ["web-search", "web-extract"],
        mcpServers: ["twenty-crm"],
      },
      skillPolicy: { skillSlugs: ["source-review"] },
      executionControls: {
        foreground: true,
        clarify: false,
        maxSubagentDepth: 0,
        maxRuntimeMs: 120000,
        maxTokens: 4096,
        thinking: "minimal",
        reviewGate: true,
        maxReviewLoops: 2,
        loopPolicy: {
          mode: "closed",
          enabled: true,
          maxIterations: 2,
          maxReviewLoops: 2,
          reviewGate: true,
          externalReviewerPolicy: "profile_required",
          failBehavior: "best_effort_with_warning",
        },
      },
      spaceIds: ["space-research"],
    });

    const parsed = parseAgentProfileFile({
      path: "agents/research.md",
      content,
    });

    expect(parsed).toMatchObject({
      slug: "research",
      name: "Research",
      description: "Finds and synthesizes sources.",
      routingGuidance: "Use for source-backed research.",
      instructions: "Return concise cited findings.",
      modelId: "claude-haiku-4-5",
      enabled: true,
      builtInKey: "research",
      toolPolicy: {
        builtInTools: ["web-search", "web-extract"],
        mcpServers: ["twenty-crm"],
      },
      skillPolicy: { skillSlugs: ["source-review"] },
      executionControls: {
        foreground: true,
        clarify: false,
        maxSubagentDepth: 0,
        maxRuntimeMs: 120000,
        maxTokens: 4096,
        thinking: "minimal",
        reviewGate: true,
        maxReviewLoops: 2,
        loopPolicy: {
          mode: "closed",
          enabled: true,
          maxIterations: 2,
          maxReviewLoops: 2,
          reviewGate: true,
          externalReviewerPolicy: "profile_required",
          failBehavior: "best_effort_with_warning",
        },
      },
      spaceRefs: ["space-research"],
    });
  });

  it("recognizes space-source Agent Profile paths (source-relative form)", () => {
    expect(isSpaceAgentProfileWorkspacePath("agents/research.md")).toBe(true);
    expect(isSpaceAgentProfileWorkspacePath("/agents/research.md")).toBe(true);
    expect(isSpaceAgentProfileWorkspacePath("SPACE.md")).toBe(false);
    expect(isSpaceAgentProfileWorkspacePath("docs/agents/research.md")).toBe(
      false,
    );
    expect(isSpaceAgentProfileWorkspacePath("agents/research/CONTEXT.md")).toBe(
      false,
    );
    expect(spaceAgentProfileSlugFromWorkspacePath("agents/coding.md")).toBe(
      "coding",
    );
  });
});

describe("central agent profile projection scoping", () => {
  it("upsert looks up only central rows (source_space_id IS NULL)", async () => {
    dbState.selectResults.push([{ model_id: MODEL_ID }]); // model availability
    dbState.selectResults.push([]); // existing profile lookup → insert path

    await upsertAgentProfileProjectionFromFile({
      tenantId: TENANT_ID,
      path: "agents/research.md",
      content: VALID_CONTENT,
    });

    const profileLookup = dbState.selectCalls.find(
      (call) =>
        (call.table as { __table?: string }).__table === "agent_profiles",
    );
    expect(profileLookup).toBeDefined();
    expect(
      hasIsNull(profileLookup?.where, "agent_profiles.source_space_id"),
    ).toBe(true);
    expect(hasEq(profileLookup?.where, "agent_profiles.slug", "research")).toBe(
      true,
    );

    expect(dbState.insertCalls).toHaveLength(1);
    const inserted = dbState.insertCalls[0].values as Record<string, unknown>;
    expect(inserted.slug).toBe("research");
    expect(inserted.source_space_id).toBeUndefined();
  });

  it("delete removes only the central row for the slug", async () => {
    const removed = await deleteAgentProfileProjectionForFile({
      tenantId: TENANT_ID,
      path: "agents/research.md",
    });

    expect(removed).toBe(true);
    expect(dbState.deleteCalls).toHaveLength(1);
    const { where } = dbState.deleteCalls[0];
    expect(hasIsNull(where, "agent_profiles.source_space_id")).toBe(true);
    expect(hasEq(where, "agent_profiles.slug", "research")).toBe(true);
    expect(hasEq(where, "agent_profiles.tenant_id", TENANT_ID)).toBe(true);
  });
});

describe("space-local agent profile projection (plan 2026-06-12-002 U7)", () => {
  it("creates a row scoped to the Space and assigns it to exactly that Space", async () => {
    dbState.selectResults.push([{ model_id: MODEL_ID }]); // model availability
    dbState.selectResults.push([]); // existing space-local lookup → insert

    const row = await upsertSpaceAgentProfileProjectionFromFile({
      tenantId: TENANT_ID,
      spaceId: SPACE_ID,
      path: "agents/research.md",
      content: VALID_CONTENT,
    });

    const profileLookup = dbState.selectCalls.find(
      (call) =>
        (call.table as { __table?: string }).__table === "agent_profiles",
    );
    expect(
      hasEq(profileLookup?.where, "agent_profiles.source_space_id", SPACE_ID),
    ).toBe(true);

    expect(dbState.insertCalls.length).toBeGreaterThanOrEqual(1);
    const inserted = dbState.insertCalls[0].values as Record<string, unknown>;
    expect(inserted.source_space_id).toBe(SPACE_ID);
    expect(inserted.built_in_key).toBeNull();
    expect(inserted.slug).toBe("research");
    expect(row).toMatchObject({ slug: "research" });

    // Assignments replaced with exactly the origin Space.
    const assignmentDelete = dbState.deleteCalls.find(
      (call) =>
        (call.table as { __table?: string }).__table ===
        "agent_profile_space_assignments",
    );
    expect(assignmentDelete).toBeDefined();
    const assignmentInsert = dbState.insertCalls.find(
      (call) =>
        (call.table as { __table?: string }).__table ===
        "agent_profile_space_assignments",
    );
    expect(assignmentInsert?.values).toEqual([
      {
        tenant_id: TENANT_ID,
        profile_id: "inserted-id",
        space_id: SPACE_ID,
      },
    ]);
  });

  it("updates the existing space-local row on re-put", async () => {
    dbState.selectResults.push([{ model_id: MODEL_ID }]); // model availability
    dbState.selectResults.push([
      { id: "existing-space-profile", built_in_key: "stale" },
    ]); // existing space-local row

    await upsertSpaceAgentProfileProjectionFromFile({
      tenantId: TENANT_ID,
      spaceId: SPACE_ID,
      path: "agents/research.md",
      content: VALID_CONTENT,
    });

    expect(dbState.updateCalls).toHaveLength(1);
    const update = dbState.updateCalls[0];
    expect(
      hasEq(update.where, "agent_profiles.id", "existing-space-profile"),
    ).toBe(true);
    const values = update.values as Record<string, unknown>;
    expect(values.source_space_id).toBe(SPACE_ID);
    expect(values.built_in_key).toBeNull();
  });

  it("skips projection on malformed frontmatter — no partial row", async () => {
    await expect(
      upsertSpaceAgentProfileProjectionFromFile({
        tenantId: TENANT_ID,
        spaceId: SPACE_ID,
        path: "agents/research.md",
        content: "No frontmatter here.\n",
      }),
    ).rejects.toThrow(/requires frontmatter/);

    expect(dbState.selectCalls).toHaveLength(0);
    expect(dbState.insertCalls).toHaveLength(0);
    expect(dbState.updateCalls).toHaveLength(0);
  });

  it("rejects unavailable models without writing a row", async () => {
    dbState.selectResults.push([]); // model availability → not available

    await expect(
      upsertSpaceAgentProfileProjectionFromFile({
        tenantId: TENANT_ID,
        spaceId: SPACE_ID,
        path: "agents/research.md",
        content: VALID_CONTENT,
      }),
    ).rejects.toThrow(/Model is not available/);

    expect(dbState.insertCalls).toHaveLength(0);
    expect(dbState.updateCalls).toHaveLength(0);
  });

  it("delete removes only the space-local row for that Space", async () => {
    const removed = await deleteSpaceAgentProfileProjectionForFile({
      tenantId: TENANT_ID,
      spaceId: SPACE_ID,
      path: "agents/research.md",
    });

    expect(removed).toBe(true);
    expect(dbState.deleteCalls).toHaveLength(1);
    const { where } = dbState.deleteCalls[0];
    expect(hasEq(where, "agent_profiles.source_space_id", SPACE_ID)).toBe(true);
    expect(hasEq(where, "agent_profiles.slug", "research")).toBe(true);
    expect(hasIsNull(where, "agent_profiles.source_space_id")).toBe(false);
  });

  it("delete ignores non-profile paths", async () => {
    const removed = await deleteSpaceAgentProfileProjectionForFile({
      tenantId: TENANT_ID,
      spaceId: SPACE_ID,
      path: "knowledge/notes.md",
    });

    expect(removed).toBe(false);
    expect(dbState.deleteCalls).toHaveLength(0);
  });
});
