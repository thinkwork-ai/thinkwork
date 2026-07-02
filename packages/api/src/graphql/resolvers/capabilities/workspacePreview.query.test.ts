/**
 * workspacePreview / workspacePreviewFile resolver tests (Composer plan U1).
 *
 * The composer itself (renderWorkspaceTuple persist:false purity, generated
 * content byte-parity) is covered in compose-tuple.test.ts; these tests
 * cover the resolvers' contract: authz, selection validation and defaulting,
 * perspective semantics, tree mapping (owner/generated flags), server-side
 * key derivation, prefix containment, and generated-content sourcing from
 * the in-memory compose result.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  rowsQueue,
  mockRequireAdminOrServiceCaller,
  mockRenderWorkspaceTuple,
  mockGetText,
} = vi.hoisted(() => ({
  rowsQueue: [] as unknown[][],
  mockRequireAdminOrServiceCaller: vi.fn(),
  mockRenderWorkspaceTuple: vi.fn(),
  mockGetText: vi.fn(),
}));

function takeRows(): unknown[] {
  return rowsQueue.shift() ?? [];
}

function chainResult() {
  const promise = Promise.resolve(takeRows());
  const chain = {
    limit: () => promise,
    orderBy: () => chain,
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
  return chain;
}

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => chainResult() }) }),
  },
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...preds: unknown[]) => ({ op: "and", preds }),
  agents: {
    id: "agents.id",
    tenant_id: "agents.tenant_id",
    is_platform_default: "agents.is_platform_default",
    runtime_config: "agents.runtime_config",
  },
  spaces: {
    id: "spaces.id",
    tenant_id: "spaces.tenant_id",
    status: "spaces.status",
  },
  users: { id: "users.id", tenant_id: "users.tenant_id" },
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mockRequireAdminOrServiceCaller,
}));

vi.mock("../../../lib/workspace-renderer/compose-tuple.js", () => ({
  renderWorkspaceTuple: mockRenderWorkspaceTuple,
}));

vi.mock("../../../lib/workspace-renderer/s3-store.js", () => ({
  S3WorkspaceRendererObjectStore: class {
    getText = mockGetText;
  },
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {},
}));

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: (key: string) =>
    key === "WORKSPACE_BUCKET" ? "workspace-bucket" : undefined,
}));

import {
  workspacePreview,
  workspacePreviewFile,
} from "./workspacePreview.query.js";
import { spaceTriggerServiceIdentity } from "../../../lib/workspace-renderer/space-membership-check.js";
import { WorkspaceRenderError } from "../../../lib/workspace-renderer/types.js";
import type { GraphQLContext } from "../../context.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_ID = "22222222-2222-2222-2222-222222222222";
const SPACE_ID = "33333333-3333-3333-3333-333333333333";
const USER_ID = "55555555-5555-5555-5555-555555555555";

const ctx = {} as GraphQLContext;

const AGENT_PREFIX = "tenants/acme/agents/ada/";
const SPACE_PREFIX = "tenants/acme/spaces/customer-success/";
const USER_PREFIX = "tenants/acme/users/dana/";

function manifestFile(overrides: Record<string, unknown> = {}) {
  return {
    path: "skills/renewal-prep/SKILL.md",
    owner: "agent",
    sourceKey: `${AGENT_PREFIX}skills/renewal-prep/SKILL.md`,
    sourcePrefix: AGENT_PREFIX,
    sourcePath: "skills/renewal-prep/SKILL.md",
    readOnly: false,
    size: 42,
    ...overrides,
  };
}

function renderedTuple(overrides: Record<string, unknown> = {}) {
  return {
    renderedPrefix: "tenants/acme/threads/thread/",
    cacheStatus: "miss",
    sourcePrefixes: [
      AGENT_PREFIX,
      SPACE_PREFIX,
      USER_PREFIX,
      "tenants/acme/threads/thread/",
    ],
    writtenFiles: [],
    hydrateManifest: {
      version: 1,
      renderedPrefix: "tenants/acme/threads/thread/",
      generatedAt: "2026-07-02T10:00:00.000Z",
      sources: [],
      files: [
        {
          path: "AGENTS.md",
          owner: "agent",
          sourceKey: "tenants/acme/threads/thread/AGENTS.md",
          sourcePrefix: "tenants/acme/threads/thread/",
          sourcePath: "AGENTS.md",
          readOnly: true,
          generated: true,
          size: 120,
        },
        manifestFile(),
        manifestFile({
          path: "Spaces/customer-success/CONTEXT.md",
          owner: "space",
          sourceKey: `${SPACE_PREFIX}CONTEXT.md`,
          sourcePrefix: SPACE_PREFIX,
          sourcePath: "CONTEXT.md",
          size: 17,
        }),
        manifestFile({
          path: "User/USER.md",
          owner: "user",
          sourceKey: `${USER_PREFIX}USER.md`,
          sourcePrefix: USER_PREFIX,
          sourcePath: "USER.md",
          size: 9,
        }),
      ],
      statusMounts: [],
    },
    activeSpace: {
      id: SPACE_ID,
      slug: "customer-success",
      name: "Customer Success",
      isDefault: false,
    },
    effectivePolicy: {},
    user: { id: USER_ID, slug: "dana", name: "Dana" },
    ...overrides,
  };
}

function queueSelection(options: { withUser?: boolean } = {}) {
  rowsQueue.push([{ id: AGENT_ID, runtimeConfig: null }]);
  rowsQueue.push([{ id: SPACE_ID, status: "active" }]);
  if (options.withUser) rowsQueue.push([{ id: USER_ID }]);
}

beforeEach(() => {
  rowsQueue.length = 0;
  mockRequireAdminOrServiceCaller.mockReset().mockResolvedValue(undefined);
  mockRenderWorkspaceTuple.mockReset().mockResolvedValue(renderedTuple());
  mockGetText.mockReset().mockResolvedValue(null);
});

describe("workspacePreview", () => {
  it("rejects non-operator callers", async () => {
    mockRequireAdminOrServiceCaller.mockRejectedValue(
      new Error("Admin role required"),
    );
    await expect(
      workspacePreview(
        null,
        { tenantId: TENANT_ID, agentId: AGENT_ID, spaceId: SPACE_ID },
        ctx,
      ),
    ).rejects.toThrow("Admin role required");
    expect(mockRenderWorkspaceTuple).not.toHaveBeenCalled();
  });

  it("returns invalid_selection for an unknown agent", async () => {
    rowsQueue.push([]);
    const result = await workspacePreview(
      null,
      { tenantId: TENANT_ID, agentId: "unknown-agent", spaceId: SPACE_ID },
      ctx,
    );
    expect(result.state).toBe("invalid_selection");
    expect(result.stateDetail).toContain("agent not found");
    expect(mockRenderWorkspaceTuple).not.toHaveBeenCalled();
  });

  it("returns invalid_selection for an unknown space", async () => {
    rowsQueue.push([{ id: AGENT_ID, runtimeConfig: null }]);
    rowsQueue.push([]);
    const result = await workspacePreview(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID, spaceId: "unknown-space" },
      ctx,
    );
    expect(result.state).toBe("invalid_selection");
    expect(result.stateDetail).toContain("space not found");
  });

  it("returns invalid_selection for an unknown perspective user", async () => {
    rowsQueue.push([{ id: AGENT_ID, runtimeConfig: null }]);
    rowsQueue.push([{ id: SPACE_ID, status: "active" }]);
    rowsQueue.push([]);
    const result = await workspacePreview(
      null,
      {
        tenantId: TENANT_ID,
        agentId: AGENT_ID,
        spaceId: SPACE_ID,
        perspectiveUserId: "unknown-user",
      },
      ctx,
    );
    expect(result.state).toBe("invalid_selection");
    expect(result.stateDetail).toContain("perspective user not found");
  });

  it("maps the hydrate manifest to tree entries with owner/generated flags", async () => {
    queueSelection({ withUser: true });
    const result = await workspacePreview(
      null,
      {
        tenantId: TENANT_ID,
        agentId: AGENT_ID,
        spaceId: SPACE_ID,
        perspectiveUserId: USER_ID,
      },
      ctx,
    );

    expect(result.state).toBe("ok");
    expect(result.noUserBaseline).toBe(false);
    expect(result.files).toEqual([
      { path: "AGENTS.md", owner: "agent", generated: true, size: 120 },
      {
        path: "skills/renewal-prep/SKILL.md",
        owner: "agent",
        generated: false,
        size: 42,
      },
      {
        path: "Spaces/customer-success/CONTEXT.md",
        owner: "space",
        generated: false,
        size: 17,
      },
      { path: "User/USER.md", owner: "user", generated: false, size: 9 },
    ]);

    // persist:false, perspective user carried, no service identity.
    expect(mockRenderWorkspaceTuple).toHaveBeenCalledWith(
      {
        tenantId: TENANT_ID,
        agentId: AGENT_ID,
        spaceId: SPACE_ID,
        userId: USER_ID,
        invokingServiceIdentity: null,
      },
      { persist: false, includeGeneratedContents: false },
    );
  });

  it("renders the no-user baseline through the space-trigger service identity", async () => {
    queueSelection();
    const result = await workspacePreview(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID, spaceId: SPACE_ID },
      ctx,
    );

    expect(result.state).toBe("ok");
    expect(result.noUserBaseline).toBe(true);
    expect(mockRenderWorkspaceTuple).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        invokingServiceIdentity: spaceTriggerServiceIdentity({
          tenantId: TENANT_ID,
          spaceId: SPACE_ID,
        }),
      }),
      { persist: false, includeGeneratedContents: false },
    );
  });

  it("defaults agent to the platform agent and space to the agent default", async () => {
    rowsQueue.push([
      { id: AGENT_ID, runtimeConfig: { defaultSpaceId: SPACE_ID } },
    ]);
    rowsQueue.push([{ id: SPACE_ID, status: "active" }]);
    const result = await workspacePreview(null, { tenantId: TENANT_ID }, ctx);

    expect(result.state).toBe("ok");
    expect(result.agentId).toBe(AGENT_ID);
    expect(result.spaceId).toBe(SPACE_ID);
  });

  it("returns invalid_selection when no space is selected and none is configured", async () => {
    rowsQueue.push([{ id: AGENT_ID, runtimeConfig: null }]);
    const result = await workspacePreview(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID },
      ctx,
    );
    expect(result.state).toBe("invalid_selection");
    expect(result.stateDetail).toContain("no Space selected");
  });

  it("degrades a render failure to resolution_fault with the error code", async () => {
    queueSelection();
    mockRenderWorkspaceTuple.mockRejectedValue(
      new WorkspaceRenderError(
        "AgentBaselineNotFound",
        "No renderable agent workspace files found.",
      ),
    );
    const result = await workspacePreview(
      null,
      { tenantId: TENANT_ID, agentId: AGENT_ID, spaceId: SPACE_ID },
      ctx,
    );
    expect(result.state).toBe("resolution_fault");
    expect(result.stateDetail).toContain("AgentBaselineNotFound");
    expect(result.files).toBeNull();
  });
});

describe("workspacePreviewFile", () => {
  it("rejects non-operator callers", async () => {
    mockRequireAdminOrServiceCaller.mockRejectedValue(
      new Error("Admin role required"),
    );
    await expect(
      workspacePreviewFile(
        null,
        {
          tenantId: TENANT_ID,
          agentId: AGENT_ID,
          spaceId: SPACE_ID,
          path: "AGENTS.md",
        },
        ctx,
      ),
    ).rejects.toThrow("Admin role required");
  });

  it("serves generated files from the in-memory compose result", async () => {
    queueSelection();
    mockRenderWorkspaceTuple.mockResolvedValue(
      renderedTuple({
        generatedFiles: [
          { path: "AGENTS.md", owner: "agent", content: "# Generated bytes" },
        ],
      }),
    );

    const result = await workspacePreviewFile(
      null,
      {
        tenantId: TENANT_ID,
        agentId: AGENT_ID,
        spaceId: SPACE_ID,
        path: "AGENTS.md",
      },
      ctx,
    );

    expect(result.state).toBe("ok");
    expect(result.content).toBe("# Generated bytes");
    expect(result.file).toEqual({
      path: "AGENTS.md",
      owner: "agent",
      generated: true,
      size: 120,
    });
    // Generated content comes from the compose result, never an S3 read.
    expect(mockGetText).not.toHaveBeenCalled();
    expect(mockRenderWorkspaceTuple).toHaveBeenCalledWith(expect.anything(), {
      persist: false,
      includeGeneratedContents: true,
    });
  });

  it("serves source files via the server-derived key from tuple + relative path", async () => {
    queueSelection();
    mockGetText.mockResolvedValue("# Renewal Prep\n");

    const result = await workspacePreviewFile(
      null,
      {
        tenantId: TENANT_ID,
        agentId: AGENT_ID,
        spaceId: SPACE_ID,
        path: "skills/renewal-prep/SKILL.md",
      },
      ctx,
    );

    expect(result.state).toBe("ok");
    expect(result.content).toBe("# Renewal Prep\n");
    expect(mockGetText).toHaveBeenCalledWith({
      bucket: "workspace-bucket",
      key: `${AGENT_PREFIX}skills/renewal-prep/SKILL.md`,
    });
  });

  it("rejects traversal paths before rendering", async () => {
    const result = await workspacePreviewFile(
      null,
      {
        tenantId: TENANT_ID,
        agentId: AGENT_ID,
        spaceId: SPACE_ID,
        path: "../other-tenant/secret.md",
      },
      ctx,
    );
    expect(result.state).toBe("invalid_selection");
    expect(mockRenderWorkspaceTuple).not.toHaveBeenCalled();
    expect(mockGetText).not.toHaveBeenCalled();
  });

  it("rejects a manifest entry resolving outside the tuple's prefixes", async () => {
    queueSelection();
    const tuple = renderedTuple();
    (tuple.hydrateManifest.files as Array<Record<string, unknown>>).push(
      manifestFile({
        path: "escape.md",
        sourceKey: "tenants/other-tenant/agents/x/escape.md",
        sourcePrefix: "tenants/other-tenant/agents/x/",
        sourcePath: "escape.md",
      }),
    );
    mockRenderWorkspaceTuple.mockResolvedValue(tuple);

    const result = await workspacePreviewFile(
      null,
      {
        tenantId: TENANT_ID,
        agentId: AGENT_ID,
        spaceId: SPACE_ID,
        path: "escape.md",
      },
      ctx,
    );

    expect(result.state).toBe("invalid_selection");
    expect(result.stateDetail).toContain("outside the selection");
    expect(mockGetText).not.toHaveBeenCalled();
  });

  it("returns not_found for a path absent from the rendered tree", async () => {
    queueSelection();
    const result = await workspacePreviewFile(
      null,
      {
        tenantId: TENANT_ID,
        agentId: AGENT_ID,
        spaceId: SPACE_ID,
        path: "does/not/exist.md",
      },
      ctx,
    );
    expect(result.state).toBe("not_found");
    expect(mockGetText).not.toHaveBeenCalled();
  });

  it("returns not_found when the source object vanished after the render", async () => {
    queueSelection();
    mockGetText.mockResolvedValue(null);
    const result = await workspacePreviewFile(
      null,
      {
        tenantId: TENANT_ID,
        agentId: AGENT_ID,
        spaceId: SPACE_ID,
        path: "User/USER.md",
      },
      ctx,
    );
    expect(result.state).toBe("not_found");
  });

  it("returns invalid_selection for an unknown selection", async () => {
    rowsQueue.push([]);
    const result = await workspacePreviewFile(
      null,
      {
        tenantId: TENANT_ID,
        agentId: "unknown-agent",
        spaceId: SPACE_ID,
        path: "AGENTS.md",
      },
      ctx,
    );
    expect(result.state).toBe("invalid_selection");
  });
});
