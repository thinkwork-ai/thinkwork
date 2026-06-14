import { GraphQLError } from "graphql";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrainSubstrateMigrationRow } from "../../../lib/company-brain/migration.js";

const mocks = vi.hoisted(() => ({
  requireAdminOrServiceCaller: vi.fn(),
  resolveCallerTenantId: vi.fn(),
  resolveCallerUserId: vi.fn(),
  requestCompanyBrainProductionMigration: vi.fn(),
  updateCompanyBrainMigration: vi.fn(),
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mocks.requireAdminOrServiceCaller,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mocks.resolveCallerTenantId,
  resolveCallerUserId: mocks.resolveCallerUserId,
}));

vi.mock("../../../lib/company-brain/migration.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../lib/company-brain/migration.js")
    >();
  return {
    ...actual,
    requestCompanyBrainProductionMigration:
      mocks.requestCompanyBrainProductionMigration,
    updateCompanyBrainMigration: mocks.updateCompanyBrainMigration,
  };
});

let mod: typeof import("./companyBrainMigration.mutation.js");

const ctx = {
  auth: { authType: "cognito", principalId: "sub-1", tenantId: null },
} as any;

function migration(
  overrides: Partial<BrainSubstrateMigrationRow> = {},
): BrainSubstrateMigrationRow {
  return {
    id: "migration-1",
    tenant_id: "tenant-1",
    substrate_id: "substrate-1",
    from_storage_tier: "default",
    to_storage_tier: "production",
    phase: "requested",
    status: "requested",
    requested_by_user_id: "user-1",
    deployment_job_id: null,
    embedding_model: "amazon.titan-embed-text-v2:0",
    vector_dimension: 1024,
    validation_summary: { validationPassed: false },
    operator_evidence: {},
    error_message: null,
    requested_at: new Date("2026-06-14T12:00:00.000Z"),
    started_at: null,
    completed_at: null,
    rollback_window_closes_at: null,
    created_at: new Date("2026-06-14T12:00:00.000Z"),
    updated_at: new Date("2026-06-14T12:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(async () => {
  vi.resetModules();
  mocks.requireAdminOrServiceCaller.mockReset().mockResolvedValue(undefined);
  mocks.resolveCallerTenantId.mockReset().mockResolvedValue("tenant-1");
  mocks.resolveCallerUserId.mockReset().mockResolvedValue("user-1");
  mocks.requestCompanyBrainProductionMigration
    .mockReset()
    .mockResolvedValue(migration());
  mocks.updateCompanyBrainMigration.mockReset().mockResolvedValue(
    migration({
      phase: "completed",
      status: "completed",
      validation_summary: { validationPassed: true, vectorDimension: 1024 },
      completed_at: new Date("2026-06-14T12:05:00.000Z"),
    }),
  );
  mod = await import("./companyBrainMigration.mutation.js");
});

describe("requestCompanyBrainProductionMigrationMutation", () => {
  it("uses caller tenant fallback, admin/service auth, actor attribution, and parsed evidence", async () => {
    const result = await mod.requestCompanyBrainProductionMigrationMutation(
      null,
      {
        input: {
          vectorDimension: 1024,
          operatorEvidence: JSON.stringify({ ticket: "THNK-6" }),
        },
      },
      ctx,
    );

    expect(mocks.resolveCallerTenantId).toHaveBeenCalledWith(ctx);
    expect(mocks.requireAdminOrServiceCaller).toHaveBeenCalledWith(
      ctx,
      "tenant-1",
      "company_brain_migration:request",
    );
    expect(mocks.requestCompanyBrainProductionMigration).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        requestedByUserId: "user-1",
        vectorDimension: 1024,
        operatorEvidence: { ticket: "THNK-6" },
      }),
      undefined,
    );
    expect(result).toMatchObject({
      id: "migration-1",
      phase: "requested",
      validationSummary: JSON.stringify({ validationPassed: false }),
    });
  });

  it("fails closed when tenant context cannot be resolved", async () => {
    mocks.resolveCallerTenantId.mockResolvedValueOnce(null);

    await expect(
      mod.requestCompanyBrainProductionMigrationMutation(
        null,
        { input: {} },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.requireAdminOrServiceCaller).not.toHaveBeenCalled();
    expect(mocks.requestCompanyBrainProductionMigration).not.toHaveBeenCalled();
  });
});

describe("updateCompanyBrainMigrationMutation", () => {
  it("normalizes phase/status and parses validation/evidence JSON", async () => {
    const result = await mod.updateCompanyBrainMigrationMutation(
      null,
      {
        input: {
          tenantId: "tenant-1",
          migrationId: "migration-1",
          phase: "COMPLETED",
          status: "COMPLETED",
          validationSummary: JSON.stringify({
            validationPassed: true,
            vectorDimension: 1024,
          }),
          operatorEvidence: { smoke: "pass" },
        },
      },
      ctx,
    );

    expect(mocks.resolveCallerTenantId).not.toHaveBeenCalled();
    expect(mocks.requireAdminOrServiceCaller).toHaveBeenCalledWith(
      ctx,
      "tenant-1",
      "company_brain_migration:update",
    );
    expect(mocks.updateCompanyBrainMigration).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        migrationId: "migration-1",
        phase: "completed",
        status: "completed",
        validationSummary: {
          validationPassed: true,
          vectorDimension: 1024,
        },
        operatorEvidence: { smoke: "pass" },
      }),
      undefined,
    );
    expect(result).toMatchObject({
      phase: "completed",
      status: "completed",
      completedAt: "2026-06-14T12:05:00.000Z",
    });
  });

  it("returns BAD_USER_INPUT for malformed AWSJSON", async () => {
    await expect(
      mod.updateCompanyBrainMigrationMutation(
        null,
        {
          input: {
            tenantId: "tenant-1",
            migrationId: "migration-1",
            phase: "validating",
            validationSummary: "{not-json",
          },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(mocks.updateCompanyBrainMigration).not.toHaveBeenCalled();
  });

  it("preserves authz GraphQL errors from the admin/service gate", async () => {
    mocks.requireAdminOrServiceCaller.mockRejectedValueOnce(
      new GraphQLError("Tenant admin role required", {
        extensions: { code: "FORBIDDEN" },
      }),
    );

    await expect(
      mod.updateCompanyBrainMigrationMutation(
        null,
        {
          input: {
            tenantId: "tenant-1",
            migrationId: "migration-1",
            phase: "validating",
          },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mocks.updateCompanyBrainMigration).not.toHaveBeenCalled();
  });
});
