import {
  handleCognitoCustomAuthChallenge,
  type CognitoCustomAuthEvent,
} from "../lib/workos-cognito-bridge.js";

export async function handler(
  event: CognitoCustomAuthEvent,
): Promise<CognitoCustomAuthEvent> {
  return handleCognitoCustomAuthChallenge(event);
}
