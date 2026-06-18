import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cognitoSendMock,
  emailChannelSendMock,
  getSecretMock,
  insertCalls,
  insertReturningQueue,
  selectRowsQueue,
  mockRequireTenantAdmin,
} = vi.hoisted(() => ({
  cognitoSendMock: vi.fn(),
  emailChannelSendMock: vi.fn(),
  getSecretMock: vi.fn(),
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
  AdminSetUserPasswordCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: (key: string, fallback = "") =>
    key === "COGNITO_USER_POOL_ID"
      ? "pool-1"
      : key === "ADMIN_URL"
        ? "https://app.test"
        : fallback,
  getSecret: getSecretMock,
}));

vi.mock("../lib/email-channel/channel-service.js", () => ({
  createEmailChannelService: () => ({
    send: emailChannelSendMock,
  }),
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
    randomBytes: () => Buffer.from("temporarypass12"),
    snakeToCamel: (row: Record<string, unknown>) => row,
  };
});

// eslint-disable-next-line import/first
import { inviteMember } from "../graphql/resolvers/core/inviteMember.mutation.js";

describe("inviteMember onboarding claim", () => {
  beforeEach(() => {
    cognitoSendMock.mockReset();
    emailChannelSendMock.mockReset();
    getSecretMock.mockReset();
    insertCalls.length = 0;
    insertReturningQueue.length = 0;
    selectRowsQueue.length = 0;
    mockRequireTenantAdmin.mockReset();
    mockRequireTenantAdmin.mockResolvedValue("admin");
    emailChannelSendMock.mockResolvedValue({
      provider: "resend",
      providerMessageId: "resend-email-1",
      status: "sent",
      metadata: {},
    });
    getSecretMock.mockResolvedValue(JSON.stringify({ apiKey: "re_test" }));
  });

  it("creates the Cognito user with custom:tenant_id and binds the DB user to that tenant", async () => {
    cognitoSendMock.mockResolvedValueOnce({
      User: {
        Attributes: [{ Name: "sub", Value: "cognito-user-1" }],
      },
    });
    selectRowsQueue.push([], [], []);
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
        cognito_sub: "cognito-user-1",
        tenant_id: "tenant-A",
        email: "alex@acme.example",
        name: "Alex Acme",
        workspace_folder_name: "alex-acme",
      },
      {
        tenant_id: "tenant-A",
        principal_type: "user",
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
    expect(emailChannelSendMock).not.toHaveBeenCalled();
  });

  it("uses the active Resend channel for invite delivery", async () => {
    cognitoSendMock.mockResolvedValueOnce({
      User: {
        Attributes: [{ Name: "sub", Value: "cognito-user-1" }],
      },
    });
    selectRowsQueue.push(
      [
        {
          id: "provider-1",
          tenant_id: "tenant-A",
          provider: "resend",
          status: "ready",
          active_for_production: true,
          credential_secret_ref: "resend/api-key",
          default_from_email: "noreply@thinkwork.ai",
        },
      ],
      [],
      [],
    );
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

    await inviteMember(
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
        MessageAction?: string;
        DesiredDeliveryMediums?: string[];
        TemporaryPassword?: string;
      };
    };
    expect(createCommand.input).toMatchObject({
      MessageAction: "SUPPRESS",
    });
    expect(createCommand.input?.DesiredDeliveryMediums).toBeUndefined();
    expect(createCommand.input?.TemporaryPassword).toMatch(/Aa1!$/);
    const invitePayload = emailChannelSendMock.mock.calls[0]?.[1] as {
      html?: string;
      text?: string;
    };
    expect(invitePayload.html).toContain('src="https://app.test/logo.png"');
    expect(invitePayload.html).toContain('href="https://app.test/sign-in"');
    expect(invitePayload.html).toContain("Workspace invitation");
    expect(invitePayload.html).toContain("Temporary password");
    expect(invitePayload.text).toContain("Sign in: https://app.test/sign-in");
    expect(emailChannelSendMock).toHaveBeenCalledWith(
      "resend",
      expect.objectContaining({
        tenantId: "tenant-A",
        providerInstallId: "provider-1",
        from: "noreply@thinkwork.ai",
        to: ["alex@acme.example"],
        subject: "You're invited to ThinkWork",
        credential: "re_test",
      }),
    );
  });

  it("uses a configured Resend channel even when old readiness flags are stale", async () => {
    cognitoSendMock.mockResolvedValueOnce({
      User: {
        Attributes: [{ Name: "sub", Value: "cognito-user-1" }],
      },
    });
    selectRowsQueue.push(
      [
        {
          id: "provider-1",
          tenant_id: "tenant-A",
          provider: "resend",
          status: "pending",
          active_for_production: false,
          credential_secret_ref: "resend/api-key",
          default_from_email: "noreply@thinkwork.ai",
        },
      ],
      [],
      [],
    );
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

    await inviteMember(
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
        MessageAction?: string;
        DesiredDeliveryMediums?: string[];
      };
    };
    expect(createCommand.input).toMatchObject({
      MessageAction: "SUPPRESS",
    });
    expect(createCommand.input?.DesiredDeliveryMediums).toBeUndefined();
    expect(emailChannelSendMock).toHaveBeenCalledWith(
      "resend",
      expect.objectContaining({
        tenantId: "tenant-A",
        providerInstallId: "provider-1",
        from: "noreply@thinkwork.ai",
        to: ["alex@acme.example"],
        subject: "You're invited to ThinkWork",
        credential: "re_test",
      }),
    );
  });

  it("prefers an active SendGrid channel over an older configured Resend fallback", async () => {
    cognitoSendMock.mockResolvedValueOnce({
      User: {
        Attributes: [{ Name: "sub", Value: "cognito-user-1" }],
      },
    });
    getSecretMock.mockResolvedValueOnce(JSON.stringify({ apiKey: "SG.test" }));
    selectRowsQueue.push(
      [
        {
          id: "provider-resend",
          tenant_id: "tenant-A",
          provider: "resend",
          status: "pending",
          active_for_production: false,
          credential_secret_ref: "resend/api-key",
          default_from_email: "noreply@thinkwork.ai",
        },
        {
          id: "provider-sendgrid",
          tenant_id: "tenant-A",
          provider: "sendgrid",
          status: "ready",
          active_for_production: true,
          credential_secret_ref: "sendgrid/api-key",
          default_from_email: "noreply@sendgrid.example",
        },
      ],
      [],
      [],
    );
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

    await inviteMember(
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

    expect(emailChannelSendMock).toHaveBeenCalledWith(
      "sendgrid",
      expect.objectContaining({
        tenantId: "tenant-A",
        providerInstallId: "provider-sendgrid",
        from: "noreply@sendgrid.example",
        to: ["alex@acme.example"],
        subject: "You're invited to ThinkWork",
        credential: "SG.test",
      }),
    );
  });

  it("resends the Cognito invitation when the existing user is still pending", async () => {
    cognitoSendMock
      .mockRejectedValueOnce({ name: "UsernameExistsException" })
      .mockResolvedValueOnce({
        UserStatus: "FORCE_CHANGE_PASSWORD",
        UserAttributes: [{ Name: "sub", Value: "cognito-user-1" }],
      })
      .mockResolvedValueOnce({
        User: {
          Attributes: [{ Name: "sub", Value: "cognito-user-1" }],
        },
      });
    selectRowsQueue.push([], [], []);
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

    await inviteMember(
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

    const resendCommand = cognitoSendMock.mock.calls[2]?.[0] as {
      input?: {
        DesiredDeliveryMediums?: string[];
        MessageAction?: string;
        Username?: string;
      };
    };

    expect(resendCommand.input).toMatchObject({
      Username: "alex@acme.example",
      DesiredDeliveryMediums: ["EMAIL"],
      MessageAction: "RESEND",
    });
  });

  it("resets the temp password and uses Resend for existing pending users when the channel is active", async () => {
    cognitoSendMock
      .mockRejectedValueOnce({ name: "UsernameExistsException" })
      .mockResolvedValueOnce({
        UserStatus: "FORCE_CHANGE_PASSWORD",
        UserAttributes: [{ Name: "sub", Value: "cognito-user-1" }],
      })
      .mockResolvedValueOnce({});
    selectRowsQueue.push(
      [
        {
          id: "provider-1",
          tenant_id: "tenant-A",
          provider: "resend",
          status: "ready",
          active_for_production: true,
          credential_secret_ref: "resend/api-key",
          default_from_email: "noreply@thinkwork.ai",
        },
      ],
      [],
      [],
    );
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

    await inviteMember(
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

    const passwordCommand = cognitoSendMock.mock.calls[2]?.[0] as {
      input?: {
        Username?: string;
        Password?: string;
        Permanent?: boolean;
        MessageAction?: string;
      };
    };
    expect(passwordCommand.input).toMatchObject({
      Username: "alex@acme.example",
      Permanent: false,
    });
    expect(passwordCommand.input?.Password).toMatch(/Aa1!$/);
    expect(passwordCommand.input?.MessageAction).toBeUndefined();
    expect(emailChannelSendMock).toHaveBeenCalledOnce();
  });
});
