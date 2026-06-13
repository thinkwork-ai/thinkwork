import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTenantIdForUser: vi.fn(),
  listUserModelCatalog: vi.fn(),
  requireAdminOrServiceCaller: vi.fn(),
  setUserModelApprovalForUser: vi.fn(),
}));

vi.mock("../../../lib/model-approvals.js", () => ({
  getTenantIdForUser: mocks.getTenantIdForUser,
  listUserModelCatalog: mocks.listUserModelCatalog,
  setUserModelApproval: mocks.setUserModelApprovalForUser,
}));
vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mocks.requireAdminOrServiceCaller,
}));

// eslint-disable-next-line import/first
import { setUserModelApproval } from "./setUserModelApproval.mutation.js";

beforeEach(() => {
  mocks.getTenantIdForUser.mockReset().mockResolvedValue("tenant-1");
  mocks.listUserModelCatalog
    .mockReset()
    .mockResolvedValue([
      { approved: false, modelId: "anthropic.claude-haiku" },
    ]);
  mocks.requireAdminOrServiceCaller.mockReset().mockResolvedValue(undefined);
  mocks.setUserModelApprovalForUser.mockReset().mockResolvedValue(undefined);
});

function cognitoCtx(): any {
  return { auth: { authType: "cognito" } };
}

describe("setUserModelApproval", () => {
  it("requires admin or service auth before changing user model approvals", async () => {
    await expect(
      setUserModelApproval(
        null,
        {
          approved: true,
          modelId: "anthropic.claude-haiku",
          userId: "user-1",
        },
        cognitoCtx(),
      ),
    ).resolves.toEqual([
      { approved: false, modelId: "anthropic.claude-haiku" },
    ]);

    expect(mocks.requireAdminOrServiceCaller).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      "user_model_approval:update",
    );
    expect(mocks.setUserModelApprovalForUser).toHaveBeenCalledWith({
      approved: true,
      modelId: "anthropic.claude-haiku",
      tenantId: "tenant-1",
      userId: "user-1",
    });
  });

  it("does not mutate approvals when the admin gate rejects", async () => {
    mocks.requireAdminOrServiceCaller.mockRejectedValue(
      Object.assign(new Error("Tenant admin role required"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );

    await expect(
      setUserModelApproval(
        null,
        {
          approved: true,
          modelId: "anthropic.claude-haiku",
          userId: "user-1",
        },
        cognitoCtx(),
      ),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });

    expect(mocks.setUserModelApprovalForUser).not.toHaveBeenCalled();
    expect(mocks.listUserModelCatalog).not.toHaveBeenCalled();
  });
});
