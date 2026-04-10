/**
 * Cognito Pre Sign Up Lambda Trigger
 *
 * Auto-links federated (Google) users to existing email/password accounts.
 * When a Google user signs in for the first time, Cognito creates a new user.
 * This trigger detects the duplicate email, links the external provider to the
 * existing native account, and throws to prevent the duplicate from being created.
 * Cognito then retries and succeeds with the linked account.
 */

import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminLinkProviderForUserCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const cognito = new CognitoIdentityProviderClient({});

interface PreSignUpEvent {
  triggerSource: string;
  userPoolId: string;
  userName: string;
  request: {
    userAttributes: Record<string, string>;
  };
  response: {
    autoConfirmUser: boolean;
    autoVerifyEmail: boolean;
    autoVerifyPhone: boolean;
  };
}

export async function handler(event: PreSignUpEvent): Promise<PreSignUpEvent> {
  // Only handle external provider sign-ups (e.g., Google federated login)
  if (event.triggerSource !== "PreSignUp_ExternalProvider") {
    return event;
  }

  const email = event.request.userAttributes.email;
  if (!email) return event;

  // Check if a native (email/password) user already exists with this email
  const existing = await cognito.send(
    new ListUsersCommand({
      UserPoolId: event.userPoolId,
      Filter: `email = "${email}"`,
    }),
  );

  // Find a native (non-external) user with this email
  const nativeUser = existing.Users?.find(
    (u) =>
      u.UserStatus !== "EXTERNAL_PROVIDER" &&
      u.Attributes?.some(
        (a) => a.Name === "email" && a.Value === email,
      ),
  );

  // Extract provider info from the federated userName (e.g., "google_12345")
  // Cognito lowercases the provider prefix in userName, but AdminLinkProviderForUser
  // needs the exact provider name as configured (e.g., "Google" not "google").
  const PROVIDER_NAME_MAP: Record<string, string> = {
    google: "Google",
  };

  const rawPrefix = event.userName.includes("_")
    ? event.userName.split("_")[0]
    : null;
  const providerName = rawPrefix ? (PROVIDER_NAME_MAP[rawPrefix] ?? rawPrefix) : null;
  const providerUserId = event.userName.includes("_")
    ? event.userName.split("_").slice(1).join("_")
    : null;

  if (!providerName || !providerUserId) {
    return event;
  }

  if (nativeUser?.Username) {
    // Link the external provider to the existing native user
    await cognito.send(
      new AdminLinkProviderForUserCommand({
        UserPoolId: event.userPoolId,
        DestinationUser: {
          ProviderName: "Cognito",
          ProviderAttributeValue: nativeUser.Username,
        },
        SourceUser: {
          ProviderName: providerName,
          ProviderAttributeName: "Cognito_Subject",
          ProviderAttributeValue: providerUserId,
        },
      }),
    );
  } else {
    // No native user exists — create one so the link has a destination,
    // then link the external provider to it.
    const tempPassword = `Temp${Date.now()}!Aa`;
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: event.userPoolId,
        Username: email,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
          ...(event.request.userAttributes.name
            ? [{ Name: "name", Value: event.request.userAttributes.name }]
            : []),
        ],
        MessageAction: "SUPPRESS",
      }),
    );
    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: event.userPoolId,
        Username: email,
        Password: tempPassword,
        Permanent: true,
      }),
    );

    await cognito.send(
      new AdminLinkProviderForUserCommand({
        UserPoolId: event.userPoolId,
        DestinationUser: {
          ProviderName: "Cognito",
          ProviderAttributeValue: email,
        },
        SourceUser: {
          ProviderName: providerName,
          ProviderAttributeName: "Cognito_Subject",
          ProviderAttributeValue: providerUserId,
        },
      }),
    );
  }

  // Throw to prevent Cognito from creating a duplicate external-provider user.
  // Cognito will retry the sign-in, find the now-linked account, and succeed.
  throw new Error("Provider linked — retrying authentication");
}
