/**
 * Operator gating for the THINK-321 U7 resolvers: registerIdentitySource,
 * startIdentityMatchJob, identityMatchJob. All three ride
 * requireAdminOrServiceCaller — a non-operator caller is rejected before
 * any lib call.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireAdminOrServiceCaller,
  mockRegisterIdentitySource,
  mockStartIdentityMatchJob,
  mockLoadIdentityMatchJob,
} = vi.hoisted(() => ({
  mockRequireAdminOrServiceCaller: vi.fn(),
  mockRegisterIdentitySource: vi.fn(),
  mockStartIdentityMatchJob: vi.fn(),
  mockLoadIdentityMatchJob: vi.fn(),
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mockRequireAdminOrServiceCaller,
}));

vi.mock("../../../lib/entity-identity/bootstrap.js", () => ({
  registerIdentitySource: mockRegisterIdentitySource,
  startIdentityMatchJob: mockStartIdentityMatchJob,
  loadIdentityMatchJob: mockLoadIdentityMatchJob,
}));

import { registerIdentitySource } from "./registerIdentitySource.mutation.js";
import { startIdentityMatchJob } from "./startIdentityMatchJob.mutation.js";
import { identityMatchJob } from "./identityMatchJob.query.js";

const ctx = { auth: { authType: "cognito" } } as never;
const TENANT = "tenant-1";

beforeEach(() => {
  mockRequireAdminOrServiceCaller.mockReset();
  mockRegisterIdentitySource.mockReset();
  mockStartIdentityMatchJob.mockReset();
  mockLoadIdentityMatchJob.mockReset();
});

describe("non-operator callers are rejected on all three resolvers", () => {
  beforeEach(() => {
    mockRequireAdminOrServiceCaller.mockRejectedValue(
      new Error("Tenant admin role required"),
    );
  });

  it("registerIdentitySource", async () => {
    await expect(
      registerIdentitySource(
        null,
        {
          input: {
            tenantId: TENANT,
            sourceSystem: "lastmile",
            connectorSlug: "lastmile-pg",
            entityTypeSlugs: ["customer"],
          },
        },
        ctx,
      ),
    ).rejects.toThrow("Tenant admin role required");
    expect(mockRegisterIdentitySource).not.toHaveBeenCalled();
  });

  it("startIdentityMatchJob", async () => {
    await expect(
      startIdentityMatchJob(null, { input: { tenantId: TENANT } }, ctx),
    ).rejects.toThrow("Tenant admin role required");
    expect(mockStartIdentityMatchJob).not.toHaveBeenCalled();
  });

  it("identityMatchJob", async () => {
    await expect(
      identityMatchJob(null, { tenantId: TENANT, jobId: "job-1" }, ctx),
    ).rejects.toThrow("Tenant admin role required");
    expect(mockLoadIdentityMatchJob).not.toHaveBeenCalled();
  });
});

describe("operator callers pass through to the lib", () => {
  beforeEach(() => {
    mockRequireAdminOrServiceCaller.mockResolvedValue(undefined);
  });

  it("registerIdentitySource maps the lib result to the GraphQL shape", async () => {
    mockRegisterIdentitySource.mockResolvedValue({
      tenantId: TENANT,
      sourceSystem: "lastmile",
      connectorSlug: "lastmile-pg",
      entityTypeSlugs: ["customer"],
    });
    const result = await registerIdentitySource(
      null,
      {
        input: {
          tenantId: TENANT,
          sourceSystem: "lastmile",
          connectorSlug: "lastmile-pg",
          entityTypeSlugs: ["customer"],
        },
      },
      ctx,
    );
    expect(mockRequireAdminOrServiceCaller).toHaveBeenCalledWith(
      ctx,
      TENANT,
      "register_identity_source",
    );
    expect(result).toMatchObject({
      sourceSystem: "lastmile",
      entityTypeSlugs: ["customer"],
    });
  });

  it("startIdentityMatchJob forwards trigger/dedupeKey/sourceSystems", async () => {
    mockStartIdentityMatchJob.mockResolvedValue({
      id: "job-1",
      status: "PENDING",
    });
    const result = await startIdentityMatchJob(
      null,
      {
        input: {
          tenantId: TENANT,
          trigger: "bootstrap",
          dedupeKey: "k",
          sourceSystems: ["lastmile"],
        },
      },
      ctx,
    );
    expect(result.id).toBe("job-1");
    expect(mockStartIdentityMatchJob).toHaveBeenCalledWith({
      tenantId: TENANT,
      trigger: "bootstrap",
      dedupeKey: "k",
      sourceSystems: ["lastmile"],
    });
  });

  it("identityMatchJob loads the row", async () => {
    mockLoadIdentityMatchJob.mockResolvedValue({ id: "job-1" });
    const result = await identityMatchJob(
      null,
      { tenantId: TENANT, jobId: "job-1" },
      ctx,
    );
    expect(result).toEqual({ id: "job-1" });
  });
});
