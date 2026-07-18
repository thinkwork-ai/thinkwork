/**
 * Reject token issuance and refresh for explicitly denied Cognito app clients.
 *
 * API admission remains the primary dynamic boundary. This trigger is the
 * cutover circuit breaker: once legacy clients enter `denied`, Cognito cannot
 * mint or refresh another token for them while already-issued JWTs drain.
 */

interface CognitoPreTokenEvent {
  triggerSource: string;
  callerContext?: { clientId?: string };
  response: Record<string, unknown>;
}

export class CognitoClientDeniedError extends Error {
  constructor() {
    super("Authentication client is disabled");
    this.name = "CognitoClientDeniedError";
  }
}

export function deniedCognitoClientIds(
  value = process.env.COGNITO_DENIED_APP_CLIENT_IDS ?? "",
): Set<string> {
  return new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

export async function handler<T extends CognitoPreTokenEvent>(
  event: T,
): Promise<T> {
  const clientId = event.callerContext?.clientId;
  if (clientId && deniedCognitoClientIds().has(clientId)) {
    console.warn("[cognito-pre-token-client-deny] blocked token issuance", {
      clientId,
      triggerSource: event.triggerSource,
    });
    throw new CognitoClientDeniedError();
  }
  return event;
}
