import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cognitoSendMock,
  insertCalls,
  insertReturningQueue,
  selectRowsQueue,
  mockRequireTenantAdmin,
} = vi.hoisted(() => ({
  cognitoSendMock: vi.fn(),
  insertCalls: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  insertReturningQueue: [] as unknown[][],
  selectRowsQueue: [] as unknown[][],
  mockRequireTenantAdmin: vi.fn(),
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
}));

vi.mock("../lib/idempotency.js", () => ({
  runWithIdempotency: async ({ fn }: { fn: () => Promise<unknown> }) => fn(),
}));

vi.mock("../graphql/resolvers/core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerUserId: vi.fn(async () => "operator-user"),
}));

vi.mock("../graphql/utils.js", () => {
  const users = { id: "users.id", email: "users.email" };
  const tenantMembers = {
    tenant_id: "tenantMembers.tenant_id",
    principal_id: "tenantMembers.principal_id",
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
        values: (values: Record<string, unknown>) => {
          insertCalls.push({ table, values });
          return {
            returning: () =>
              Promise.resolve(insertReturningQueue.shift() ?? []),
          };
        },
      })),
    },
    eq: (...args: unknown[]) => ({ _eq: args }),
    and: (...args: unknown[]) => ({ _and: args }),
    snakeToCamel: (row: Record<string, unknown>) => row,
  };
});

// eslint-disable-next-line import/first
import { inviteMember } from "../graphql/resolvers/core/inviteMember.mutation.js";

describe("inviteMember computer onboarding claim", () => {
  beforeEach(() => {
    cognitoSendMock.mockReset();
    insertCalls.length = 0;
    insertReturningQueue.length = 0;
    selectRowsQueue.length = 0;
    mockRequireTenantAdmin.mockReset();
    mockRequireTenantAdmin.mockResolvedValue("admin");
  });

  it("creates the Cognito user with custom:tenant_id and binds the DB user to that tenant", async () => {
    cognitoSendMock.mockResolvedValueOnce({
      User: {
        Attributes: [{ Name: "sub", Value: "cognito-user-1" }],
      },
    });
    selectRowsQueue.push([], []);
    insertReturningQueue.push([
      {
        id: "member-1",
        tenant_id: "tenant-A",
        principal_type: "USER",
        principal_id: "cognito-user-1",
        role: "member",
        status: "active",
      },
    ]);

    const result = await inviteMember(
      null,
      {
        tenantId: "tenant-A",
        input: {
          email: "alex@acme.example",
          name: "Alex Acme",
          role: "member",
        },
      },
      {
        auth: {
          authType: "cognito",
          principalId: "operator-user",
          tenantId: "tenant-A",
          email: "operator@acme.example",
        },
      } as any,
    );

    const createCommand = cognitoSendMock.mock.calls[0]?.[0] as {
      input?: {
        UserAttributes?: Array<{ Name: string; Value: string }>;
      };
    };
    expect(createCommand.input?.UserAttributes).toEqual(
      expect.arrayContaining([
        { Name: "email", Value: "alex@acme.example" },
        { Name: "email_verified", Value: "true" },
        { Name: "name", Value: "Alex Acme" },
        { Name: "custom:tenant_id", Value: "tenant-A" },
      ]),
    );

    expect(insertCalls.map((call) => call.values)).toEqual([
      {
        id: "cognito-user-1",
        tenant_id: "tenant-A",
        email: "alex@acme.example",
        name: "Alex Acme",
      },
      {
        tenant_id: "tenant-A",
        principal_type: "USER",
        principal_id: "cognito-user-1",
        role: "member",
        status: "active",
      },
    ]);
    expect(result).toMatchObject({
      tenant_id: "tenant-A",
      principal_id: "cognito-user-1",
      role: "member",
    });
  });
});
