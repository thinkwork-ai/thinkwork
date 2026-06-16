import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cognitoSendMock,
  getConfigMock,
  mockRequireTenantAdmin,
  selectRowsQueue,
  whereCalls,
} = vi.hoisted(() => ({
  cognitoSendMock: vi.fn(),
  getConfigMock: vi.fn(),
  mockRequireTenantAdmin: vi.fn(),
  selectRowsQueue: [] as unknown[][],
  whereCalls: [] as unknown[],
}));

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: getConfigMock,
}));

vi.mock("@aws-sdk/client-cognito-identity-provider", () => ({
  CognitoIdentityProviderClient: class {
    send = cognitoSendMock;
  },
  AdminCreateUserCommand: class {
    constructor(public input: unknown) {}
  },
  AdminSetUserPasswordCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock("../graphql/resolvers/core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../graphql/utils.js", () => {
  const tenantMembers = {
    id: "tenantMembers.id",
    tenant_id: "tenantMembers.tenant_id",
    principal_type: "tenantMembers.principal_type",
    principal_id: "tenantMembers.principal_id",
  };
  const users = {
    id: "users.id",
    email: "users.email",
  };

  return {
    tenantMembers,
    users,
    db: {
      select: vi.fn(() => ({
        from: () => ({
          where: (where: unknown) => {
            whereCalls.push(where);
            return Promise.resolve(selectRowsQueue.shift() ?? []);
          },
        }),
      })),
    },
    eq: (...args: unknown[]) => ({ _eq: args }),
    and: (...args: unknown[]) => ({ _and: args }),
  };
});

// eslint-disable-next-line import/first
import { setTenantMemberPassword } from "../graphql/resolvers/core/setTenantMemberPassword.mutation.js";

const ctx = {
  auth: {
    authType: "cognito",
    principalId: "operator-user",
    tenantId: "tenant-A",
    email: "operator@example.com",
  },
} as any;

function enqueueMemberAndUser(overrides: Record<string, unknown> = {}) {
  selectRowsQueue.push(
    [
      {
        id: "member-1",
        tenant_id: "tenant-A",
        principal_type: "user",
        principal_id: "user-1",
        role: "member",
        status: "active",
        ...overrides,
      },
    ],
    [
      {
        id: "user-1",
        email: "alex@example.com",
        name: "Alex Example",
      },
    ],
  );
}

describe("setTenantMemberPassword", () => {
  beforeEach(() => {
    cognitoSendMock.mockReset();
    getConfigMock.mockReset();
    mockRequireTenantAdmin.mockReset();
    selectRowsQueue.length = 0;
    whereCalls.length = 0;

    cognitoSendMock.mockResolvedValue({});
    getConfigMock.mockReturnValue("pool-1");
    mockRequireTenantAdmin.mockResolvedValue("admin");
  });

  it("sets a permanent Cognito password for the tenant member", async () => {
    enqueueMemberAndUser();

    const result = await setTenantMemberPassword(
      null,
      {
        tenantId: "tenant-A",
        input: {
          memberId: "member-1",
          password: "StrongPass123!",
        },
      },
      ctx,
    );

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(ctx, "tenant-A");
    expect(result).toEqual({
      status: "PASSWORD_SET",
      message: "Password set.",
    });
    expect(cognitoSendMock).toHaveBeenCalledOnce();
    const command = cognitoSendMock.mock.calls[0]?.[0] as {
      input?: Record<string, unknown>;
    };
    expect(command.input).toMatchObject({
      UserPoolId: "pool-1",
      Username: "alex@example.com",
      Password: "StrongPass123!",
      Permanent: true,
    });
  });

  it("can set a temporary Cognito password that requires change on sign-in", async () => {
    enqueueMemberAndUser();

    const result = await setTenantMemberPassword(
      null,
      {
        tenantId: "tenant-A",
        input: {
          memberId: "member-1",
          password: "StrongPass123!",
          permanent: false,
        },
      },
      ctx,
    );

    expect(result).toEqual({
      status: "TEMPORARY_PASSWORD_SET",
      message:
        "Temporary password set. The user must choose a new password at next sign-in.",
    });
    const command = cognitoSendMock.mock.calls[0]?.[0] as {
      input?: Record<string, unknown>;
    };
    expect(command.input).toMatchObject({
      Permanent: false,
    });
  });

  it("rejects weak passwords before auth, lookup, or Cognito calls", async () => {
    await expect(
      setTenantMemberPassword(
        null,
        {
          tenantId: "tenant-A",
          input: {
            memberId: "member-1",
            password: "short",
          },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });

    expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
    expect(whereCalls).toHaveLength(0);
    expect(cognitoSendMock).not.toHaveBeenCalled();
  });

  it("denies non-admin callers before member lookup or Cognito calls", async () => {
    mockRequireTenantAdmin.mockRejectedValueOnce(
      Object.assign(new Error("Forbidden"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );

    await expect(
      setTenantMemberPassword(
        null,
        {
          tenantId: "tenant-A",
          input: {
            memberId: "member-1",
            password: "StrongPass123!",
          },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });

    expect(whereCalls).toHaveLength(0);
    expect(cognitoSendMock).not.toHaveBeenCalled();
  });

  it("returns not found without calling Cognito when the member is absent", async () => {
    selectRowsQueue.push([]);

    await expect(
      setTenantMemberPassword(
        null,
        {
          tenantId: "tenant-A",
          input: {
            memberId: "missing-member",
            password: "StrongPass123!",
          },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });

    expect(cognitoSendMock).not.toHaveBeenCalled();
  });
});
