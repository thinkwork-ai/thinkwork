import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTenantIdForUser: vi.fn(),
  listUserModelCatalog: vi.fn(),
  requireAdminOrServiceCaller: vi.fn(),
  resolveCaller: vi.fn(),
}));

vi.mock("../../../lib/model-approvals.js", () => ({
  getTenantIdForUser: mocks.getTenantIdForUser,
  listUserModelCatalog: mocks.listUserModelCatalog,
}));
vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mocks.requireAdminOrServiceCaller,
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCaller: mocks.resolveCaller,
}));

// eslint-disable-next-line import/first
import { userModelCatalog } from "./userModelCatalog.query.js";

beforeEach(() => {
  mocks.getTenantIdForUser.mockReset().mockResolvedValue("tenant-1");
  mocks.listUserModelCatalog
    .mockReset()
    .mockResolvedValue([
      { approved: true, modelId: "anthropic.claude-sonnet" },
    ]);
  mocks.requireAdminOrServiceCaller.mockReset().mockResolvedValue(undefined);
  mocks.resolveCaller.mockReset().mockResolvedValue({
    tenantId: "tenant-1",
    userId: "user-1",
  });
});

function cognitoCtx(): any {
  return { auth: { authType: "cognito" } };
}

describe("userModelCatalog", () => {
  it("allows a Cognito caller to read their own model catalog without admin auth", async () => {
    await expect(
      userModelCatalog(null, { userId: "user-1" }, cognitoCtx()),
    ).resolves.toEqual([
      { approved: true, modelId: "anthropic.claude-sonnet" },
    ]);

    expect(mocks.requireAdminOrServiceCaller).not.toHaveBeenCalled();
    expect(mocks.listUserModelCatalog).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-1",
    });
  });

  it("requires admin or service auth to read another user's model catalog", async () => {
    mocks.resolveCaller.mockResolvedValue({
      tenantId: "tenant-1",
      userId: "user-2",
    });

    await expect(
      userModelCatalog(null, { userId: "user-1" }, cognitoCtx()),
    ).resolves.toEqual([
      { approved: true, modelId: "anthropic.claude-sonnet" },
    ]);

    expect(mocks.requireAdminOrServiceCaller).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      "user_model_catalog:read",
    );
  });

  it("does not list another user's catalog when the admin gate rejects", async () => {
    mocks.resolveCaller.mockResolvedValue({
      tenantId: "tenant-1",
      userId: "user-2",
    });
    mocks.requireAdminOrServiceCaller.mockRejectedValue(
      Object.assign(new Error("Tenant admin role required"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );

    await expect(
      userModelCatalog(null, { userId: "user-1" }, cognitoCtx()),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });

    expect(mocks.listUserModelCatalog).not.toHaveBeenCalled();
  });
});
