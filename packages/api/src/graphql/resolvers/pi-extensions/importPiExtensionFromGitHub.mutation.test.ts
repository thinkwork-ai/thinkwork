import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql as realSql } from "drizzle-orm";
import { piExtensionVersions as realPiExtensionVersions } from "@thinkwork/database-pg/schema";

const {
  mockTransaction,
  mockInsert,
  mockSelect,
  mockAnd,
  mockEq,
  mockSql,
  mockRequireAdminOrServiceCaller,
  mockResolveCallerUserId,
  mockImportPiExtensionFromGitHubSource,
  tables,
  insertCalls,
  existingVersionRows,
  selectResultQueue,
  versionInsertReturningRows,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockInsert: vi.fn(),
  mockSelect: vi.fn(),
  mockAnd: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
  mockEq: vi.fn((left: unknown, right: unknown) => ({
    type: "eq",
    left,
    right,
  })),
  mockSql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    type: "sql",
    strings: Array.from(strings),
    values,
  })),
  mockRequireAdminOrServiceCaller: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockImportPiExtensionFromGitHubSource: vi.fn(),
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
      commit_sha: "pi_extension_versions.commit_sha",
    },
  },
  insertCalls: [] as Array<{
    table: unknown;
    values?: Record<string, unknown>;
    conflict?: Record<string, unknown>;
  }>,
  existingVersionRows: [] as Record<string, unknown>[],
  selectResultQueue: [] as Record<string, unknown>[][],
  versionInsertReturningRows: {
    current: null as Record<string, unknown>[] | null,
  },
}));

