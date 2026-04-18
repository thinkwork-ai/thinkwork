import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  type CognitoUserSession,
} from "amazon-cognito-identity-js";
import { cognitoStorage } from "./secure-storage";
import type { ThinkworkConfig, ThinkworkUser } from "../types";

let pool: CognitoUserPool | null = null;

function getPool(config: ThinkworkConfig): CognitoUserPool {
  if (pool) return pool;
  pool = new CognitoUserPool({
    UserPoolId: config.cognito.userPoolId,
    ClientId: config.cognito.userPoolClientId,
    Storage: cognitoStorage as unknown as Storage,
  });
  return pool;
}

export async function waitForStorageReady(): Promise<void> {
  await cognitoStorage.hydrate();
}

export async function signIn(
  config: ThinkworkConfig,
  email: string,
  password: string,
): Promise<CognitoUserSession> {
  const user = new CognitoUser({
    Username: email,
    Pool: getPool(config),
    Storage: cognitoStorage as unknown as Storage,
  });
  user.setAuthenticationFlowType("USER_PASSWORD_AUTH");
  const details = new AuthenticationDetails({ Username: email, Password: password });
  return new Promise((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: resolve,
      onFailure: reject,
      newPasswordRequired: () =>
        reject(new Error("Password change required. Reset via the ThinkWork web app first.")),
    });
  });
}

export function signOut(config: ThinkworkConfig): void {
  const current = getPool(config).getCurrentUser();
  current?.signOut();
}

export async function getCurrentSession(
  config: ThinkworkConfig,
): Promise<CognitoUserSession | null> {
  const user = getPool(config).getCurrentUser();
  if (!user) return null;
  return new Promise((resolve) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) resolve(null);
      else resolve(session);
    });
  });
}

export async function getIdToken(config: ThinkworkConfig): Promise<string | null> {
  const session = await getCurrentSession(config);
  return session?.getIdToken().getJwtToken() ?? null;
}

export function parseUserFromSession(session: CognitoUserSession): ThinkworkUser {
  const payload = session.getIdToken().decodePayload() as Record<string, unknown>;
  return {
    sub: String(payload.sub ?? ""),
    email: String(payload.email ?? ""),
    name: typeof payload.name === "string" ? payload.name : undefined,
    tenantId:
      typeof payload["custom:tenant_id"] === "string"
        ? (payload["custom:tenant_id"] as string)
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// OAuth — Google sign-in via Cognito hosted UI
// ---------------------------------------------------------------------------

export interface OAuthTokens {
  id_token: string;
  access_token: string;
  refresh_token: string;
}

export function getGoogleSignInUrl(config: ThinkworkConfig): string {
  const domain = config.cognito.hostedUiDomain;
  const redirectUri = config.oauthRedirectUri;
  if (!domain || !redirectUri) {
    throw new Error(
      "Google sign-in requires `cognito.hostedUiDomain` and `oauthRedirectUri` in ThinkworkConfig.",
    );
  }
  const params = new URLSearchParams({
    identity_provider: "Google",
    response_type: "code",
    client_id: config.cognito.userPoolClientId,
    redirect_uri: redirectUri,
    scope: "openid email profile",
  });
  return `${domain}/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  config: ThinkworkConfig,
  code: string,
): Promise<OAuthTokens> {
  const domain = config.cognito.hostedUiDomain;
  const redirectUri = config.oauthRedirectUri;
  if (!domain || !redirectUri) throw new Error("OAuth config incomplete");
  const res = await fetch(`${domain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.cognito.userPoolClientId,
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  return res.json();
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length < 2) return {};
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(globalThis.atob(base64));
}

/** Store OAuth tokens in CognitoSecureStorage using Cognito's key format so `getCurrentSession` picks them up. */
export function storeOAuthTokens(config: ThinkworkConfig, tokens: OAuthTokens): ThinkworkUser {
  const payload = decodeJwtPayload(tokens.id_token);
  const clientId = config.cognito.userPoolClientId;
  const username = String(payload["sub"] ?? payload["cognito:username"] ?? "");
  const prefix = `CognitoIdentityServiceProvider.${clientId}`;
  cognitoStorage.setItem(`${prefix}.LastAuthUser`, username);
  cognitoStorage.setItem(`${prefix}.${username}.idToken`, tokens.id_token);
  cognitoStorage.setItem(`${prefix}.${username}.accessToken`, tokens.access_token);
  cognitoStorage.setItem(`${prefix}.${username}.refreshToken`, tokens.refresh_token);
  cognitoStorage.setItem(`${prefix}.${username}.clockDrift`, "0");
  return {
    sub: String(payload["sub"] ?? ""),
    email: String(payload["email"] ?? ""),
    name: typeof payload["name"] === "string" ? (payload["name"] as string) : undefined,
    tenantId:
      typeof payload["custom:tenant_id"] === "string"
        ? (payload["custom:tenant_id"] as string)
        : undefined,
  };
}
