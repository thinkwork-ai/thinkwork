import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSelect,
  mockRequireAdminOrServiceCaller,
  mockAnd,
  mockEq,
  mockNe,
  mockInArray,
  mockDesc,
  tables,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockRequireAdminOrServiceCaller: vi.fn(),
  mockAnd: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
  mockEq: vi.fn((left: unknown, right: unknown) => ({
    type: "eq",
    left,
    right,
  })),
  mockNe: vi.fn((left: unknown, right: unknown) => ({
    type: "ne",
    left,
    right,
  })),
  mockInArray: vi.fn((left: unknown, right: unknown[]) => ({
    type: "inArray",
    left,
    right,
  })),
  mockDesc: vi.fn((column: unknown) => ({ type: "desc", column })),
  tables: {
    piExtensionSources: {
      id: "pi_extension_sources.id",
      tenant_id: "pi_extension_sources.tenant_id",
      source_type: "pi_extension_sources.source_type",
      repository_url: "pi_extension_sources.repository_url",
    },
    piExtensionVersions: {
      id: "pi_extension_versions.id",
      tenant_id: "pi_extension_versions.tenant_id",
      source_id: "pi_extension_versions.source_id",
      status: "pi_extension_versions.status",
      updated_at: "pi_extension_versions.updated_at",
    },
    piExtensionAssignments: {
      id: "pi_extension_assignments.id",
      tenant_id: "pi_extension_assignments.tenant_id",
      version_id: "pi_extension_assignments.version_id",
      target_type: "pi_extension_assignments.target_type",
      agent_profile_id: "pi_extension_assignments.agent_profile_id",
      enabled: "pi_extension_assignments.enabled",
    },
  },
}));

vi.mock("../../utils.js", () => ({
  and: mockAnd,
  db: { select: mockSelect },
  desc: mockDesc,
  eq: mockEq,
  inArray: mockInArray,
  ne: mockNe,
  piExtensionSources: tables.piExtensionSources,
  piExtensionVersions: tables.piExtensionVersions,
  piExtensionAssignments: tables.piExtensionAssignments,
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mockRequireAdminOrServiceCaller,
}));

let queryMod: typeof import("./piExtensions.query.js");

beforeEach(async () => {
  vi.resetModules();
  mockSelect.mockReset();
  mockRequireAdminOrServiceCaller.mockReset();
  mockRequireAdminOrServiceCaller.mockResolvedValue(undefined);
  mockAnd.mockClear();
  mockEq.mockClear();
  mockNe.mockClear();
  mockInArray.mockClear();
  mockDesc.mockClear();
  queryMod = await import("./piExtensions.query.js");
});

describe("piExtensions", () => {
  it("returns imported versions as visible but non-executable", async () => {
    mockSelect
      .mockReturnValueOnce(versionRows([joinedRow({ status: "imported" })]))
      .mockReturnValueOnce(assignmentRows([]));

    const result = await queryMod.piExtensions(
      null,
      { tenantId: "tenant-1" },
      ctx(),
    );

    expect(mockRequireAdminOrServiceCaller).toHaveBeenCalledWith(
      ctx(),
      "tenant-1",
      "pi_extensions:read",
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: "version-1",
        tenantId: "tenant-1",
        sourceType: "GITHUB",
        repositoryUrl: "https://github.com/acme/pi-extension",
        sourceRef: "main",
        status: "IMPORTED",
        executable: false,
        assignmentSummary: {
          defaultAgentEnabled: false,
          enabledProfileCount: 0,
          disabledCount: 0,
        },
        assignments: [],
      }),
    ]);
  });

  it("marks approved versions executable only when an enabled assignment exists", async () => {
    mockSelect
      .mockReturnValueOnce(versionRows([joinedRow({ status: "approved" })]))
      .mockReturnValueOnce(
        assignmentRows([
          assignmentRow({
            id: "assignment-default",
            target_type: "default_agent",
            agent_profile_id: null,
            enabled: true,
          }),
          assignmentRow({
            id: "assignment-profile",
            target_type: "agent_profile",
            agent_profile_id: "profile-1",
            enabled: true,
          }),
          assignmentRow({
            id: "assignment-disabled",
            target_type: "agent_profile",
            agent_profile_id: "profile-2",
            enabled: false,
          }),
        ]),
      );

    const result = await queryMod.piExtensions(
      null,
      { tenantId: "tenant-1" },
      ctx(),
    );

    expect(result[0]).toMatchObject({
      status: "APPROVED",
      executable: true,
      assignmentSummary: {
        defaultAgentEnabled: true,
        enabledProfileCount: 1,
        disabledCount: 1,
      },
      assignments: [
        expect.objectContaining({
          id: "assignment-default",
          targetType: "DEFAULT_AGENT",
          enabled: true,
        }),
        expect.objectContaining({
          id: "assignment-profile",
          targetType: "AGENT_PROFILE",
          agentProfileId: "profile-1",
          enabled: true,
        }),
        expect.objectContaining({
          id: "assignment-disabled",
          targetType: "AGENT_PROFILE",
          agentProfileId: "profile-2",
          enabled: false,
        }),
      ],
    });
  });

  it("does not make rejected assigned versions executable", async () => {
    mockSelect
      .mockReturnValueOnce(versionRows([joinedRow({ status: "rejected" })]))
      .mockReturnValueOnce(
        assignmentRows([
          assignmentRow({
            target_type: "default_agent",
            agent_profile_id: null,
            enabled: true,
          }),
        ]),
      );

    const result = await queryMod.piExtensions(
      null,
      { tenantId: "tenant-1" },
      ctx(),
    );

    expect(result[0]).toMatchObject({
      status: "REJECTED",
      executable: false,
      assignmentSummary: {
        defaultAgentEnabled: true,
        enabledProfileCount: 0,
        disabledCount: 0,
      },
    });
  });

  it("applies rejected and failed filters when requested", async () => {
    mockSelect.mockReturnValueOnce(versionRows([]));

    await queryMod.piExtensions(
      null,
      { tenantId: "tenant-1", includeRejected: false, includeFailed: false },
      ctx(),
    );

    expect(mockNe).toHaveBeenCalledWith(
      tables.piExtensionVersions.status,
      "rejected",
    );
    expect(mockNe).toHaveBeenCalledWith(
      tables.piExtensionVersions.status,
      "failed_verification",
    );
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });
});

