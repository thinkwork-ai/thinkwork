/**
 * grantCapability / detachCapability resolver tests (capability-mapping
 * plan U7).
 *
 * The wrapped machinery (catalog install/uninstall, THINK-114 assignment,
 * the inspector) has its own suites; these tests cover the mutation
 * contract: matrix conformance (R2), authz, per-class write dispatch,
 * in-transaction audit events (none on failure, none on no-op), idempotent
 * re-grant/re-detach, and the fresh-inspector-state response (R12).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  rowsQueue,
  txOps,
  mockRequireAdminOrServiceCaller,
  mockResolveCallerUserId,
  mockEmitAuditEvent,
  mockCapabilityInspector,
  mockUpdatePiExtensionAssignment,
  mockInstallCatalogSkill,
  mockUninstallCatalogSkill,
  mockRegenerateManifest,
  mockParseWiringMd,
  mockGetConfig,
} = vi.hoisted(() => ({
  rowsQueue: [] as unknown[][],
  txOps: [] as Array<{ op: string; tx: unknown; args: unknown }>,
  mockRequireAdminOrServiceCaller: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockEmitAuditEvent: vi.fn(),
  mockCapabilityInspector: vi.fn(),
  mockUpdatePiExtensionAssignment: vi.fn(),
  mockInstallCatalogSkill: vi.fn(),
  mockUninstallCatalogSkill: vi.fn(),
  mockRegenerateManifest: vi.fn(),
  mockParseWiringMd: vi.fn(),
  mockGetConfig: vi.fn(),
}));

function takeRows(): unknown[] {
  return rowsQueue.shift() ?? [];
}

function selectChain() {
  const promise = Promise.resolve(takeRows());
  const withLimit = {
    limit: () => promise,
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
  return withLimit;
}

function makeClient(label: string) {
  const client = {
    label,
    select: () => ({ from: () => ({ where: () => selectChain() }) }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: () => {
          txOps.push({ op: "update", tx: client, args: { table, values } });
          const fail = updateShouldThrow.value;
          if (fail) return Promise.reject(new Error(fail));
          return Promise.resolve([]);
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        txOps.push({ op: "insert", tx: client, args: { table, values } });
        return Promise.resolve([]);
      },
    }),
    delete: (table: unknown) => ({
      where: () => {
        txOps.push({ op: "delete", tx: client, args: { table } });
        return Promise.resolve([]);
      },
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = makeClient(`tx-of-${label}`);
      return fn(tx);
    },
  };
  return client;
}

const updateShouldThrow = { value: "" };

vi.mock("../../utils.js", () => ({
  db: makeClient("db"),
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...preds: unknown[]) => ({ op: "and", preds }),
  agents: {
    id: "agents.id",
    slug: "agents.slug",
    tenant_id: "agents.tenant_id",
    workspace_folder_name: "agents.workspace_folder_name",
    is_platform_default: "agents.is_platform_default",
  },
  tenants: { id: "tenants.id", slug: "tenants.slug" },
  agentProfiles: {
    id: "agentProfiles.id",
    slug: "agentProfiles.slug",
    tenant_id: "agentProfiles.tenant_id",
    source_space_id: "agentProfiles.source_space_id",
    tool_policy: "agentProfiles.tool_policy",
    skill_policy: "agentProfiles.skill_policy",
  },
  skillCatalog: {
    slug: "skillCatalog.slug",
    tenant_id: "skillCatalog.tenant_id",
  },
  tenantMcpServers: {
    id: "tenantMcpServers.id",
    slug: "tenantMcpServers.slug",
    name: "tenantMcpServers.name",
    tenant_id: "tenantMcpServers.tenant_id",
  },
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  agentMcpServers: {
    id: "agentMcpServers.id",
    agent_id: "agentMcpServers.agent_id",
    tenant_id: "agentMcpServers.tenant_id",
    mcp_server_id: "agentMcpServers.mcp_server_id",
    enabled: "agentMcpServers.enabled",
    config: "agentMcpServers.config",
  },
  piExtensionAssignments: {
    id: "piExtensionAssignments.id",
    tenant_id: "piExtensionAssignments.tenant_id",
    version_id: "piExtensionAssignments.version_id",
    target_type: "piExtensionAssignments.target_type",
    agent_profile_id: "piExtensionAssignments.agent_profile_id",
    enabled: "piExtensionAssignments.enabled",
    granted_permissions: "piExtensionAssignments.granted_permissions",
  },
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mockRequireAdminOrServiceCaller,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("../../../lib/compliance/emit.js", () => ({
  emitAuditEvent: mockEmitAuditEvent,
}));

vi.mock("./capabilityInspector.query.js", () => ({
  capabilityInspector: mockCapabilityInspector,
}));

vi.mock("../pi-extensions/updatePiExtensionAssignment.mutation.js", () => ({
  updatePiExtensionAssignment: mockUpdatePiExtensionAssignment,
}));

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: mockGetConfig,
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    async send() {
      return { Body: { transformToString: async () => "# WIRING" } };
    }
  },
  GetObjectCommand: class {},
}));

class FakeCatalogInstallError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CatalogInstallError";
  }
}

class FakeCatalogUninstallError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CatalogUninstallError";
  }
}

vi.mock("../../../lib/catalog-install.js", () => ({
  installCatalogSkill: mockInstallCatalogSkill,
  CatalogInstallError: FakeCatalogInstallError,
}));

vi.mock("../../../lib/catalog-uninstall.js", () => ({
  uninstallCatalogSkill: mockUninstallCatalogSkill,
  CatalogUninstallError: FakeCatalogUninstallError,
}));

vi.mock("../../../lib/workspace-manifest.js", () => ({
  regenerateManifest: mockRegenerateManifest,
}));

vi.mock("../../../lib/wiring-md.js", () => ({
  parseWiringMd: mockParseWiringMd,
}));

import {
  grantCapability,
  detachCapability,
} from "./capabilityAssignment.mutations.js";
import type { GraphQLContext } from "../../context.js";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_ID = "22222222-2222-2222-2222-222222222222";
const PROFILE_ID = "44444444-4444-4444-4444-444444444444";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const SERVER_ID = "66666666-6666-6666-6666-666666666666";
const VERSION_ID = "77777777-7777-7777-7777-777777777777";
const ASSIGNMENT_ID = "88888888-8888-8888-8888-888888888888";

const ctx = {} as GraphQLContext;

const AGENT_ROW = {
  id: AGENT_ID,
  slug: "ada",
  workspace_folder_name: null,
};
const TENANT_ROW = { slug: "acme" };

function cannedInspection(items: unknown[]) {
  return {
    state: "ok",
    agentId: AGENT_ID,
    noUserBaseline: true,
    predicted: {
      variant: "PREDICTED",
      computedAt: "2026-07-02T00:00:00.000Z",
      configFingerprint: "fp-after",
      items,
    },
  };
}

beforeEach(() => {
  rowsQueue.length = 0;
  txOps.length = 0;
  updateShouldThrow.value = "";
  vi.clearAllMocks();
  mockRequireAdminOrServiceCaller.mockResolvedValue(undefined);
  mockResolveCallerUserId.mockResolvedValue(USER_ID);
  mockEmitAuditEvent.mockResolvedValue({ eventId: "evt-1" });
  mockGetConfig.mockReturnValue("workspace-bucket");
  mockCapabilityInspector.mockResolvedValue(cannedInspection([]));
  mockInstallCatalogSkill.mockResolvedValue({ installed_paths: ["SKILL.md"] });
  mockUninstallCatalogSkill.mockResolvedValue({
    ok: true,
    deleted_paths: ["skills/expenses/SKILL.md"],
    context_md_strip: "removed",
  });
  mockRegenerateManifest.mockResolvedValue(undefined);
  mockParseWiringMd.mockReturnValue({ suggestions: [{ id: "default" }] });
  mockUpdatePiExtensionAssignment.mockResolvedValue({ id: "ext-1" });
});

describe("matrix conformance (R2)", () => {
  it("rejects an extension grant at space scope with MATRIX_VIOLATION and writes nothing", async () => {
    await expect(
      grantCapability(
        null,
        {
          input: {
            tenantId: TENANT_ID,
            capabilityClass: "PI_EXTENSION",
            scope: "SPACE",
            capabilityRef: VERSION_ID,
          },
        },
        ctx,
      ),
    ).rejects.toMatchObject({
      extensions: { code: "MATRIX_VIOLATION" },
    });
    expect(mockUpdatePiExtensionAssignment).not.toHaveBeenCalled();
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
    expect(txOps).toHaveLength(0);
  });

  it("rejects skill and MCP grants at user scope", async () => {
    for (const capabilityClass of ["SKILL", "MCP_SERVER"]) {
      await expect(
        grantCapability(
          null,
          {
            input: {
              tenantId: TENANT_ID,
              capabilityClass,
              scope: "USER",
              capabilityRef: "x",
            },
          },
          ctx,
        ),
      ).rejects.toMatchObject({ extensions: { code: "MATRIX_VIOLATION" } });
    }
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });
});

describe("authz", () => {
  it("rejects a non-operator caller before any read", async () => {
    mockRequireAdminOrServiceCaller.mockRejectedValue(new Error("forbidden"));
    await expect(
      grantCapability(
        null,
        {
          input: {
            tenantId: TENANT_ID,
            capabilityClass: "SKILL",
            scope: "AGENT",
            capabilityRef: "expenses",
          },
        },
        ctx,
      ),
    ).rejects.toThrow("forbidden");
    expect(mockInstallCatalogSkill).not.toHaveBeenCalled();
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });
});

describe("skill @ agent (catalog install)", () => {
  it("grant invokes the workspace install, regenerates the manifest, audits, and returns the item's inspector state", async () => {
    rowsQueue.push([AGENT_ROW], [TENANT_ROW]);
    mockCapabilityInspector.mockResolvedValue(
      cannedInspection([
        {
          capabilityClass: "skill",
          capabilityId: "expenses",
          active: true,
          provenance: "agent: workspace folder",
        },
      ]),
    );

    const result = await grantCapability(
      null,
      {
        input: {
          tenantId: TENANT_ID,
          capabilityClass: "SKILL",
          scope: "AGENT",
          agentId: AGENT_ID,
          capabilityRef: "expenses",
          wiringChoice: "default",
        },
      },
      ctx,
    );

    expect(mockInstallCatalogSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "workspace-bucket",
        tenantSlug: "acme",
        targetPrefix: "tenants/acme/agents/ada/",
        slug: "expenses",
        wiringChoice: "default",
      }),
    );
    expect(mockRegenerateManifest).toHaveBeenCalledWith(
      "workspace-bucket",
      "acme",
      "ada",
    );
    expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1);
    const [, auditInput] = mockEmitAuditEvent.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(auditInput).toMatchObject({
      tenantId: TENANT_ID,
      actorId: USER_ID,
      actorType: "user",
      eventType: "skill.granted",
      source: "graphql",
      action: "grant",
      agentId: AGENT_ID,
    });
    expect(result.outcome).toBe("applied");
    expect(result.item).toMatchObject({
      capabilityClass: "skill",
      capabilityId: "expenses",
      active: true,
    });
    expect(result.configFingerprint).toBe("fp-after");
    expect(result.inspectionState).toBe("ok");
    // The fresh state is recomputed for the touched agent selection.
    expect(mockCapabilityInspector).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ tenantId: TENANT_ID, agentId: AGENT_ID }),
      ctx,
    );
  });

  it("idempotent re-grant is a no-op with accurate state and no audit event", async () => {
    rowsQueue.push([AGENT_ROW], [TENANT_ROW]);
    mockInstallCatalogSkill.mockRejectedValue(
      new FakeCatalogInstallError(409, "already_installed", "already there"),
    );
    mockCapabilityInspector.mockResolvedValue(
      cannedInspection([
        { capabilityClass: "skill", capabilityId: "expenses", active: true },
      ]),
    );

    const result = await grantCapability(
      null,
      {
        input: {
          tenantId: TENANT_ID,
          capabilityClass: "SKILL",
          scope: "AGENT",
          agentId: AGENT_ID,
          capabilityRef: "expenses",
          wiringChoice: "default",
        },
      },
      ctx,
    );

    expect(result.outcome).toBe("noop");
    expect(result.item).toMatchObject({ capabilityId: "expenses" });
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
    expect(mockRegenerateManifest).not.toHaveBeenCalled();
  });

  it("detach removes the workspace folder and audits; detaching an absent skill is a no-op", async () => {
    rowsQueue.push([AGENT_ROW], [TENANT_ROW]);
    mockCapabilityInspector.mockResolvedValue(
      cannedInspection([
        {
          capabilityClass: "skill",
          capabilityId: "expenses",
          active: false,
          reason: "not_installed",
        },
      ]),
    );

    const result = await detachCapability(
      null,
      {
        input: {
          tenantId: TENANT_ID,
          capabilityClass: "SKILL",
          scope: "AGENT",
          agentId: AGENT_ID,
          capabilityRef: "expenses",
        },
      },
      ctx,
    );
    expect(mockUninstallCatalogSkill).toHaveBeenCalled();
    expect(result.outcome).toBe("applied");
    // Post-detach state shows the true not-installed row, not a fabricated one.
    expect(result.item).toMatchObject({
      active: false,
      reason: "not_installed",
    });
    expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1);
    expect(
      (mockEmitAuditEvent.mock.calls[0][1] as { eventType: string }).eventType,
    ).toBe("skill.detached");

    // Second detach: nothing left to delete → noop, no event.
    mockEmitAuditEvent.mockClear();
    rowsQueue.push([AGENT_ROW], [TENANT_ROW]);
    mockUninstallCatalogSkill.mockResolvedValue({
      ok: true,
      deleted_paths: [],
      context_md_strip: "catalog_ref_missing",
    });
    const second = await detachCapability(
      null,
      {
        input: {
          tenantId: TENANT_ID,
          capabilityClass: "SKILL",
          scope: "AGENT",
          agentId: AGENT_ID,
          capabilityRef: "expenses",
        },
      },
      ctx,
    );
    expect(second.outcome).toBe("noop");
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });
});

describe("skill @ profile (skill_policy subset)", () => {
  it("grant appends to skill_policy.skillSlugs and audits in the same transaction", async () => {
    rowsQueue.push(
      [{ slug: "expenses" }], // skillCatalog validation
      [
        {
          id: PROFILE_ID,
          slug: "coding",
          source_space_id: null,
          tool_policy: {},
          skill_policy: { skillSlugs: ["existing"] },
        },
      ],
    );

    const result = await grantCapability(
      null,
      {
        input: {
          tenantId: TENANT_ID,
          capabilityClass: "SKILL",
          scope: "AGENT_PROFILE",
          agentProfileId: PROFILE_ID,
          capabilityRef: "expenses",
        },
      },
      ctx,
    );

    const update = txOps.find((op) => op.op === "update");
    expect(update).toBeDefined();
    expect(
      (update!.args as { values: { skill_policy: unknown } }).values
        .skill_policy,
    ).toEqual({ skillSlugs: ["existing", "expenses"] });
    // Audit event rides the SAME transaction handle as the write.
    expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockEmitAuditEvent.mock.calls[0][0]).toBe(update!.tx);
    expect(result.outcome).toBe("applied");
    expect(mockCapabilityInspector).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ agentProfileId: PROFILE_ID }),
      ctx,
    );
  });

  it("a failed write leaves no audit event", async () => {
    rowsQueue.push(
      [{ slug: "expenses" }],
      [
        {
          id: PROFILE_ID,
          slug: "coding",
          source_space_id: null,
          tool_policy: {},
          skill_policy: {},
        },
      ],
    );
    updateShouldThrow.value = "db down";

    await expect(
      grantCapability(
        null,
        {
          input: {
            tenantId: TENANT_ID,
            capabilityClass: "SKILL",
            scope: "AGENT_PROFILE",
            agentProfileId: PROFILE_ID,
            capabilityRef: "expenses",
          },
        },
        ctx,
      ),
    ).rejects.toThrow("db down");
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("space-local profiles are rejected as file-authoritative", async () => {
    rowsQueue.push(
      [{ slug: "expenses" }],
      [
        {
          id: PROFILE_ID,
          slug: "coding",
          source_space_id: "space-1",
          tool_policy: {},
          skill_policy: {},
        },
      ],
    );
    await expect(
      grantCapability(
        null,
        {
          input: {
            tenantId: TENANT_ID,
            capabilityClass: "SKILL",
            scope: "AGENT_PROFILE",
            agentProfileId: PROFILE_ID,
            capabilityRef: "expenses",
          },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });
});

describe("mcp_server @ profile (tool_policy subset)", () => {
  it("grant appends the server slug to tool_policy.mcpServers; the allowlist passes through from the agent-level config", async () => {
    rowsQueue.push(
      [{ id: SERVER_ID, slug: "github", name: "GitHub" }], // registry
      [
        {
          id: PROFILE_ID,
          slug: "coding",
          source_space_id: null,
          tool_policy: { builtInTools: ["search"] },
          skill_policy: {},
        },
      ],
    );
    mockCapabilityInspector.mockResolvedValue(
      cannedInspection([
        {
          capabilityClass: "mcp_server",
          capabilityId: "github",
          active: true,
          provenance: "agent profile coding: tool_policy",
          detail: "allowed tools: issues_read, pulls_read",
        },
      ]),
    );

    const result = await grantCapability(
      null,
      {
        input: {
          tenantId: TENANT_ID,
          capabilityClass: "MCP_SERVER",
          scope: "AGENT_PROFILE",
          agentProfileId: PROFILE_ID,
          capabilityRef: "github",
        },
      },
      ctx,
    );

    const update = txOps.find((op) => op.op === "update");
    expect(
      (update!.args as { values: { tool_policy: unknown } }).values.tool_policy,
    ).toEqual({ builtInTools: ["search"], mcpServers: ["github"] });
    expect(result.item).toMatchObject({
      capabilityId: "github",
      detail: "allowed tools: issues_read, pulls_read",
    });
    expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1);
    expect(
      (mockEmitAuditEvent.mock.calls[0][1] as { eventType: string }).eventType,
    ).toBe("mcp.granted");
  });

  it("rejects a profile-scope toolAllowlist (agent-level config owns it)", async () => {
    await expect(
      grantCapability(
        null,
        {
          input: {
            tenantId: TENANT_ID,
            capabilityClass: "MCP_SERVER",
            scope: "AGENT_PROFILE",
            agentProfileId: PROFILE_ID,
            capabilityRef: "github",
            toolAllowlist: ["issues_read"],
          },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
  });
});

describe("mcp_server @ agent (assignment row)", () => {
  it("detach deletes the assignment and audits; re-detach is a no-op", async () => {
    rowsQueue.push(
      [AGENT_ROW],
      [TENANT_ROW],
      [{ id: SERVER_ID, slug: "github", name: "GitHub" }],
      [{ id: "assign-1", enabled: true, config: null }], // existing row (tx)
    );

    const result = await detachCapability(
      null,
      {
        input: {
          tenantId: TENANT_ID,
          capabilityClass: "MCP_SERVER",
          scope: "AGENT",
          agentId: AGENT_ID,
          capabilityRef: SERVER_ID,
        },
      },
      ctx,
    );
    expect(txOps.some((op) => op.op === "delete")).toBe(true);
    expect(result.outcome).toBe("applied");
    expect(
      (mockEmitAuditEvent.mock.calls[0][1] as { eventType: string }).eventType,
    ).toBe("mcp.detached");

    // Re-detach: no assignment row → noop, no event.
    mockEmitAuditEvent.mockClear();
    txOps.length = 0;
    rowsQueue.push(
      [AGENT_ROW],
      [TENANT_ROW],
      [{ id: SERVER_ID, slug: "github", name: "GitHub" }],
      [], // no existing row
    );
    const second = await detachCapability(
      null,
      {
        input: {
          tenantId: TENANT_ID,
          capabilityClass: "MCP_SERVER",
          scope: "AGENT",
          agentId: AGENT_ID,
          capabilityRef: SERVER_ID,
        },
      },
      ctx,
    );
    expect(second.outcome).toBe("noop");
    expect(txOps.some((op) => op.op === "delete")).toBe(false);
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("grant upserts with the tool allowlist and defaults the agent to the platform default", async () => {
    rowsQueue.push(
      [AGENT_ROW], // platform-default lookup (no agentId passed)
      [TENANT_ROW],
      [{ id: SERVER_ID, slug: "github", name: "GitHub" }],
      [], // no existing assignment (tx)
    );

    const result = await grantCapability(
      null,
      {
        input: {
          tenantId: TENANT_ID,
          capabilityClass: "MCP_SERVER",
          scope: "AGENT",
          capabilityRef: "github",
          toolAllowlist: ["issues_read"],
        },
      },
      ctx,
    );
    const insert = txOps.find((op) => op.op === "insert");
    expect(
      (insert!.args as { values: Record<string, unknown> }).values,
    ).toMatchObject({
      agent_id: AGENT_ID,
      tenant_id: TENANT_ID,
      mcp_server_id: SERVER_ID,
      config: { toolAllowlist: ["issues_read"] },
    });
    expect(result.outcome).toBe("applied");
    expect(mockEmitAuditEvent.mock.calls[0][0]).toBe(insert!.tx);
  });
});

describe("pi_extension (THINK-114 delegate)", () => {
  it("grant delegates to updatePiExtensionAssignment (adapt, don't fork) and audits after it commits", async () => {
    rowsQueue.push(
      [AGENT_ROW], // platform-default resolution (agent scope)
      [TENANT_ROW],
      [], // pre-read: no existing assignment
      [{ id: ASSIGNMENT_ID, granted_permissions: ["tool_use"] }], // post-read
    );
    mockCapabilityInspector.mockResolvedValue(
      cannedInspection([
        {
          capabilityClass: "pi_extension",
          capabilityId: ASSIGNMENT_ID,
          active: true,
        },
      ]),
    );

    const result = await grantCapability(
      null,
      {
        input: {
          tenantId: TENANT_ID,
          capabilityClass: "PI_EXTENSION",
          scope: "AGENT",
          capabilityRef: VERSION_ID,
          grantedPermissions: ["tool_use"],
        },
      },
      ctx,
    );

    expect(mockUpdatePiExtensionAssignment).toHaveBeenCalledWith(
      null,
      {
        input: expect.objectContaining({
          tenantId: TENANT_ID,
          versionId: VERSION_ID,
          targetType: "default_agent",
          enabled: true,
          grantedPermissions: { permissionClasses: ["tool_use"] },
        }),
      },
      ctx,
    );
    expect(result.outcome).toBe("applied");
    // Item is matched by the assignment id the inspector renders.
    expect(result.item).toMatchObject({ capabilityId: ASSIGNMENT_ID });
    expect(
      (mockEmitAuditEvent.mock.calls[0][1] as { eventType: string }).eventType,
    ).toBe("agent.extension_granted");
  });

  it("detach of an absent assignment is a no-op that never reaches the delegate", async () => {
    rowsQueue.push(
      [AGENT_ROW],
      [TENANT_ROW],
      [], // pre-read: nothing assigned
    );
    const result = await detachCapability(
      null,
      {
        input: {
          tenantId: TENANT_ID,
          capabilityClass: "PI_EXTENSION",
          scope: "AGENT",
          capabilityRef: VERSION_ID,
        },
      },
      ctx,
    );
    expect(result.outcome).toBe("noop");
    expect(mockUpdatePiExtensionAssignment).not.toHaveBeenCalled();
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });
});
