import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSelect,
  mockInsert,
  mockUpdate,
  mockDelete,
  mockRequireAdminOrServiceCaller,
  mockAssertTenantModelAvailable,
  mockGetTenantModelCatalogEntry,
  mockListTenantModelCatalog,
  mockSnakeToCamel,
  mockWriteAgentProfileFile,
  mockDeleteAgentProfileFile,
  mockSerializeAgentProfileFile,
  tables,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockWriteAgentProfileFile: vi.fn(),
  mockDeleteAgentProfileFile: vi.fn(),
  mockSerializeAgentProfileFile: vi.fn(),
  mockRequireAdminOrServiceCaller: vi.fn(),
  mockAssertTenantModelAvailable: vi.fn(),
  mockGetTenantModelCatalogEntry: vi.fn(),
  mockListTenantModelCatalog: vi.fn(),
  mockSnakeToCamel: vi.fn((row: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      result[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
    return result;
  }),
  tables: {
    agentProfiles: {
      id: "agent_profiles.id",
      tenant_id: "agent_profiles.tenant_id",
      slug: "agent_profiles.slug",
      name: "agent_profiles.name",
      enabled: "agent_profiles.enabled",
      built_in_key: "agent_profiles.built_in_key",
      source_space_id: "agent_profiles.source_space_id",
    },
    agentProfileSpaceAssignments: {
      profile_id: "agent_profile_space_assignments.profile_id",
      tenant_id: "agent_profile_space_assignments.tenant_id",
      space_id: "agent_profile_space_assignments.space_id",
    },
    agents: {
      tenant_id: "agents.tenant_id",
      is_platform_default: "agents.is_platform_default",
      model: "agents.model",
    },
    modelCatalog: {
      model_id: "model_catalog.model_id",
      display_name: "model_catalog.display_name",
      is_available: "model_catalog.is_available",
    },
    spaces: {
      id: "spaces.id",
      tenant_id: "spaces.tenant_id",
    },
  },
}));

vi.mock("../../utils.js", () => ({
  agentProfiles: tables.agentProfiles,
  agentProfileSpaceAssignments: tables.agentProfileSpaceAssignments,
  agents: tables.agents,
  modelCatalog: tables.modelCatalog,
  spaces: tables.spaces,
  and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
  asc: vi.fn((column: unknown) => ({ type: "asc", column })),
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
  },
  eq: vi.fn((left: unknown, right: unknown) => ({ type: "eq", left, right })),
  isNull: vi.fn((column: unknown) => ({ type: "isNull", column })),
  inArray: vi.fn((left: unknown, right: unknown[]) => ({
    type: "inArray",
    left,
    right,
  })),
  snakeToCamel: mockSnakeToCamel,
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mockRequireAdminOrServiceCaller,
}));

vi.mock("../../../lib/agent-profile-workspace-files.js", () => ({
  writeAgentProfileFileForTenant: mockWriteAgentProfileFile,
  deleteAgentProfileFileForTenant: mockDeleteAgentProfileFile,
  serializeAgentProfileFile: mockSerializeAgentProfileFile,
}));

vi.mock("../../../lib/model-catalog/tenant-catalog.js", () => ({
  assertTenantModelAvailable: mockAssertTenantModelAvailable,
  getTenantModelCatalogEntry: mockGetTenantModelCatalogEntry,
  listTenantModelCatalog: mockListTenantModelCatalog,
}));

let listMod: typeof import("./agentProfiles.query.js");
let profileMod: typeof import("./agentProfile.query.js");
let createMod: typeof import("./createAgentProfile.mutation.js");
let updateMod: typeof import("./updateAgentProfile.mutation.js");
let deleteMod: typeof import("./deleteAgentProfile.mutation.js");

beforeEach(async () => {
  vi.resetModules();
  mockSelect.mockReset();
  mockInsert.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  mockWriteAgentProfileFile.mockReset();
  mockWriteAgentProfileFile.mockResolvedValue(true);
  mockDeleteAgentProfileFile.mockReset();
  mockDeleteAgentProfileFile.mockResolvedValue(true);
  mockSerializeAgentProfileFile.mockReset();
  mockSerializeAgentProfileFile.mockReturnValue("serialized-profile");
  mockRequireAdminOrServiceCaller.mockReset();
  mockRequireAdminOrServiceCaller.mockResolvedValue(undefined);
  mockAssertTenantModelAvailable.mockReset();
  mockAssertTenantModelAvailable.mockResolvedValue({ modelId: "model-fast" });
  mockGetTenantModelCatalogEntry.mockReset();
  mockGetTenantModelCatalogEntry.mockResolvedValue({ modelId: "model-parent" });
  mockListTenantModelCatalog.mockReset();
  mockListTenantModelCatalog.mockResolvedValue([{ modelId: "model-fast" }]);
  mockSnakeToCamel.mockClear();
  listMod = await import("./agentProfiles.query.js");
  profileMod = await import("./agentProfile.query.js");
  createMod = await import("./createAgentProfile.mutation.js");
  updateMod = await import("./updateAgentProfile.mutation.js");
  deleteMod = await import("./deleteAgentProfile.mutation.js");
});

