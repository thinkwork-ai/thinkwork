/**
 * Agent Profile resolver tests (subagent-folders U11).
 *
 * The resolvers are folder-backed: reads come from the workspace
 * agent-folder index (`agents/<slug>/INSTRUCTIONS.md`), writes go through
 * the folder-write path. No `agent_profiles` rows anywhere — the retired
 * DB store is covered by the grep gate in
 * `src/__tests__/agent-profiles-retirement.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireAdminOrServiceCaller,
  mockGetTenantModelCatalogEntry,
  mockListAgentFolderProfiles,
  mockGetAgentFolderProfile,
  mockWriteAgentProfileFolder,
  mockDeleteAgentProfileFolderInstructions,
  mockDeleteAgentProfileFile,
} = vi.hoisted(() => ({
  mockRequireAdminOrServiceCaller: vi.fn(),
  mockGetTenantModelCatalogEntry: vi.fn(),
  mockListAgentFolderProfiles: vi.fn(),
  mockGetAgentFolderProfile: vi.fn(),
  mockWriteAgentProfileFolder: vi.fn(),
  mockDeleteAgentProfileFolderInstructions: vi.fn(),
  mockDeleteAgentProfileFile: vi.fn(),
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mockRequireAdminOrServiceCaller,
}));

vi.mock("../../utils.js", () => ({
  snakeToCamel: (row: Record<string, unknown>) => row,
}));

vi.mock("../../../lib/agent-profile-workspace-files.js", () => ({
  listAgentFolderProfilesForTenant: mockListAgentFolderProfiles,
  getAgentFolderProfileForTenant: mockGetAgentFolderProfile,
  writeAgentProfileFolderForTenant: mockWriteAgentProfileFolder,
  deleteAgentProfileFolderInstructionsForTenant:
    mockDeleteAgentProfileFolderInstructions,
  deleteAgentProfileFileForTenant: mockDeleteAgentProfileFile,
}));

vi.mock("../../../lib/model-catalog/tenant-catalog.js", () => ({
  getTenantModelCatalogEntry: mockGetTenantModelCatalogEntry,
}));

import { agentProfiles } from "./agentProfiles.query.js";
import { agentProfile } from "./agentProfile.query.js";
import { createAgentProfile } from "./createAgentProfile.mutation.js";
import { updateAgentProfile } from "./updateAgentProfile.mutation.js";
import { deleteAgentProfile } from "./deleteAgentProfile.mutation.js";
import type { GraphQLContext } from "../../context.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const ctx = {} as GraphQLContext;

function folderProfile(
  slug: string,
  configOverrides: Record<string, unknown> = {},
) {
  return {
    slug,
    config: {
      slug,
      description: `${slug} description`,
      enabled: true,
      execution: { foreground: true, clarify: false, loopPolicy: {} },
      instructions: `${slug} instructions`,
      ...configOverrides,
    },
    updatedAt: new Date("2026-07-15T00:00:00.000Z"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdminOrServiceCaller.mockResolvedValue(undefined);
  mockGetTenantModelCatalogEntry.mockResolvedValue({ modelId: "m-1" });
  mockListAgentFolderProfiles.mockResolvedValue([]);
  mockGetAgentFolderProfile.mockResolvedValue(null);
  mockWriteAgentProfileFolder.mockResolvedValue(true);
  mockDeleteAgentProfileFolderInstructions.mockResolvedValue(true);
  mockDeleteAgentProfileFile.mockResolvedValue(true);
});

describe("agentProfiles listing (folder index)", () => {
  it("maps folder profiles onto the GraphQL shape with slug identity", async () => {
    mockListAgentFolderProfiles.mockResolvedValue([
      folderProfile("research", { model: "us.anthropic.claude-sonnet-4-6" }),
      folderProfile("deal-desk"),
    ]);
    const result = await agentProfiles(null, { tenantId: TENANT_ID }, ctx);
    expect(result.map((p: { id: string }) => p.id)).toEqual([
      "deal-desk",
      "research",
    ]);
    const research = result.find(
      (p: { slug: string }) => p.slug === "research",
    );
    expect(research).toMatchObject({
      id: "research",
      tenantId: TENANT_ID,
      name: "Research",
      builtInKey: "research",
      modelId: "us.anthropic.claude-sonnet-4-6",
      enabled: true,
      skillPolicy: { skillSlugs: [] },
    });
    const custom = result.find((p: { slug: string }) => p.slug === "deal-desk");
    expect(custom).toMatchObject({
      id: "deal-desk",
      name: "Deal Desk",
      builtInKey: null,
    });
  });

  it("includeDisabled=false filters disabled folder profiles", async () => {
    mockListAgentFolderProfiles.mockResolvedValue([
      folderProfile("research"),
      folderProfile("paused", { enabled: false }),
    ]);
    const result = await agentProfiles(
      null,
      { tenantId: TENANT_ID, includeDisabled: false },
      ctx,
    );
    expect(result.map((p: { slug: string }) => p.slug)).toEqual(["research"]);
  });

  it("degrades to an empty list when the workspace is unresolvable", async () => {
    mockListAgentFolderProfiles.mockResolvedValue(null);
    const result = await agentProfiles(null, { tenantId: TENANT_ID }, ctx);
    expect(result).toEqual([]);
  });
});

describe("agentProfile lookup", () => {
  it("resolves by slug — id and slug are the same identifier", async () => {
    mockGetAgentFolderProfile.mockResolvedValue(folderProfile("deal-desk"));
    const bySlug = await agentProfile(
      null,
      { tenantId: TENANT_ID, slug: "deal-desk" },
      ctx,
    );
    expect(bySlug).toMatchObject({ id: "deal-desk", slug: "deal-desk" });
    const byId = await agentProfile(
      null,
      { tenantId: TENANT_ID, id: "deal-desk" },
      ctx,
    );
    expect(byId).toMatchObject({ id: "deal-desk" });
    expect(mockGetAgentFolderProfile).toHaveBeenCalledWith(
      TENANT_ID,
      "deal-desk",
    );
  });

  it("returns null for an absent folder", async () => {
    const result = await agentProfile(
      null,
      { tenantId: TENANT_ID, slug: "ghost" },
      ctx,
    );
    expect(result).toBeNull();
  });

  it("requires id or slug", async () => {
    await expect(
      agentProfile(null, { tenantId: TENANT_ID }, ctx),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });
});

describe("createAgentProfile (folder write only)", () => {
  it("writes the folder form and returns the read-back profile", async () => {
    mockGetAgentFolderProfile.mockResolvedValue(folderProfile("deal-desk"));
    const result = await createAgentProfile(
      null,
      {
        tenantId: TENANT_ID,
        input: {
          name: "Deal Desk",
          instructions: "Review deals.",
          modelId: "m-1",
          toolPolicy: JSON.stringify({ builtInTools: ["web-search"] }),
        },
      },
      ctx,
    );
    expect(mockWriteAgentProfileFolder).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        slug: "deal-desk",
        source: expect.objectContaining({
          slug: "deal-desk",
          instructions: "Review deals.",
          modelId: "m-1",
        }),
      }),
    );
    expect(result).toMatchObject({ id: "deal-desk", slug: "deal-desk" });
  });

  it("rejects an explicit slug that already exists", async () => {
    mockListAgentFolderProfiles.mockResolvedValue([folderProfile("deal-desk")]);
    await expect(
      createAgentProfile(
        null,
        {
          tenantId: TENANT_ID,
          input: {
            slug: "deal-desk",
            name: "Deal Desk",
            instructions: "x",
            modelId: "m-1",
          },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(mockWriteAgentProfileFolder).not.toHaveBeenCalled();
  });

  it("rejects reserved built-in slugs", async () => {
    await expect(
      createAgentProfile(
        null,
        {
          tenantId: TENANT_ID,
          input: {
            slug: "research",
            name: "Research",
            instructions: "x",
            modelId: "m-1",
          },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });

  it("auto-suffixes a name-derived slug when it collides (repeat default create)", async () => {
    mockListAgentFolderProfiles.mockResolvedValue([
      folderProfile("new-agent-profile"),
    ]);
    mockGetAgentFolderProfile.mockResolvedValue(
      folderProfile("new-agent-profile-2"),
    );
    const result = await createAgentProfile(
      null,
      {
        tenantId: TENANT_ID,
        input: {
          name: "New Agent Profile",
          instructions: "x",
          modelId: "m-1",
        },
      },
      ctx,
    );
    expect(mockWriteAgentProfileFolder).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "new-agent-profile-2" }),
    );
    expect(result).toMatchObject({ id: "new-agent-profile-2" });
  });

  it("rejects a model that is not in the tenant catalog", async () => {
    mockGetTenantModelCatalogEntry.mockResolvedValue(null);
    await expect(
      createAgentProfile(
        null,
        {
          tenantId: TENANT_ID,
          input: { name: "X", instructions: "x", modelId: "nope" },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });
});

describe("updateAgentProfile (folder write only)", () => {
  it("rewrites the folder file and removes the legacy agents/<slug>.md (delete-on-write)", async () => {
    mockGetAgentFolderProfile.mockResolvedValue(folderProfile("deal-desk"));
    const result = await updateAgentProfile(
      null,
      {
        tenantId: TENANT_ID,
        id: "deal-desk",
        input: { instructions: "Updated.", enabled: false },
      },
      ctx,
    );
    expect(mockWriteAgentProfileFolder).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "deal-desk",
        source: expect.objectContaining({
          instructions: "Updated.",
          enabled: false,
        }),
      }),
    );
    expect(mockDeleteAgentProfileFile).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      slug: "deal-desk",
    });
    expect(result).toMatchObject({ id: "deal-desk" });
  });

  it("renames a custom profile: writes the new folder, deletes the old forms", async () => {
    mockGetAgentFolderProfile
      .mockResolvedValueOnce(folderProfile("deal-desk")) // existing lookup
      .mockResolvedValueOnce(null) // clash check for the new slug
      .mockResolvedValueOnce(folderProfile("deal-review")); // read-back
    await updateAgentProfile(
      null,
      {
        tenantId: TENANT_ID,
        id: "deal-desk",
        input: { slug: "deal-review" },
      },
      ctx,
    );
    expect(mockWriteAgentProfileFolder).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "deal-review" }),
    );
    expect(mockDeleteAgentProfileFolderInstructions).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      slug: "deal-desk",
    });
    expect(mockDeleteAgentProfileFile).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      slug: "deal-desk",
    });
  });

  it("refuses to change built-in profile identity", async () => {
    mockGetAgentFolderProfile.mockResolvedValue(folderProfile("research"));
    await expect(
      updateAgentProfile(
        null,
        {
          tenantId: TENANT_ID,
          id: "research",
          input: { slug: "renamed" },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });

  it("404s an unknown profile folder", async () => {
    await expect(
      updateAgentProfile(
        null,
        { tenantId: TENANT_ID, id: "ghost", input: {} },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });
});

describe("deleteAgentProfile (folder write only)", () => {
  it("deletes custom profiles: folder INSTRUCTIONS.md + legacy file", async () => {
    mockGetAgentFolderProfile.mockResolvedValue(folderProfile("deal-desk"));
    const result = await deleteAgentProfile(
      null,
      { tenantId: TENANT_ID, id: "deal-desk" },
      ctx,
    );
    expect(result).toBe(true);
    expect(mockDeleteAgentProfileFolderInstructions).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      slug: "deal-desk",
    });
    expect(mockDeleteAgentProfileFile).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      slug: "deal-desk",
    });
  });

  it("refuses to delete built-in profiles", async () => {
    await expect(
      deleteAgentProfile(null, { tenantId: TENANT_ID, id: "research" }, ctx),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(mockDeleteAgentProfileFolderInstructions).not.toHaveBeenCalled();
  });

  it("404s an unknown profile folder", async () => {
    await expect(
      deleteAgentProfile(null, { tenantId: TENANT_ID, id: "ghost" }, ctx),
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });
});
