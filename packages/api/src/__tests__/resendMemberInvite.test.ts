import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cognitoSendMock,
  mockRequireTenantAdmin,
  mockResolveCallerUserId,
  runWithIdempotencyMock,
  selectRowsQueue,
  whereCalls,
} = vi.hoisted(() => ({
  cognitoSendMock: vi.fn(),
  mockRequireTenantAdmin: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  runWithIdempotencyMock: vi.fn(),
  selectRowsQueue: [] as unknown[][],
  whereCalls: [] as unknown[],
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

vi.mock("../graphql/resolvers/core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("../lib/idempotency.js", () => ({
  runWithIdempotency: runWithIdempotencyMock,
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
    snakeToCamel: (row: Record<string, unknown>) => row,
  };
});

// eslint-disable-next-line import/first
import { resendMemberInvite } from "../graphql/resolvers/core/resendMemberInvite.mutation.js";

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

describe("resendMemberInvite", () => {
  beforeEach(() => {
    cognitoSendMock.mockReset();
    mockRequireTenantAdmin.mockReset();
    mockResolveCallerUserId.mockReset();
    runWithIdempotencyMock.mockReset();
    selectRowsQueue.length = 0;
    whereCalls.length = 0;

    mockRequireTenantAdmin.mockResolvedValue("admin");
    mockResolveCallerUserId.mockResolvedValue("operator-user");
    runWithIdempotencyMock.mockImplementation(
      async ({ fn }: { fn: () => Promise<unknown> }) => fn(),
    );
  });

  it("uses a resend-specific idempotency namespace and resends pending invites", async () => {
    runWithIdempotencyMock.mockImplementationOnce(
      async ({
        mutationName,
        fn,
      }: {
        mutationName: string;
        fn: () => Promise<unknown>;
      }) => {
        if (mutationName === "inviteMember") {
          return { id: "cached-invite-member" };
        }
        return fn();
      },
    );
    enqueueMemberAndUser();
    cognitoSendMock
      .mockResolvedValueOnce({
        UserStatus: "FORCE_CHANGE_PASSWORD",
      })
      .mockResolvedValueOnce({});

    const result = await resendMemberInvite(
      null,
      {
        tenantId: "tenant-A",
        input: {
          memberId: "member-1",
          idempotencyKey: "resend-member-invite:member-1:click-1",
        },
      },
      ctx,
    );

    expect(runWithIdempotencyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-A",
        invokerUserId: "operator-user",
        mutationName: "resendMemberInvite",
        inputs: { memberId: "member-1" },
        clientKey: "resend-member-invite:member-1:click-1",
      }),
    );
    expect(result).toMatchObject({ status: "RESENT" });
    const resendCommand = cognitoSendMock.mock.calls[1]?.[0] as {
      input?: Record<string, unknown>;
    };
    expect(resendCommand.input).toMatchObject({
      Username: "alex@example.com",
      DesiredDeliveryMediums: ["EMAIL"],
      MessageAction: "RESEND",
    });
  });

  it("rejects blank idempotency keys before member lookup or Cognito calls", async () => {
    await expect(
      resendMemberInvite(
        null,
        {
          tenantId: "tenant-A",
          input: {
            memberId: "member-1",
            idempotencyKey: "   ",
          },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });

    expect(mockRequireTenantAdmin).toHaveBeenCalledOnce();
    expect(whereCalls).toHaveLength(0);
    expect(cognitoSendMock).not.toHaveBeenCalled();
    expect(runWithIdempotencyMock).not.toHaveBeenCalled();
  });

  it("resends unconfirmed Cognito users", async () => {
    enqueueMemberAndUser();
    cognitoSendMock
      .mockResolvedValueOnce({ UserStatus: "UNCONFIRMED" })
      .mockResolvedValueOnce({});

    const result = await resendMemberInvite(
      null,
      {
        tenantId: "tenant-A",
        input: {
          memberId: "member-1",
          idempotencyKey: "resend-member-invite:member-1:click-2",
        },
      },
      ctx,
    );

    expect(result).toMatchObject({ status: "RESENT" });
    expect(cognitoSendMock).toHaveBeenCalledTimes(2);
  });

  it("returns NOT_PENDING without sending when Cognito user is confirmed", async () => {
    enqueueMemberAndUser();
    cognitoSendMock.mockResolvedValueOnce({ UserStatus: "CONFIRMED" });

    const result = await resendMemberInvite(
      null,
      {
        tenantId: "tenant-A",
        input: {
          memberId: "member-1",
          idempotencyKey: "resend-member-invite:member-1:click-3",
        },
      },
      ctx,
    );

    expect(result).toMatchObject({
      status: "NOT_PENDING",
      message: "Invite not resent because Cognito user status is CONFIRMED.",
    });
    expect(cognitoSendMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces Cognito delivery failures as a typed result", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    enqueueMemberAndUser();
    cognitoSendMock
      .mockResolvedValueOnce({ UserStatus: "FORCE_CHANGE_PASSWORD" })
      .mockRejectedValueOnce(
        Object.assign(new Error("Email address is not verified."), {
          name: "CodeDeliveryFailureException",
        }),
      );

    const result = await resendMemberInvite(
      null,
      {
        tenantId: "tenant-A",
        input: {
          memberId: "member-1",
          idempotencyKey: "resend-member-invite:member-1:click-4",
        },
      },
      ctx,
    );

    expect(result).toMatchObject({
      status: "DELIVERY_FAILED",
      message:
        "Invite delivery failed because the email provider rejected the send. Check SES recipient/domain verification.",
    });
    expect(warn).toHaveBeenCalledWith(
      "resendMemberInvite: Cognito invite delivery failed",
      expect.objectContaining({
        tenantId: "tenant-A",
        memberId: "member-1",
        errorName: "CodeDeliveryFailureException",
        errorMessage: "Email address is not verified.",
      }),
    );
    warn.mockRestore();
  });

  it("does not cache retryable AdminGetUser failures before the resend side effect", async () => {
    const args = {
      tenantId: "tenant-A",
      input: {
        memberId: "member-1",
        idempotencyKey: "resend-member-invite:member-1:retry-click",
      },
    };
    enqueueMemberAndUser();
    cognitoSendMock.mockRejectedValueOnce(
      Object.assign(new Error("Rate exceeded"), {
        name: "TooManyRequestsException",
      }),
    );

    await expect(resendMemberInvite(null, args, ctx)).rejects.toThrow(
      "Rate exceeded",
    );
    expect(runWithIdempotencyMock).not.toHaveBeenCalled();

    enqueueMemberAndUser();
    cognitoSendMock
      .mockResolvedValueOnce({ UserStatus: "FORCE_CHANGE_PASSWORD" })
      .mockResolvedValueOnce({});

    const result = await resendMemberInvite(null, args, ctx);

    expect(result).toMatchObject({ status: "RESENT" });
    expect(runWithIdempotencyMock).toHaveBeenCalledOnce();
  });

  it("rethrows unexpected resend failures instead of converting them to delivery results", async () => {
    enqueueMemberAndUser();
    cognitoSendMock
      .mockResolvedValueOnce({ UserStatus: "FORCE_CHANGE_PASSWORD" })
      .mockRejectedValueOnce(
        Object.assign(new Error("Cognito throttled"), {
          name: "TooManyRequestsException",
        }),
      );

    await expect(
      resendMemberInvite(
        null,
        {
          tenantId: "tenant-A",
          input: {
            memberId: "member-1",
            idempotencyKey: "resend-member-invite:member-1:click-4b",
          },
        },
        ctx,
      ),
    ).rejects.toThrow("Cognito throttled");
  });

  it("requires tenant admin before any Cognito lookup", async () => {
    mockRequireTenantAdmin.mockRejectedValueOnce(
      Object.assign(new Error("Tenant admin role required"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );

    await expect(
      resendMemberInvite(
        null,
        {
          tenantId: "tenant-A",
          input: {
            memberId: "member-1",
            idempotencyKey: "resend-member-invite:member-1:click-5",
          },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(cognitoSendMock).not.toHaveBeenCalled();
    expect(runWithIdempotencyMock).not.toHaveBeenCalled();
  });

  it("refuses members outside the requested tenant before Cognito lookup", async () => {
    selectRowsQueue.push([]);

    await expect(
      resendMemberInvite(
        null,
        {
          tenantId: "tenant-A",
          input: {
            memberId: "missing-member",
            idempotencyKey: "resend-member-invite:missing-member:click-6",
          },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
    expect(whereCalls[0]).toEqual({
      _and: [
        { _eq: ["tenantMembers.id", "missing-member"] },
        { _eq: ["tenantMembers.tenant_id", "tenant-A"] },
      ],
    });
    expect(cognitoSendMock).not.toHaveBeenCalled();
  });
});
