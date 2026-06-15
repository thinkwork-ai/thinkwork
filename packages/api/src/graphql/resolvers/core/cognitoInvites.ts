import {
  AdminCreateUserCommand,
  type AdminCreateUserCommandOutput,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { NodeHttpHandler } from "@smithy/node-http-handler";

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