describe("Agent Profile resolvers", () => {
  it("seeds missing built-in profiles before listing tenant profiles", async () => {
    mockSelect
      .mockReturnValueOnce(queryRows([]))
      .mockReturnValueOnce(queryRows([{ model: "model-parent" }]))
      .mockReturnValueOnce(
        queryRows([
          {
            id: "profile-research",
            tenant_id: "tenant-1",
            slug: "research",
            name: "Research",
            model_id: "model-parent",
            enabled: true,
            built_in_key: "research",
            tool_policy: {},
            skill_policy: {},
            execution_controls: {},
          },
        ]),
      );
    const insertedValues: unknown[] = [];
    mockInsert.mockReturnValueOnce(insertRows(undefined, insertedValues));

    const context = ctx();
    const result = await listMod.agentProfiles(
      null,
      { tenantId: "tenant-1" },
      context,
    );

    expect(mockRequireAdminOrServiceCaller).toHaveBeenCalledWith(
      context,
      "tenant-1",
      "agent_profiles:read",
    );
    expect(insertedValues).toHaveLength(4);
    expect(insertedValues[0]).toMatchObject({
      tenant_id: "tenant-1",
      slug: "research",
      model_id: "model-parent",
      built_in_key: "research",
    });
    expect(insertedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenant_id: "tenant-1",
          slug: "analyst",
          name: "Analyst",
          model_id: "model-parent",
          built_in_key: "analyst",
          tool_policy: expect.objectContaining({
            builtInTools: ["execute_code", "file_read"],
          }),
        }),
        expect.objectContaining({
          tenant_id: "tenant-1",
          slug: "reviewer",
          name: "Reviewer",
          model_id: "model-parent",
          built_in_key: "reviewer",
          execution_controls: expect.objectContaining({
            reviewGate: true,
            maxReviewLoops: 2,
            loopPolicy: expect.objectContaining({
              mode: "closed",
              enabled: true,
              reviewGate: true,
              maxReviewLoops: 2,
              externalReviewerPolicy: "never",
              failBehavior: "return_blocker",
            }),
          }),
        }),
      ]),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: "profile-research",
        tenantId: "tenant-1",
        builtInKey: "research",
      }),
    ]);
  });

  it("merges new required built-in tools into existing built-in profiles", async () => {
    mockSelect
      .mockReturnValueOnce(
        queryRows([
          {
            id: "profile-research",
            builtInKey: "research",
            toolPolicy: { builtInTools: ["web-search", "web-extract"] },
          },
          {
            id: "profile-coding",
            builtInKey: "coding",
            toolPolicy: { builtInTools: ["execute_code", "bash"] },
          },
          {
            id: "profile-analyst",
            builtInKey: "analyst",
            toolPolicy: { builtInTools: [] },
          },
          {
            id: "profile-reviewer",
            builtInKey: "reviewer",
            toolPolicy: { builtInTools: [] },
          },
        ]),
      )
      .mockReturnValueOnce(
        queryRows([
          {
            id: "profile-analyst",
            tenant_id: "tenant-1",
            slug: "analyst",
            name: "Analyst",
            model_id: "moonshotai.kimi-k2.5",
            enabled: true,
            built_in_key: "analyst",
            tool_policy: {
              builtInTools: ["execute_code", "file_read"],
            },
            skill_policy: {},
            execution_controls: {},
          },
        ]),
      );
    const updates: Array<Record<string, unknown>> = [];
    mockUpdate.mockReturnValue(updateRows(updates));

    const result = await listMod.agentProfiles(
      null,
      { tenantId: "tenant-1" },
      ctx(),
    );

    expect(mockInsert).not.toHaveBeenCalled();
    expect(updates).toEqual([
      {
        tool_policy: {
          builtInTools: ["execute_code", "file_read"],
        },
        updated_at: expect.any(Date),
      },
    ]);
    expect(result).toEqual([
      expect.objectContaining({
        id: "profile-analyst",
        modelId: "moonshotai.kimi-k2.5",
      }),
    ]);
  });

  it("creates a custom profile and replaces its Space assignments", async () => {
    mockSelect
      .mockReturnValueOnce(
        queryRows([
          { builtInKey: "research" },
          { builtInKey: "coding" },
          { builtInKey: "analyst" },
          { builtInKey: "reviewer" },
        ]),
      )
      .mockReturnValueOnce(queryRows([{ id: "space-1" }]));
    const insertedProfileValues: unknown[] = [];
    const insertedAssignmentValues: unknown[] = [];
    mockInsert
      .mockReturnValueOnce(
        insertRows(
          [
            {
              id: "profile-custom",
              tenant_id: "tenant-1",
              slug: "fast-research",
              name: "Fast Research",
              model_id: "model-fast",
              enabled: true,
              built_in_key: null,
              tool_policy: { builtInTools: ["web-search"] },
              skill_policy: {},
              execution_controls: {},
            },
          ],
          insertedProfileValues,
        ),
      )
      .mockReturnValueOnce(insertRows(undefined, insertedAssignmentValues));
    mockDelete.mockReturnValueOnce(deleteRows());

    const result = await createMod.createAgentProfile(
      null,
      {
        tenantId: "tenant-1",
        input: {
          slug: "Fast Research",
          name: "Fast Research",
          instructions: "Go find it.",
          modelId: "model-fast",
          toolPolicy: JSON.stringify({ builtInTools: ["web-search"] }),
          executionControls: JSON.stringify({
            reviewGate: true,
            maxReviewLoops: 2,
          }),
          spaceIds: ["space-1"],
        },
      },
      ctx(),
    );

    expect(insertedProfileValues[0]).toMatchObject({
      tenant_id: "tenant-1",
      slug: "fast-research",
      model_id: "model-fast",
      built_in_key: null,
      execution_controls: expect.objectContaining({
        reviewGate: true,
        maxReviewLoops: 2,
        loopPolicy: expect.objectContaining({
          mode: "closed",
          reviewGate: true,
          maxReviewLoops: 2,
        }),
      }),
    });
    expect(insertedAssignmentValues).toEqual([
      {
        tenant_id: "tenant-1",
        profile_id: "profile-custom",
        space_id: "space-1",
      },
    ]);
    expect(result).toMatchObject({
      id: "profile-custom",
      slug: "fast-research",
      modelId: "model-fast",
    });
  });

  it("refuses to change built-in profile identity", async () => {
    mockSelect
      .mockReturnValueOnce(
        queryRows([
          { builtInKey: "research" },
          { builtInKey: "coding" },
          { builtInKey: "analyst" },
          { builtInKey: "reviewer" },
        ]),
      )
      .mockReturnValueOnce(
        queryRows([
          {
            id: "profile-research",
            tenant_id: "tenant-1",
            slug: "research",
            built_in_key: "research",
          },
        ]),
      );

    await expect(
      updateMod.updateAgentProfile(
        null,
        {
          tenantId: "tenant-1",
          id: "profile-research",
          input: { slug: "research-renamed" },
        },
        ctx(),
      ),
    ).rejects.toThrow("Built-in Agent Profile slug cannot be changed");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("refuses to delete built-in profiles", async () => {
    mockSelect
      .mockReturnValueOnce(
        queryRows([
          { builtInKey: "research" },
          { builtInKey: "coding" },
          { builtInKey: "analyst" },
          { builtInKey: "reviewer" },
        ]),
      )
      .mockReturnValueOnce(
        queryRows([
          {
            id: "profile-research",
            tenant_id: "tenant-1",
            slug: "research",
            built_in_key: "research",
          },
        ]),
      );

    await expect(
      deleteMod.deleteAgentProfile(
        null,
        { tenantId: "tenant-1", id: "profile-research" },
        ctx(),
      ),
    ).rejects.toThrow("Built-in Agent Profiles can be disabled");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("scopes single-profile slug lookups to central profiles", async () => {
    mockSelect
      .mockReturnValueOnce(queryRows(builtInKeyRows()))
      .mockReturnValueOnce(
        queryRows([
          {
            id: "profile-central",
            tenant_id: "tenant-1",
            slug: "fast-research",
            source_space_id: null,
          },
        ]),
      );

    const result = await profileMod.agentProfile(
      null,
      { tenantId: "tenant-1", slug: "fast-research" },
      ctx(),
    );

    const utils = await import("../../utils.js");
    // The slug selector must exclude space-local rows: a space-local profile
    // can legally share the slug (partial unique indexes split on
    // source_space_id), so an unscoped match is nondeterministic.
    expect(vi.mocked(utils.isNull)).toHaveBeenCalledWith(
      tables.agentProfiles.source_space_id,
    );
    expect(result).toMatchObject({
      id: "profile-central",
      slug: "fast-research",
    });
  });

  it("refuses to update space-local profiles from central settings", async () => {
    mockSelect
      .mockReturnValueOnce(queryRows(builtInKeyRows()))
      .mockReturnValueOnce(
        queryRows([
          {
            id: "profile-local",
            tenant_id: "tenant-1",
            slug: "fast-research",
            built_in_key: null,
            source_space_id: "space-1",
          },
        ]),
      );

    await expect(
      updateMod.updateAgentProfile(
        null,
        {
          tenantId: "tenant-1",
          id: "profile-local",
          input: { name: "Renamed" },
        },
        ctx(),
      ),
    ).rejects.toThrow(
      "Space-local Agent Profiles are managed from their Space's workspace files",
    );
    expect(mockUpdate).not.toHaveBeenCalled();
    // The central agents/<slug>.md must never be written for a space-local
    // row — that would mint a phantom central profile via the put hook.
    expect(mockWriteAgentProfileFile).not.toHaveBeenCalled();
    expect(mockDeleteAgentProfileFile).not.toHaveBeenCalled();
  });

  it("refuses to delete space-local profiles from central settings", async () => {
    mockSelect
      .mockReturnValueOnce(queryRows(builtInKeyRows()))
      .mockReturnValueOnce(
        queryRows([
          {
            id: "profile-local",
            tenant_id: "tenant-1",
            slug: "fast-research",
            built_in_key: null,
            source_space_id: "space-1",
          },
        ]),
      );

    await expect(
      deleteMod.deleteAgentProfile(
        null,
        { tenantId: "tenant-1", id: "profile-local" },
        ctx(),
      ),
    ).rejects.toThrow(
      "Space-local Agent Profiles are managed from their Space's workspace files",
    );
    expect(mockDelete).not.toHaveBeenCalled();
    // Deleting the central agents/<slug>.md would kill a same-slug central
    // profile that the space-local row legally shadows.
    expect(mockDeleteAgentProfileFile).not.toHaveBeenCalled();
  });

  it("still deletes custom central profiles and their central file", async () => {
    mockSelect
      .mockReturnValueOnce(queryRows(builtInKeyRows()))
      .mockReturnValueOnce(
        queryRows([
          {
            id: "profile-custom",
            tenant_id: "tenant-1",
            slug: "fast-research",
            built_in_key: null,
            source_space_id: null,
          },
        ]),
      );
    mockDelete.mockReturnValueOnce(deleteRows());

    const result = await deleteMod.deleteAgentProfile(
      null,
      { tenantId: "tenant-1", id: "profile-custom" },
      ctx(),
    );

    expect(result).toBe(true);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDeleteAgentProfileFile).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      slug: "fast-research",
    });
  });
});

function builtInKeyRows() {
  return [
    { builtInKey: "research" },
    { builtInKey: "coding" },
    { builtInKey: "analyst" },
    { builtInKey: "reviewer" },
  ];
}

function ctx() {
  return { auth: { authType: "cognito" } } as any;
}

function queryRows(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => Promise.resolve(rows),
    then: (resolve: (rows: unknown[]) => unknown) => resolve(rows),
  };
  return chain;
}

function insertRows(returningRows: unknown[] | undefined, captured: unknown[]) {
  const chain = {
    values: (values: unknown | unknown[]) => {
      captured.push(...(Array.isArray(values) ? values : [values]));
      return chain;
    },
    returning: () => Promise.resolve(returningRows ?? []),
    then: (resolve: () => unknown) => resolve(),
  };
  return chain;
}

function deleteRows() {
  const chain = {
    where: () => Promise.resolve(undefined),
  };
  return chain;
}

function updateRows(captured: Array<Record<string, unknown>>) {
  const chain = {
    set: (values: Record<string, unknown>) => {
      captured.push(values);
      return chain;
    },
    where: () => Promise.resolve(undefined),
  };
  return chain;
}
