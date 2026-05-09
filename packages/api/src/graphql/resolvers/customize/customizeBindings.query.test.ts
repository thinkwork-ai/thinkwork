import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockResolveCaller,
  computerRow,
  state,
} = vi.hoisted(() => ({
  mockResolveCaller: vi.fn(),
  computerRow: {
    id: "computer-1",
    primary_agent_id: "agent-primary",
    migrated_from_agent_id: null,
  },
  state: {
    connectorRows: [] as Array<{ catalog_slug: string | null; status: string }>,
    skillRows: [] as Array<{ skill_id: string }>,
    workflowRows: [] as Array<{ catalog_slug: string | null }>,
    computerFound: true,
  },
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: (projection?: Record<string, unknown>) => ({
      from: (table: { __name?: string }) => ({
        where: () => {
          const name = (table as { __name?: string }).__name ?? "computers";
          if (name === "computers") {
            return state.computerFound ? [computerRow] : [];
          }
          if (name === "connectors") return state.connectorRows;
          if (name === "agent_skills") return state.skillRows;
          if (name === "routines") return state.workflowRows;
          return [];
        },
      }),
    }),
  },
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
  ne: (...args: unknown[]) => args,
  isNotNull: (col: unknown) => ({ isNotNull: col }),
  computers: { __name: "computers" },
  connectors: {
    __name: "connectors",
    tenant_id: "tenant_id",
    dispatch_target_type: "dispatch_target_type",
    dispatch_target_id: "dispatch_target_id",
    enabled: "enabled",
    catalog_slug: "catalog_slug",
    status: "status",
  },
  agentSkills: {
    __name: "agent_skills",
    agent_id: "agent_id",
    skill_id: "skill_id",
    enabled: "enabled",
  },
  routines: {
    __name: "routines",
    agent_id: "agent_id",
    status: "status",
    catalog_slug: "catalog_slug",
  },
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCaller: mockResolveCaller,
}));

import { customizeBindings } from "./customizeBindings.query.js";

const ctx = {} as unknown as Parameters<typeof customizeBindings>[2];

describe("customizeBindings.connectedWorkflowSlugs", () => {
  beforeEach(() => {
    mockResolveCaller.mockReset();
    mockResolveCaller.mockResolvedValue({
      userId: "user-1",
      tenantId: "tenant-1",
    });
    state.connectorRows = [];
    state.skillRows = [];
    state.workflowRows = [];
    state.computerFound = true;
    Object.assign(computerRow, {
      primary_agent_id: "agent-primary",
      migrated_from_agent_id: null,
    });
  });

  it("returns slugs for active routines with non-null catalog_slug", async () => {
    state.workflowRows = [
      { catalog_slug: "daily-digest" },
      { catalog_slug: "weekly-report" },
    ];
    const result = await customizeBindings(null, undefined, ctx);
    expect(result?.connectedWorkflowSlugs).toEqual([
      "daily-digest",
      "weekly-report",
    ]);
  });

  it("excludes routines with null catalog_slug", async () => {
    state.workflowRows = [
      { catalog_slug: null },
      { catalog_slug: "daily-digest" },
    ];
    const result = await customizeBindings(null, undefined, ctx);
    expect(result?.connectedWorkflowSlugs).toEqual(["daily-digest"]);
  });

  it("dedupes duplicate slugs", async () => {
    state.workflowRows = [
      { catalog_slug: "daily-digest" },
      { catalog_slug: "daily-digest" },
    ];
    const result = await customizeBindings(null, undefined, ctx);
    expect(result?.connectedWorkflowSlugs).toEqual(["daily-digest"]);
  });

  it("returns empty when the Computer has no resolvable agent", async () => {
    Object.assign(computerRow, {
      primary_agent_id: null,
      migrated_from_agent_id: null,
    });
    state.workflowRows = [{ catalog_slug: "daily-digest" }];
    const result = await customizeBindings(null, undefined, ctx);
    // When agentId is null we never query routines, so the slug above
    // is invisible — the projection stays empty.
    expect(result?.connectedWorkflowSlugs).toEqual([]);
  });

  it("returns null when the caller is unauthenticated", async () => {
    mockResolveCaller.mockResolvedValue({ userId: null, tenantId: null });
    const result = await customizeBindings(null, undefined, ctx);
    expect(result).toBeNull();
  });

  it("returns null when the caller has no Computer", async () => {
    state.computerFound = false;
    const result = await customizeBindings(null, undefined, ctx);
    expect(result).toBeNull();
  });

  it("regression: connector + skill projections still work alongside the new workflows projection", async () => {
    state.connectorRows = [
      { catalog_slug: "slack", status: "active" },
      { catalog_slug: "github", status: "active" },
    ];
    state.skillRows = [{ skill_id: "sales-prep" }];
    state.workflowRows = [{ catalog_slug: "daily-digest" }];
    const result = await customizeBindings(null, undefined, ctx);
    expect(result).toEqual({
      computerId: "computer-1",
      connectedConnectorSlugs: ["slack", "github"],
      connectedSkillIds: ["sales-prep"],
      connectedWorkflowSlugs: ["daily-digest"],
    });
  });
});
