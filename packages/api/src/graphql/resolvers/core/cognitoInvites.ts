import {
  AdminCreateUserCommand,
  type AdminCreateUserCommandOutput,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { NodeHttpHandler } from "@smithy/node-http-handler";

export const COGNITO_INVITE_DELIVERY_FAILURE_MESSAGE =
  "Invite delivery failed because Cognito's transactional email provider rejected the send. Check Cognito/SES invite email configuration.";

const DELIVERY_FAILURE_NAMES = new Set([
  "CodeDeliveryFailureException",
  "InvalidEmailRoleAccessPolicyException",
]);

const RESENDABLE_INVITE_STATUSES = new Set([
  "FORCE_CHANGE_PASSWORD",
  "UNCONFIRMED",
]);

export function createCognitoInviteClient(): CognitoIdentityProviderClient {
  return new CognitoIdentityProviderClient({
    maxAttempts: 2,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 2_000,
      requestTimeout: 10_000,
    }),
  });
}

export function isResendableInviteStatus(status?: string | null): boolean {
  return !!status && RESENDABLE_INVITE_STATUSES.has(status);
}

export async function resendCognitoInvite(
  cognito: Pick<CognitoIdentityProviderClient, "send">,
  params: { userPoolId: string; email: string },
): Promise<AdminCreateUserCommandOutput> {
  return cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: params.userPoolId,
      Username: params.email,
      DesiredDeliveryMediums: ["EMAIL"],
      MessageAction: "RESEND",
    }),
  );
}

export function isCognitoInviteDeliveryFailure(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    typeof (err as { name?: unknown }).name === "string" &&
    DELIVERY_FAILURE_NAMES.has((err as { name: string }).name)
  );
}

export function cognitoInviteErrorName(err: unknown): string | null {
  return typeof err === "object" &&
    err !== null &&
    "name" in err &&
    typeof (err as { name?: unknown }).name === "string"
    ? (err as { name: string }).name
    : null;
}
