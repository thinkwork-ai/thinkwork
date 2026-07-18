import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("@aws-sdk/client-cognito-identity-provider", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@aws-sdk/client-cognito-identity-provider")
    >();
  return {
    ...actual,
    CognitoIdentityProviderClient: vi.fn(() => ({ send: sendMock })),
  };
});

import { handler } from "./cognito-pre-signup.js";

function event(overrides: Record<string, unknown> = {}) {
  return {
    triggerSource: "PreSignUp_ExternalProvider",
    userPoolId: "pool-1",
    userName: "google_subject-1",
    request: {
      userAttributes: {
        email: "person@example.com",
        email_verified: "false",
        name: "Example Person",
      },
    },
    response: {
      autoConfirmUser: false,
      autoVerifyEmail: false,
      autoVerifyPhone: false,
    },
    ...overrides,
  };
}

function callsNamed(name: string) {
  return sendMock.mock.calls
    .map(([command]) => command)
    .filter((command) => command.constructor.name === name);
}

beforeEach(() => {
  sendMock.mockReset();
});

describe("Cognito pre-sign-up current behavior", () => {
  it("links an external identity to an email-matched native user even when the asserted email is unverified", async () => {
    sendMock
      .mockResolvedValueOnce({
        Users: [
          {
            Username: "native-user",
            UserStatus: "CONFIRMED",
            Attributes: [{ Name: "email", Value: "person@example.com" }],
          },
        ],
      })
      .mockResolvedValueOnce({});

    await expect(handler(event() as never)).rejects.toThrow("Provider linked");

    expect(callsNamed("AdminLinkProviderForUserCommand")).toHaveLength(1);
    expect(callsNamed("AdminLinkProviderForUserCommand")[0].input).toEqual({
      UserPoolId: "pool-1",
      DestinationUser: {
        ProviderName: "Cognito",
        ProviderAttributeValue: "native-user",
      },
      SourceUser: {
        ProviderName: "Google",
        ProviderAttributeName: "Cognito_Subject",
        ProviderAttributeValue: "subject-1",
      },
    });
  });

  it("creates a native user with a permanent generated password before linking when no match exists", async () => {
    sendMock.mockResolvedValue({ Users: [] });

    await expect(handler(event() as never)).rejects.toThrow("Provider linked");

    expect(
      sendMock.mock.calls.map(([command]) => command.constructor.name),
    ).toEqual([
      "ListUsersCommand",
      "AdminCreateUserCommand",
      "AdminSetUserPasswordCommand",
      "AdminLinkProviderForUserCommand",
    ]);
    expect(callsNamed("AdminSetUserPasswordCommand")[0].input).toMatchObject({
      UserPoolId: "pool-1",
      Username: "person@example.com",
      Permanent: true,
    });
    expect(callsNamed("AdminSetUserPasswordCommand")[0].input.Password).toMatch(
      /^Temp\d+!Aa$/,
    );
  });

  it("passes an unknown provider prefix through verbatim", async () => {
    sendMock.mockResolvedValue({
      Users: [
        {
          Username: "native-user",
          UserStatus: "CONFIRMED",
          Attributes: [{ Name: "email", Value: "person@example.com" }],
        },
      ],
    });

    await expect(
      handler(event({ userName: "tenantoidc_subject_with_parts" }) as never),
    ).rejects.toThrow("Provider linked");

    expect(
      callsNamed("AdminLinkProviderForUserCommand")[0].input.SourceUser,
    ).toMatchObject({
      ProviderName: "tenantoidc",
      ProviderAttributeValue: "subject_with_parts",
    });
  });

  it("does nothing for non-external triggers, missing emails, or malformed provider usernames", async () => {
    const nonExternal = event({ triggerSource: "PreSignUp_SignUp" });
    expect(await handler(nonExternal as never)).toBe(nonExternal);

    const missingEmail = event({
      request: { userAttributes: {} },
    });
    expect(await handler(missingEmail as never)).toBe(missingEmail);

    sendMock.mockResolvedValueOnce({ Users: [] });
    const malformed = event({ userName: "no-provider-separator" });
    expect(await handler(malformed as never)).toBe(malformed);
    expect(callsNamed("AdminLinkProviderForUserCommand")).toHaveLength(0);
  });
});