vi.mock("../../utils.js", () => ({
  and: mockAnd,
  db: { transaction: mockTransaction },
  eq: mockEq,
  piExtensionSources: tables.piExtensionSources,
  piExtensionVersions: tables.piExtensionVersions,
  sql: mockSql,
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mockRequireAdminOrServiceCaller,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("../../../lib/pi-extensions/github-import.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/pi-extensions/github-import.js")
  >("../../../lib/pi-extensions/github-import.js");
  return {
    ...actual,
    importPiExtensionFromGitHubSource: mockImportPiExtensionFromGitHubSource,
  };
});

let mutationMod: typeof import("./importPiExtensionFromGitHub.mutation.js");

beforeEach(async () => {
  vi.resetModules();
  insertCalls.length = 0;
  existingVersionRows.length = 0;
  selectResultQueue.length = 0;
  versionInsertReturningRows.current = null;
  mockRequireAdminOrServiceCaller.mockReset().mockResolvedValue(undefined);
  mockResolveCallerUserId.mockReset().mockResolvedValue("user-1");
  mockImportPiExtensionFromGitHubSource
    .mockReset()
    .mockResolvedValue(importResult({ status: "needs_review" }));
  mockInsert.mockReset().mockImplementation((table: unknown) => {
    const call = { table } as (typeof insertCalls)[number];
    insertCalls.push(call);
    return {
      values: (values: Record<string, unknown>) => {
        call.values = values;
        return {
          onConflictDoUpdate: (conflict: Record<string, unknown>) => {
            call.conflict = conflict;
            return {
              returning: async () =>
                table === tables.piExtensionSources
                  ? [sourceRow()]
                  : (versionInsertReturningRows.current ?? [
                      versionRow(values),
                    ]),
            };
          },
        };
      },
    };
  });
  mockSelect.mockReset().mockReturnValue({
    from: () => ({
      where: async () => selectResultQueue.shift() ?? existingVersionRows,
    }),
  });
  mockTransaction
    .mockReset()
    .mockImplementation(async (callback) =>
      callback({ insert: mockInsert, select: mockSelect }),
    );
  mutationMod = await import("./importPiExtensionFromGitHub.mutation.js");
});

describe("importPiExtensionFromGitHub", () => {
  it("imports a GitHub source as a visible needs-review version", async () => {
    const result = await mutationMod.importPiExtensionFromGitHub(
      null,
      {
        input: {
          tenantId: "tenant-1",
          repositoryUrl: "https://github.com/acme/pi-extension",
          ref: "main",
        },
      },
      ctx(),
    );

    expect(mockRequireAdminOrServiceCaller).toHaveBeenCalledWith(
      ctx(),
      "tenant-1",
      "pi_extensions:import",
    );
    expect(mockImportPiExtensionFromGitHubSource).toHaveBeenCalledWith({
      request: {
        repositoryUrl: "https://github.com/acme/pi-extension",
        ref: "main",
        manifestPath: undefined,
      },
    });
    expect(insertCalls[0]?.values).toMatchObject({
      tenant_id: "tenant-1",
      source_type: "github",
      repository_url: "https://github.com/acme/pi-extension",
      created_by_user_id: "user-1",
    });
    expect(insertCalls[1]?.values).toMatchObject({
      tenant_id: "tenant-1",
      source_id: "source-1",
      status: "needs_review",
      artifact_uri:
        "github://acme/pi-extension/0123456789abcdef0123456789abcdef01234567",
      tool_names: ["acme_lookup"],
    });
    expect(insertCalls[1]?.conflict).toHaveProperty("setWhere");
    expect(result).toMatchObject({
      id: "version-1",
      tenantId: "tenant-1",
      status: "NEEDS_REVIEW",
      executable: false,
      assignments: [],
      verificationReport: {
        status: "passed",
        artifactDescriptor: {
          kind: "github-source-snapshot",
        },
      },
    });
  });

  it("persists failed verification rows as non-executable evidence", async () => {
    mockImportPiExtensionFromGitHubSource.mockResolvedValue(
      importResult({
        status: "failed_verification",
        statusReason: "Unsupported runtime target: unknown-runtime",
      }),
    );

    const result = await mutationMod.importPiExtensionFromGitHub(
      null,
      {
        input: {
          tenantId: "tenant-1",
          repositoryUrl: "https://github.com/acme/pi-extension",
          ref: "main",
        },
      },
      ctx(),
    );

    expect(insertCalls[1]?.values).toMatchObject({
      status: "failed_verification",
      status_reason: "Unsupported runtime target: unknown-runtime",
    });
    expect(result).toMatchObject({
      status: "FAILED_VERIFICATION",
      executable: false,
      statusReason: "Unsupported runtime target: unknown-runtime",
    });
  });

  it("does not erase source display name when re-import evidence has no manifest name", async () => {
    mockImportPiExtensionFromGitHubSource.mockResolvedValue(
      importResult({
        displayName: null,
        status: "failed_verification",
        statusReason: "Extension manifest could not be fetched (404)",
      }),
    );

    await mutationMod.importPiExtensionFromGitHub(
      null,
      {
        input: {
          tenantId: "tenant-1",
          repositoryUrl: "https://github.com/acme/pi-extension",
          ref: "main",
        },
      },
      ctx(),
    );

    expect(insertCalls[0]?.conflict?.set).toMatchObject({
      repository_owner: "acme",
      repository_name: "pi-extension",
    });
    expect(
      (insertCalls[0]?.conflict?.set as Record<string, unknown>).display_name,
    ).toBeUndefined();
  });

  it("does not reset an already approved immutable version on re-import", async () => {
    existingVersionRows.push(
      versionRow({
        status: "approved",
        status_reason: null,
        approved_by_user_id: "reviewer-1",
        approved_at: "2026-06-30T01:00:00.000Z",
      }),
    );

    const result = await mutationMod.importPiExtensionFromGitHub(
      null,
      {
        input: {
          tenantId: "tenant-1",
          repositoryUrl: "https://github.com/acme/pi-extension",
          ref: "main",
        },
      },
      ctx(),
    );

    expect(insertCalls).toHaveLength(1);
    expect(result).toMatchObject({
      status: "APPROVED",
      executable: false,
      approvedByUserId: "reviewer-1",
      approvedAt: "2026-06-30T01:00:00.000Z",
    });
  });

  it("does not overwrite a concurrent approval during conflict update", async () => {
    const approvedVersion = versionRow({
      status: "approved",
      status_reason: null,
      approved_by_user_id: "reviewer-1",
      approved_at: "2026-06-30T01:00:00.000Z",
    });
    selectResultQueue.push([], [approvedVersion]);
    versionInsertReturningRows.current = [];

    const result = await mutationMod.importPiExtensionFromGitHub(
      null,
      {
        input: {
          tenantId: "tenant-1",
          repositoryUrl: "https://github.com/acme/pi-extension",
          ref: "main",
        },
      },
      ctx(),
    );

    expect(insertCalls[1]?.conflict).toHaveProperty("setWhere");
    expect(result).toMatchObject({
      status: "APPROVED",
      executable: false,
      approvedByUserId: "reviewer-1",
      approvedAt: "2026-06-30T01:00:00.000Z",
    });
  });

  it("renders the immutable version conflict guard in Drizzle SQL", () => {
    const db = drizzle({} as never);
    const query = db
      .insert(realPiExtensionVersions)
      .values({
        tenant_id: "00000000-0000-0000-0000-000000000001",
        source_id: "00000000-0000-0000-0000-000000000002",
        source_ref: "main",
        commit_sha: "abc123",
        status: "needs_review",
        manifest: {},
        tool_names: [],
        lifecycle_hooks: [],
        permission_classes: [],
        verification_report: {},
      })
      .onConflictDoUpdate({
        target: [
          realPiExtensionVersions.tenant_id,
          realPiExtensionVersions.source_id,
          realPiExtensionVersions.commit_sha,
        ],
        setWhere: realSql`${realPiExtensionVersions.status} NOT IN ('approved', 'rejected')`,
        set: { status: "needs_review" },
      })
      .returning()
      .toSQL();

    expect(query.sql).toContain(
      `on conflict ("tenant_id","source_id","commit_sha") do update set`,
    );
    expect(query.sql).toContain(
      `where "pi_extension_versions"."status" NOT IN ('approved', 'rejected')`,
    );
  });
});

function ctx() {
  return { auth: { tenantId: "tenant-1" } } as never;
}

function sourceRow() {
  return {
    id: "source-1",
    tenant_id: "tenant-1",
    source_type: "github",
    repository_url: "https://github.com/acme/pi-extension",
    repository_owner: "acme",
    repository_name: "pi-extension",
    display_name: "ACME Extension",
  };
}

function versionRow(values: Record<string, unknown> = {}) {
  return {
    id: "version-1",
    tenant_id: "tenant-1",
    source_id: "source-1",
    display_name: "ACME Extension",
    description: "Adds ACME tools.",
    source_ref: "main",
    commit_sha: "0123456789abcdef0123456789abcdef01234567",
    manifest_hash: "manifest-sha",
    artifact_hash: "artifact-sha",
    artifact_uri:
      "github://acme/pi-extension/0123456789abcdef0123456789abcdef01234567",
    runtime_target: "agentcore-pi",
    status: values.status,
    status_reason: values.status_reason ?? null,
    manifest: values.manifest,
    tool_names: values.tool_names,
    lifecycle_hooks: values.lifecycle_hooks,
    permission_classes: values.permission_classes,
    verification_report: values.verification_report,
    reviewed_by_user_id: null,
    reviewed_at: null,
    approved_by_user_id: null,
    approved_at: null,
    rejected_by_user_id: null,
    rejected_at: null,
    created_at: "2026-06-30T00:00:00.000Z",
    updated_at: "2026-06-30T00:00:00.000Z",
    ...values,
  };
}

function importResult(overrides: {
  displayName?: string | null;
  status: "needs_review" | "failed_verification";
  statusReason?: string | null;
}) {
  return {
    source: {
      sourceType: "github",
      repositoryUrl: "https://github.com/acme/pi-extension",
      owner: "acme",
      repo: "pi-extension",
    },
    version: {
      sourceRef: "main",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      displayName: Object.hasOwn(overrides, "displayName")
        ? overrides.displayName
        : "ACME Extension",
      description: "Adds ACME tools.",
      manifest: {
        schemaVersion: 1,
        name: "acme_extension",
        displayName: "ACME Extension",
        description: "Adds ACME tools.",
        runtimeTarget: "agentcore-pi",
        entrypoint: "dist/index.js",
        tools: [{ name: "acme_lookup" }],
        lifecycleHooks: [],
        permissionClasses: ["network"],
      },
      manifestPath: "pi-extension.json",
      manifestHash: "manifest-sha",
      artifactDescriptor: {
        kind: "github-source-snapshot",
        repositoryUrl: "https://github.com/acme/pi-extension",
        owner: "acme",
        repo: "pi-extension",
        sourceRef: "main",
        commitSha: "0123456789abcdef0123456789abcdef01234567",
        manifestPath: "pi-extension.json",
        manifestHash: "manifest-sha",
        tarballUrl:
          "https://api.github.com/repos/acme/pi-extension/tarball/0123456789abcdef0123456789abcdef01234567",
      },
      artifactHash: "artifact-sha",
      artifactUri:
        "github://acme/pi-extension/0123456789abcdef0123456789abcdef01234567",
      runtimeTarget: "agentcore-pi",
      toolNames: ["acme_lookup"],
      lifecycleHooks: [],
      permissionClasses: ["network"],
      status: overrides.status,
      statusReason: overrides.statusReason ?? null,
      verificationReport: {
        schemaVersion: 1,
        status: overrides.status === "needs_review" ? "passed" : "failed",
        checkedAt: "2026-06-30T00:00:00.000Z",
        findings: [],
      },
    },
  };
}
