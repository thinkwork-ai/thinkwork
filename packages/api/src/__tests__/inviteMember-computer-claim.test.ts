import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cognitoSendMock,
  emailChannelSendMock,
  getSecretMock,
  insertCalls,
  insertReturningQueue,
  selectRowsQueue,
  transactionMock,
  mockRequireTenantAdmin,
  issueEnrollmentGrantsMock,
} = vi.hoisted(() => ({
  cognitoSendMock: vi.fn(),
  emailChannelSendMock: vi.fn(),
  getSecretMock: vi.fn(),
  insertCalls: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  insertReturningQueue: [] as unknown[][],
  selectRowsQueue: [] as unknown[][],
  transactionMock: vi.fn(),
  mockRequireTenantAdmin: vi.fn(),
  issueEnrollmentGrantsMock: vi.fn(),
}));

vi.mock("../handlers/auth-enrollment.js", () => ({
  issueEnrollmentGrants: issueEnrollmentGrantsMock,
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
  const users = {
    id: "users.id",
    email: "users.email",
    cognito_sub: "users.cognito_sub",
  };
  const tenantMembers = {
    tenant_id: "tenantMembers.tenant_id",
    principal_id: "tenantMembers.principal_id",
  };

  const db = {
    transaction: transactionMock,
    select: vi.fn(() => ({
      from: () => ({
        where: () => Promise.resolve(selectRowsQueue.shift() ?? []),
      }),
    })),
    insert: vi.fn((table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        insertCalls.push({ table, values });
        return {
          returning: () => Promise.resolve(insertReturningQueue.shift() ?? []),
        };
      },
    })),
  };
  transactionMock.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  );

  return {
    users,
    tenantMembers,
    db,
    eq: (...args: unknown[]) => ({ _eq: args }),
    and: (...args: unknown[]) => ({ _and: args }),
    or: (...args: unknown[]) => ({ _or: args }),
    randomBytes: () => Buffer.from("temporarypass12"),
    snakeToCamel: (row: Record<string, unknown>) => row,
  };
});

// eslint-disable-next-line import/first
import { inviteMember } from "../graphql/resolvers/core/inviteMember.mutation.js";

