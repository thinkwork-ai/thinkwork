import {
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  buildCognitoCustomAuthChallengeInput,
  buildCognitoCustomAuthStartInput,
  buildWorkosAuthorizeUrl,
  buildWorkosLogoutUrl,
  proveWorkosPrimaryExchange,
  validateCognitoBridgeClaims,
} from "../src/lib/workos-primary-auth-spike.js";

async function main() {
  const apiBase = process.env.WORKOS_API_BASE_URL || undefined;
  const clientId = requiredEnv("WORKOS_CLIENT_ID");
  const clientSecret = requiredEnv("WORKOS_CLIENT_SECRET");
  const redirectUri = requiredEnv("WORKOS_REDIRECT_URI");
  const state = process.env.WORKOS_STATE || `thnk43-u1-${Date.now()}`;
  const provider = process.env.WORKOS_PROVIDER || "GoogleOAuth";
  const prompt = process.env.WORKOS_PROMPT || "select_account";
  const code = process.env.WORKOS_CODE || "";

  const authorizeUrl = buildWorkosAuthorizeUrl({
    apiBase,
    clientId,
    redirectUri,
    state,
    provider,
    prompt,
  });
  console.log("Open this WorkOS URL in a non-production browser session:");
  console.log(authorizeUrl);

  if (!code) {
    console.log("");
    console.log(
      "Set WORKOS_CODE from the callback query string to complete the token proof.",
    );
    return;
  }

  const proof = await proveWorkosPrimaryExchange({
    apiBase,
    clientId,
    clientSecret,
    code,
    ipAddress: process.env.WORKOS_REQUEST_IP,
    userAgent: process.env.WORKOS_REQUEST_USER_AGENT,
  });
  console.log("WorkOS user:", redactUserInfo(proof.user));
  console.log("WorkOS sid present:", proof.sessionId);
  console.log(
    "WorkOS logout URL:",
    buildWorkosLogoutUrl({
      apiBase,
      sessionId: proof.sessionId,
      returnTo: process.env.WORKOS_LOGOUT_RETURN_TO,
    }),
  );

  if (process.env.RUN_COGNITO_CUSTOM_AUTH !== "1") {
    console.log("");
    console.log(
      "Set RUN_COGNITO_CUSTOM_AUTH=1 plus Cognito env vars to run the custom-auth bridge prototype.",
    );
    return;
  }

  const userPoolId = requiredEnv("COGNITO_USER_POOL_ID");
  const cognitoClientId = requiredEnv("COGNITO_APP_CLIENT_ID");
  const username = process.env.COGNITO_USERNAME || proof.user.email || "";
  if (!username) {
    throw new Error("COGNITO_USERNAME or WorkOS userinfo email is required");
  }
  const bridgeId = process.env.COGNITO_BRIDGE_ID || `bridge-${Date.now()}`;
  const bridgeAnswer = requiredEnv("COGNITO_BRIDGE_ANSWER");
  const cognito = new CognitoIdentityProviderClient({
    region: process.env.AWS_REGION || "us-east-1",
  });

  const start = await cognito.send(
    new AdminInitiateAuthCommand(
      buildCognitoCustomAuthStartInput({
        userPoolId,
        clientId: cognitoClientId,
        username,
        bridgeId,
        workosUserId: proof.workosUserId,
        workosSessionId: proof.sessionId,
      }),
    ),
  );
  if (start.ChallengeName !== "CUSTOM_CHALLENGE" || !start.Session) {
    throw new Error(
      `Expected CUSTOM_CHALLENGE, got ${start.ChallengeName ?? "tokens"}`,
    );
  }

  const challenge = await cognito.send(
    new AdminRespondToAuthChallengeCommand(
      buildCognitoCustomAuthChallengeInput({
        userPoolId,
        clientId: cognitoClientId,
        username,
        bridgeId,
        bridgeAnswer,
        workosUserId: proof.workosUserId,
        workosSessionId: proof.sessionId,
        session: start.Session,
      }),
    ),
  );
  const idToken = challenge.AuthenticationResult?.IdToken;
  if (!idToken) throw new Error("Cognito custom-auth response had no ID token");

  const claimsCheck = validateCognitoBridgeClaims(idToken, {
    issuer: `https://cognito-idp.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com/${userPoolId}`,
    audience: cognitoClientId,
    email: proof.user.email,
    tenantId: process.env.EXPECTED_TENANT_ID,
  });
  if (!claimsCheck.ok) {
    throw new Error(
      `Cognito bridge token missing claims: ${claimsCheck.missing.join(", ")}`,
    );
  }
  console.log("Cognito custom-auth bridge token contract: ok");
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function redactUserInfo(user: Record<string, unknown>): Record<string, unknown> {
  return {
    id: user.id,
    email: typeof user.email === "string" ? redactEmail(user.email) : undefined,
    email_verified: user.email_verified,
    name: typeof user.name === "string" ? "[redacted]" : undefined,
  };
}

function redactEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "[redacted]";
  return `${local.slice(0, 2)}***@${domain}`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
