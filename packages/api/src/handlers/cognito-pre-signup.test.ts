import { describe, expect, it } from "vitest";

import { handler } from "./cognito-pre-signup.js";

function event(overrides: Record<string, unknown> = {}) {
  return {
    triggerSource: "PreSignUp_ExternalProvider",
    userPoolId: "pool-1",
    userName: "google_subject-1",
    request: {
      userAttributes: {
        email: "same-email-is-not-proof@example.com",
        email_verified: "true",
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

describe("Cognito pre-sign-up compatibility trigger", () => {
  it("leaves Google identities separate even when email is verified", async () => {
    const input = event();
    await expect(handler(input)).resolves.toBe(input);
  });

  it("does not special-case Microsoft, unknown providers, or local sign-up", async () => {
    for (const input of [
      event({ userName: "microsoftorganizations_subject" }),
      event({ userName: "tenantentra_subject" }),
      event({ triggerSource: "PreSignUp_SignUp", userName: "local-user" }),
    ]) {
      await expect(handler(input)).resolves.toBe(input);
    }
  });
});