function ctx() {
  return { auth: { tenantId: "tenant-1" } } as never;
}

function joinedRow(overrides: Partial<VersionRow> = {}) {
  return {
    version: versionRow(overrides),
    source: {
      id: "source-1",
      tenant_id: "tenant-1",
      source_type: "github",
      repository_url: "https://github.com/acme/pi-extension",
      repository_owner: "acme",
      repository_name: "pi-extension",
      display_name: "ACME Extension",
    },
  };
}

interface VersionRow {
  id: string;
  tenant_id: string;
  source_id: string;
  display_name: string | null;
  description: string | null;
  source_ref: string;
  commit_sha: string | null;
  manifest_hash: string | null;
  artifact_hash: string | null;
  artifact_uri: string | null;
  runtime_target: string | null;
  status: string;
  status_reason: string | null;
  manifest: Record<string, unknown>;
  tool_names: string[];
  lifecycle_hooks: string[];
  permission_classes: string[];
  verification_report: Record<string, unknown>;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
  rejected_by_user_id: string | null;
  rejected_at: string | null;
  created_at: string;
  updated_at: string;
}

function versionRow(overrides: Partial<VersionRow> = {}): VersionRow {
  return {
    id: "version-1",
    tenant_id: "tenant-1",
    source_id: "source-1",
    display_name: "ACME Extension v1",
    description: "Adds ACME tools.",
    source_ref: "main",
    commit_sha: "abc123",
    manifest_hash: "manifest-sha",
    artifact_hash: null,
    artifact_uri: null,
    runtime_target: "cloud",
    status: "imported",
    status_reason: null,
    manifest: { name: "acme" },
    tool_names: ["acme_lookup"],
    lifecycle_hooks: ["session_start"],
    permission_classes: ["network"],
    verification_report: {},
    reviewed_by_user_id: null,
    reviewed_at: null,
    approved_by_user_id: null,
    approved_at: null,
    rejected_by_user_id: null,
    rejected_at: null,
    created_at: "2026-06-30T00:00:00.000Z",
    updated_at: "2026-06-30T00:00:00.000Z",
    ...overrides,
  };
}

function assignmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "assignment-1",
    tenant_id: "tenant-1",
    version_id: "version-1",
    target_type: "default_agent",
    agent_profile_id: null,
    enabled: true,
    granted_permissions: {},
    created_at: "2026-06-30T00:00:00.000Z",
    updated_at: "2026-06-30T00:00:00.000Z",
    ...overrides,
  };
}

function versionRows(rows: unknown[]) {
  return {
    from: () => ({
      innerJoin: () => ({
        where: () => ({
          orderBy: async () => rows,
        }),
      }),
    }),
  };
}

function assignmentRows(rows: unknown[]) {
  return {
    from: () => ({
      where: async () => rows,
    }),
  };
}
