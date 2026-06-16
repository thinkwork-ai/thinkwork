import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cognitoSendMock,
  insertCalls,
  mockRequireTenantAdmin,
  mockResolveCallerUserId,
  mockEnsureDefaultThreadSpace,
  runWithIdempotencyMock,
  selectRowsQueue,
  updateCalls,
} = vi.hoisted(() => ({
  cognitoSendMock: vi.fn(),
  insertCalls: [] as Array<{ table: unknown; values: unknown }>,
  mockRequireTenantAdmin: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockEnsureDefaultThreadSpace: vi.fn(),
  runWithIdempotencyMock: vi.fn(),
  selectRowsQueue: [] as unknown[][],
  updateCalls: [] as Array<{ table: unknown; values: unknown }>,
}));

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: vi.fn((key: string, fallback = "") =>
    key === "COGNITO_USER_POOL_ID" ? "pool-1" : fallback,
  ),
}));

vi.mock("@aws-sdk/client-cognito-identity-provider", () => ({
  CognitoIdentityProviderClient: class {
    send = cognitoSendMock;
  },
  AdminCreateUserCommand: class {
    constructor(public input: unknown) {}
  },
  AdminGetUserCommand: class {
    constructor(public input: unknown) {}
  },
  AdminSetUserPasswordCommand: class {
    constructor(public input: unknown) {}
  },
  AdminUpdateUserAttributesCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock("../graphql/resolvers/core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("../lib/idempotency.js", () => ({
  runWithIdempotency: runWithIdempotencyMock,
}));

vi.mock("../lib/spaces/default-space.js", () => ({
  ensureDefaultThreadSpace: mockEnsureDefaultThreadSpace,
}));

vi.mock("../graphql/utils.js", () => {
  const users = {
    id: "users.id",
    email: "users.email",
    cognito_sub: "users.cognito_sub",
  };
  const tenantMembers = {
    id: "tenantMembers.id",
    tenant_id: "tenantMembers.tenant_id",
    principal_type: "tenantMembers.principal_type",
    principal_id: "tenantMembers.principal_id",
    status: "tenantMembers.status",
  };

  return {
    users,
    tenantMembers,
    db: {
      select: vi.fn(() => ({
        from: () => ({
          where: () => Promise.resolve(selectRowsQueue.shift() ?? []),
        }),
      })),
      insert: vi.fn((table: unknown) => ({
        values: (values: unknown) => {
          insertCalls.push({ table, values });
          return {
            returning: () => Promise.resolve(selectRowsQueue.shift() ?? []),
            then: (resolve: (value: unknown) => unknown) =>
              Promise.resolve(resolve(undefined)),
          };
        },
      })),
      update: vi.fn((table: unknown) => ({
        set: (values: unknown) => {
          updateCalls.push({ table, values });
          return {
            where: () => Promise.resolve([]),
          };
        },
      })),
    },
    eq: (...args: unknown[]) => ({ _eq: args }),
    and: (...args: unknown[]) => ({ _and: args }),
    randomBytes: () => Buffer.from("manual-hidden-password-seed"),
    snakeToCamel: (row: Record<string, unknown>) => ({
      id: row.id,
      tenantId: row.tenant_id,
      principalType: row.principal_type,
      principalId: row.principal_id,
      role: row.role,
      status: row.status,
    }),
  };
});

// eslint-disable-next-line import/first
import { addManualUser } from "../graphql/resolvers/core/addManualUser.mutation.js";

const ctx = {
  auth: {
    authType: "cognito",
    principalId: "operator-user",
    tenantId: null,
    email: "operator@example.com",
  },
} as any;

const baseArgs = {
  tenantId: "tenant-A",
  input: {
    email: " New.User@Example.com ",
    name: " New User ",
    role: "member",
    idempotencyKey: "manual-add:tenant-A:new-user:click-1",
  },
};

function enqueueNoDuplicate() {
  selectRowsQueue.push([]);
}

function enqueueDbInsertPath() {
  selectRowsQueue.push(
    [], // user by id
    [], // user by email
    [], // existing tenant member
    [
      {
        id: "member-1",
        tenant_id: "tenant-A",
        principal_type: "user",
        principal_id: "sub-1",
        role: "member",
        status: "active",
      },
    ],
  );
}

describe("addManualUser", () => {
  beforeEach(() => {
    cognitoSendMock.mockReset();
    insertCalls.length = 0;
    mockRequireTenantAdmin.mockReset();
    mockResolveCallerUserId.mockReset();
    mockEnsureDefaultThreadSpace.mockReset();
    runWithIdempotencyMock.mockReset();
    selectRowsQueue.length = 0;
    updateCalls.length = 0;

    mockRequireTenantAdmin.mockResolvedValue("admin");
    mockResolveCallerUserId.mockResolvedValue("operator-user");
    mockEnsureDefaultThreadSpace.mockResolvedValue({
      id: "space-general",
      tenant_id: "tenant-A",
      status: "active",
    });
    runWithIdempotencyMock.mockImplementation(
      async ({ fn }: { fn: () => Promise<unknown> }) => fn(),
    );
  });

  it("creates a password-capable Cognito user without invite delivery before inserting membership", async () => {
    enqueueNoDuplicate();
    enqueueDbInsertPath();
    cognitoSendMock.mockResolvedValueOnce({
      User: { Attributes: [{ Name: "sub", Value: "sub-1" }] },
    });
    cognitoSendMock.mockResolvedValueOnce({});
    cognitoSendMock.mockResolvedValueOnce({});

    const result = await addManualUser(null, baseArgs, ctx);

    expect(result).toMatchObject({
      id: "member-1",
      tenantId: "tenant-A",
      principalType: "user",
      principalId: "sub-1",
      role: "member",
      status: "active",
    });

    const createInput = (cognitoSendMock.mock.calls[0]?.[0] as any).input;
    expect(createInput).toMatchObject({
      UserPoolId: "pool-1",
      Username: "new.user@example.com",
      MessageAction: "SUPPRESS",
    });
    expect(createInput.DesiredDeliveryMediums).toBeUndefined();

    const setPasswordInput = (cognitoSendMock.mock.calls[2]?.[0] as any).input;
    expect(setPasswordInput).toMatchObject({
      UserPoolId: "pool-1",
      Username: "new.user@example.com",
      Permanent: true,
    });
    expect(setPasswordInput.Password).toMatch(/^Tnwk-/);
    expect(runWithIdempotencyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mutationName: "addManualUser",
        inputs: {
          email: "new.user@example.com",
          name: "New User",
          role: "member",
        },
        clientKey: "manual-add:tenant-A:new-user:click-1",
      }),
    );
    expect(JSON.stringify(runWithIdempotencyMock.mock.calls)).not.toContain(
      setPasswordInput.Password,
    );
    expect(insertCalls.at(-1)?.values).toMatchObject({
      tenant_id: "tenant-A",
      principal_type: "user",
      principal_id: "sub-1",
      role: "member",
      status: "active",
    });
    expect(mockEnsureDefaultThreadSpace).toHaveBeenCalledWith({
      tenantId: "tenant-A",
      userId: "sub-1",
    });
  });

  it("repairs an existing Cognito user before creating the missing tenant member", async () => {
    enqueueNoDuplicate();
    enqueueDbInsertPath();
    cognitoSendMock.mockRejectedValueOnce(
      Object.assign(new Error("exists"), { name: "UsernameExistsException" }),
    );
    cognitoSendMock.mockResolvedValueOnce({
      UserAttributes: [{ Name: "sub", Value: "sub-1" }],
    });
    cognitoSendMock.mockResolvedValueOnce({});
    cognitoSendMock.mockResolvedValueOnce({});

    const result = await addManualUser(null, baseArgs, ctx);

    expect(result).toMatchObject({ principalId: "sub-1" });
    expect((cognitoSendMock.mock.calls[1]?.[0] as any).input).toMatchObject({
      UserPoolId: "pool-1",
      Username: "new.user@example.com",
    });
    expect((cognitoSendMock.mock.calls[3]?.[0] as any).input).toMatchObject({
      Permanent: true,
    });
  });

  it("fails duplicate active tenant members before Cognito or idempotency", async () => {
    selectRowsQueue.push([{ id: "sub-1" }], [{ id: "member-1" }]);

    await expect(addManualUser(null, baseArgs, ctx)).rejects.toMatchObject({
      extensions: { code: "ALREADY_MEMBER" },
    });
    expect(cognitoSendMock).not.toHaveBeenCalled();
    expect(runWithIdempotencyMock).not.toHaveBeenCalled();
  });

  it("requires tenant admin before any Cognito write", async () => {
    mockRequireTenantAdmin.mockRejectedValueOnce(
      Object.assign(new Error("Tenant admin role required"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );

    await expect(addManualUser(null, baseArgs, ctx)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
    expect(cognitoSendMock).not.toHaveBeenCalled();
    expect(runWithIdempotencyMock).not.toHaveBeenCalled();
  });

  it("allows only owners to create owner members", async () => {
    mockRequireTenantAdmin.mockResolvedValueOnce("admin");

    await expect(
      addManualUser(
        null,
        { ...baseArgs, input: { ...baseArgs.input, role: "owner" } },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(cognitoSendMock).not.toHaveBeenCalled();
    expect(runWithIdempotencyMock).not.toHaveBeenCalled();
  });

  it("does not insert DB rows when password finalization fails", async () => {
    enqueueNoDuplicate();
    cognitoSendMock.mockResolvedValueOnce({
      User: { Attributes: [{ Name: "sub", Value: "sub-1" }] },
    });
    cognitoSendMock.mockResolvedValueOnce({});
    cognitoSendMock.mockRejectedValueOnce(new Error("password policy changed"));

    await expect(addManualUser(null, baseArgs, ctx)).rejects.toThrow(
      "password policy changed",
    );
    expect(insertCalls).toHaveLength(0);
  });
});