describe("inviteMember onboarding claim", () => {
  beforeEach(() => {
    vi.stubEnv("AWS_REGION", "us-east-1");
    cognitoSendMock.mockReset();
    emailChannelSendMock.mockReset();
    getSecretMock.mockReset();
    insertCalls.length = 0;
    insertReturningQueue.length = 0;
    selectRowsQueue.length = 0;
    transactionMock.mockClear();
    mockRequireTenantAdmin.mockReset();
    mockRequireTenantAdmin.mockResolvedValue("admin");
    issueEnrollmentGrantsMock.mockResolvedValue({
      startToken: "enrollment-token",
      recipientChallenge: "12345678",
      expiresAt: new Date("2026-07-18T18:00:00Z"),
      routeKeys: ["google-web"],
    });
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
    selectRowsQueue.push(
      [],
      [],
      [],
      [
        {
          id: "connection-local",
          connection_key: "local",
          validation_status: "valid",
        },
      ],
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
      {
        tenant_id: "tenant-A",
        user_id: "cognito-user-1",
        auth_provider_resource_id: "connection-local",
        cognito_issuer: "https://cognito-idp.us-east-1.amazonaws.com/pool-1",
        cognito_sub: "cognito-user-1",
        provider_issuer: "https://cognito-idp.us-east-1.amazonaws.com/pool-1",
        provider_subject: "cognito-user-1",
        status: "active",
        proof_kind: "cognito_temporary_password_invite",
        evidence: {
          source: "cognito_default_invite",
          userPoolId: "pool-1",
          connectionKey: "local",
        },
        activated_at: expect.any(Date),
      },
    ]);
    expect(result).toMatchObject({
      tenant_id: "tenant-A",
      principal_id: "cognito-user-1",
      role: "member",
    });
    expect(emailChannelSendMock).not.toHaveBeenCalled();
    expect(transactionMock).toHaveBeenCalledOnce();
  });

  it.each([
    {
      conflict: "ThinkWork user",
      identityUserId: "different-thinkwork-user",
      identityResourceId: "connection-local",
    },
    // Multi-lane (0288): a row on ANOTHER connection is only a conflict
    // when it maps the subject to a DIFFERENT user — the cross-user guard.
    // The same user's other-lane row is their other admitted provider and
    // no longer blocks the local invite (covered by the test below).
    {
      conflict: "ThinkWork user on another lane",
      identityUserId: "different-thinkwork-user",
      identityResourceId: "different-local-connection",
    },
  ])("fails closed on a conflicting $conflict binding", async (conflict) => {
    cognitoSendMock.mockResolvedValueOnce({
      User: {
        Attributes: [{ Name: "sub", Value: "cognito-user-1" }],
      },
    });
    const cognitoIssuer = "https://cognito-idp.us-east-1.amazonaws.com/pool-1";
    selectRowsQueue.push(
      [],
      [
        {
          id: "thinkwork-user-1",
          cognito_sub: "cognito-user-1",
          email: "alex@acme.example",
        },
      ],
      [
        {
          id: "member-existing",
          tenant_id: "tenant-A",
          principal_type: "user",
          principal_id: "thinkwork-user-1",
          role: "member",
          status: "active",
        },
      ],
      [
        {
          id: "connection-local",
          connection_key: "local",
          validation_status: "valid",
        },
      ],
      [
        {
          user_id: conflict.identityUserId,
          auth_provider_resource_id: conflict.identityResourceId,
          cognito_issuer: cognitoIssuer,
          cognito_sub: "cognito-user-1",
          provider_issuer: cognitoIssuer,
          provider_subject: "cognito-user-1",
          status: "active",
        },
      ],
    );

    await expect(
      inviteMember(
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
      ),
    ).rejects.toMatchObject({
      extensions: { code: "IDENTITY_CONFLICT" },
    });

    expect(transactionMock).toHaveBeenCalledOnce();
    expect(insertCalls).toEqual([]);
  });

  // Multi-lane (0288): the SAME user's row on another connection is their
  // other admitted provider — the local invite enrolls the local lane
  // beside it instead of failing closed.
  it("enrolls the local lane beside the same user's other-connection identity", async () => {
    cognitoSendMock.mockResolvedValueOnce({
      User: {
        Attributes: [{ Name: "sub", Value: "cognito-user-1" }],
      },
    });
    const cognitoIssuer = "https://cognito-idp.us-east-1.amazonaws.com/pool-1";
    selectRowsQueue.push(
      [],
      [
        {
          id: "thinkwork-user-1",
          cognito_sub: "cognito-user-1",
          email: "alex@acme.example",
        },
      ],
      [
        {
          id: "member-existing",
          tenant_id: "tenant-A",
          principal_type: "user",
          principal_id: "thinkwork-user-1",
          role: "member",
          status: "active",
        },
      ],
      [
        {
          id: "connection-local",
          connection_key: "local",
          validation_status: "valid",
        },
      ],
      [
        {
          user_id: "thinkwork-user-1",
          auth_provider_resource_id: "different-local-connection",
          cognito_issuer: cognitoIssuer,
          cognito_sub: "cognito-user-1",
          provider_issuer: cognitoIssuer,
          provider_subject: "cognito-user-1",
          status: "active",
        },
      ],
    );

    await expect(
      inviteMember(
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
      ),
    ).resolves.toBeTruthy();

    expect(
      insertCalls.some(
        (call) =>
          call.values.auth_provider_resource_id === "connection-local" &&
          call.values.user_id === "thinkwork-user-1",
      ),
    ).toBe(true);
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
    expect(invitePayload.html).toContain(
      'href="https://app.test/accept-invite?token=enrollment-token"',
    );
    expect(invitePayload.html).toContain("Workspace invitation");
    expect(invitePayload.html).toContain("Temporary password");
    expect(invitePayload.text).toContain(
      "Sign in: https://app.test/accept-invite?token=enrollment-token",
    );
    expect(invitePayload.text).toContain("Enrollment code: 12345678");
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
    expect(issueEnrollmentGrantsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-A",
        intendedUserId: "cognito-user-1",
        membershipId: "member-1",
        transaction: expect.any(Object),
      }),
    );
    expect(
      insertCalls.some(
        (call) =>
          call.values.proof_kind === "cognito_temporary_password_invite",
      ),
    ).toBe(false);
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

  it("uses Cognito SES delivery when SES is explicitly active even if older Resend remains configured", async () => {
    cognitoSendMock.mockResolvedValueOnce({
      User: {
        Attributes: [{ Name: "sub", Value: "cognito-user-1" }],
      },
    });
    selectRowsQueue.push(
      [
        {
          id: "provider-resend",
          tenant_id: "tenant-A",
          provider: "resend",
          status: "ready",
          active_for_production: false,
          credential_secret_ref: "resend/api-key",
          default_from_email: "noreply@thinkwork.ai",
        },
        {
          id: "provider-ses",
          tenant_id: "tenant-A",
          provider: "ses",
          status: "ready",
          active_for_production: true,
          credential_secret_ref: null,
          default_from_email: null,
        },
      ],
      [],
      [],
      [
        {
          id: "connection-local",
          connection_key: "local",
          validation_status: "valid",
        },
      ],
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
        DesiredDeliveryMediums?: string[];
        MessageAction?: string;
        TemporaryPassword?: string;
      };
    };
    expect(createCommand.input).toMatchObject({
      DesiredDeliveryMediums: ["EMAIL"],
    });
    expect(createCommand.input?.MessageAction).toBeUndefined();
    expect(createCommand.input?.TemporaryPassword).toBeUndefined();
    expect(emailChannelSendMock).not.toHaveBeenCalled();
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
    selectRowsQueue.push(
      [],
      [],
      [],
      [
        {
          id: "connection-local",
          connection_key: "local",
          validation_status: "valid",
        },
      ],
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
