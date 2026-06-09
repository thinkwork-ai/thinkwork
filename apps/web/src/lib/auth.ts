import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
  CognitoUserAttribute,
} from "amazon-cognito-identity-js";
import type { TokenStorage } from "./token-storage";
import { LocalStorageTokenStorage } from "./token-storage/local-storage";
import { readRuntimeEnv } from "./runtime-config";

// ---------------------------------------------------------------------------
// Config — lazy-init to avoid crashing when env vars aren't set (local dev)
// ---------------------------------------------------------------------------
let _userPool: CognitoUserPool | null = null;
let tokenStorage: TokenStorage = new LocalStorageTokenStorage();
const TOKEN_REFRESH_SKEW_MS = 30_000;

export function configureTokenStorage(storage: TokenStorage): void {
  if (tokenStorage === storage) return;
  tokenStorage = storage;
  _userPool = null;
}

export function getTokenStorage(): TokenStorage {
  return tokenStorage;
}

function getUserPool(): CognitoUserPool | null {
  const userPoolId = readRuntimeEnv("VITE_COGNITO_USER_POOL_ID");
  const clientId = readRuntimeEnv("VITE_COGNITO_CLIENT_ID");
  if (!userPoolId || !clientId) return null;
  if (!_userPool) {
    _userPool = new CognitoUserPool({
      UserPoolId: userPoolId,
      ClientId: clientId,
      Storage: tokenStorage as unknown as Storage,
    });
  }
  return _userPool;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface AuthUser {
  email: string;
  name?: string;
  sub: string;
  tenantId?: string;
  groups: string[];
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------
export function signIn(
  email: string,
  password: string,
  newPassword?: string,
): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    const pool = getUserPool();
    if (!pool) return reject(new Error("Auth not configured"));

    const user = new CognitoUser({ Username: email, Pool: pool });
    const authDetails = new AuthenticationDetails({
      Username: email,
      Password: password,
    });

    user.authenticateUser(authDetails, {
      onSuccess: (session) => resolve(session),
      onFailure: (err) => reject(err),
      newPasswordRequired: () => {
        if (newPassword) {
          // Pass empty attributes — avoids "non-writable attributes" errors
          user.completeNewPasswordChallenge(
            newPassword,
            {},
            {
              onSuccess: (session) => resolve(session),
              onFailure: (err) => reject(err),
            },
          );
        } else {
          // Signal that a new password is needed
          reject(
            Object.assign(new Error("New password required"), {
              code: "NewPasswordRequired",
            }),
          );
        }
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------
export function signUp(
  email: string,
  password: string,
  name: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const pool = getUserPool();
    if (!pool) return reject(new Error("Auth not configured"));

    const attributes: CognitoUserAttribute[] = [
      new CognitoUserAttribute({ Name: "email", Value: email }),
      new CognitoUserAttribute({ Name: "name", Value: name }),
    ];

    pool.signUp(email, password, attributes, [], (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Confirm sign-up (verification code)
// ---------------------------------------------------------------------------
export function confirmSignUp(email: string, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const pool = getUserPool();
    if (!pool) return reject(new Error("Auth not configured"));

    const user = new CognitoUser({ Username: email, Pool: pool });
    user.confirmRegistration(code, true, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Forgot password — send a reset code to the user's email
// ---------------------------------------------------------------------------
export function forgotPassword(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const pool = getUserPool();
    if (!pool) return reject(new Error("Auth not configured"));

    const user = new CognitoUser({ Username: email, Pool: pool });
    user.forgotPassword({
      onSuccess: () => resolve(),
      onFailure: (err) => reject(err),
    });
  });
}

// ---------------------------------------------------------------------------
// Confirm forgot password — submit the code and a new password
// ---------------------------------------------------------------------------
export function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const pool = getUserPool();
    if (!pool) return reject(new Error("Auth not configured"));

    const user = new CognitoUser({ Username: email, Pool: pool });
    user.confirmPassword(code, newPassword, {
      onSuccess: () => resolve(),
      onFailure: (err) => reject(err),
    });
  });
}

// ---------------------------------------------------------------------------
// Sign out
// ---------------------------------------------------------------------------
// Clears local Cognito tokens AND the Cognito hosted-UI session cookie by
// redirecting through `/logout`. Without the hosted-UI logout, a subsequent
// "Continue with Google" silently re-uses the existing Cognito session and
// never reaches Google's account chooser.
export function signOut(): void {
  clearLocalAuthSession();

  const clientId = readRuntimeEnv("VITE_COGNITO_CLIENT_ID");
  if (!clientId) {
    window.location.href = "/sign-in";
    return;
  }

  // logout_uri must exactly match an entry in the Cognito user-pool client's
  // LogoutURLs allowlist. The Terraform module registers bare origins (not
  // `/sign-in`), so target the origin here and let the `_authed` route guard
  // bounce the unauthenticated user to `/sign-in`.
  const params = new URLSearchParams({
    client_id: clientId,
    logout_uri: window.location.origin,
  });
  window.location.href = `${getCognitoDomainBase()}/logout?${params.toString()}`;
}

export function clearLocalAuthSession(): void {
  const pool = getUserPool();
  pool?.getCurrentUser()?.signOut();
}

// ---------------------------------------------------------------------------
// Get current session (refreshes tokens if needed)
// ---------------------------------------------------------------------------
export function getCurrentSession(): Promise<CognitoUserSession | null> {
  return new Promise((resolve) => {
    const pool = getUserPool();
    if (!pool) {
      resolve(null);
      return;
    }

    const user = pool.getCurrentUser();
    if (!user) {
      resolve(null);
      return;
    }

    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        resolve(null);
        return;
      }
      resolve(session);
    });
  });
}

// ---------------------------------------------------------------------------
// Token helpers — fall back to raw localStorage for OAuth sessions
// ---------------------------------------------------------------------------

function getStoredTokenName(): string | null {
  const prefix = `CognitoIdentityServiceProvider.${readRuntimeEnv("VITE_COGNITO_CLIENT_ID")}`;
  return tokenStorage.getItem(`${prefix}.LastAuthUser`);
}

function getStoredToken(kind: "idToken" | "accessToken" | "refreshToken") {
  const prefix = `CognitoIdentityServiceProvider.${readRuntimeEnv("VITE_COGNITO_CLIENT_ID")}`;
  const lastUser = getStoredTokenName();
  if (!lastUser) return null;
  return tokenStorage.getItem(`${prefix}.${lastUser}.${kind}`);
}

function getStoredIdToken(): string | null {
  return getStoredToken("idToken");
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split(".");
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isExpiredJwt(token: string): boolean {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  return (
    typeof exp === "number" && exp * 1000 <= Date.now() + TOKEN_REFRESH_SKEW_MS
  );
}

async function refreshStoredOAuthSession(): Promise<{
  idToken: string;
  accessToken: string;
} | null> {
  const username = getStoredTokenName();
  const refreshToken = getStoredToken("refreshToken");
  const clientId = readRuntimeEnv("VITE_COGNITO_CLIENT_ID");
  const cognitoDomain = readRuntimeEnv("VITE_COGNITO_DOMAIN");
  if (!username || !refreshToken || !clientId || !cognitoDomain) return null;

  const response = await fetch(`${getCognitoDomainBase()}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) return null;

  const raw = (await response.json()) as Record<string, unknown>;
  if (
    typeof raw.id_token !== "string" ||
    typeof raw.access_token !== "string"
  ) {
    return null;
  }

  const prefix = `CognitoIdentityServiceProvider.${clientId}`;
  tokenStorage.setItem(`${prefix}.${username}.idToken`, raw.id_token);
  tokenStorage.setItem(`${prefix}.${username}.accessToken`, raw.access_token);
  tokenStorage.setItem(`${prefix}.${username}.clockDrift`, "0");
  if (typeof raw.refresh_token === "string") {
    tokenStorage.setItem(
      `${prefix}.${username}.refreshToken`,
      raw.refresh_token,
    );
  }

  return { idToken: raw.id_token, accessToken: raw.access_token };
}

export async function getAccessToken(): Promise<string | null> {
  const session = await getCurrentSession();
  if (session) return session.getAccessToken().getJwtToken();
  // Fallback for OAuth sessions
  const stored = getStoredToken("accessToken");
  if (stored && !isExpiredJwt(stored)) return stored;
  return (await refreshStoredOAuthSession())?.accessToken ?? null;
}

export async function getIdToken(): Promise<string | null> {
  const session = await getCurrentSession();
  if (session) return session.getIdToken().getJwtToken();
  // Fallback for OAuth sessions where amazon-cognito-identity-js can't
  // reconstruct the session (no SRP verifier for federated users)
  const stored = getStoredIdToken();
  if (stored && !isExpiredJwt(stored)) return stored;
  return (await refreshStoredOAuthSession())?.idToken ?? null;
}

// ---------------------------------------------------------------------------
// Current user (synchronous — reads from last-known session)
// ---------------------------------------------------------------------------
export function getCurrentUser(): AuthUser | null {
  const pool = getUserPool();
  if (!pool) return null;

  const user = pool.getCurrentUser();
  if (!user) return null;

  let authUser: AuthUser | null = null;

  user.getSession((err: Error | null, session: CognitoUserSession | null) => {
    if (err || !session || !session.isValid()) return;
    authUser = parseIdToken(session);
  });

  // Fallback: parse id token directly from token storage (OAuth sessions)
  if (!authUser) {
    const rawToken = getStoredIdToken();
    if (rawToken && !isExpiredJwt(rawToken)) {
      const payload = decodeJwtPayload(rawToken);
      if (payload) {
        authUser = {
          email: (payload["email"] as string) ?? "",
          name: (payload["name"] as string) ?? undefined,
          sub: (payload["sub"] as string) ?? "",
          tenantId: (payload["custom:tenant_id"] as string) ?? undefined,
          groups: (payload["cognito:groups"] as string[]) ?? [],
        };
      }
    }
  }

  return authUser;
}

// ---------------------------------------------------------------------------
// Parse JWT claims from the id token
// ---------------------------------------------------------------------------
function parseIdToken(session: CognitoUserSession): AuthUser {
  const payload = session.getIdToken().decodePayload();
  return {
    email: (payload["email"] as string) ?? "",
    name: (payload["name"] as string) ?? undefined,
    sub: (payload["sub"] as string) ?? "",
    tenantId: (payload["custom:tenant_id"] as string) ?? undefined,
    groups: (payload["cognito:groups"] as string[]) ?? [],
  };
}

// ---------------------------------------------------------------------------
// Cognito hosted UI sign-in
// ---------------------------------------------------------------------------

function getCognitoDomainBase(): string {
  const raw = readRuntimeEnv("VITE_COGNITO_DOMAIN").replace(/\/$/, "");
  // If it's already a full URL, use as-is
  if (raw.startsWith("https://")) return raw;
  // Otherwise treat it as the domain prefix
  return `https://${raw}.auth.us-east-1.amazoncognito.com`;
}

export function getGoogleSignInUrl(): string {
  return getHostedSignInUrl({
    identityProvider: "Google",
    prompt: "select_account",
  });
}

export function getHostedSignInUrl(options?: {
  identityProvider?: string;
  prompt?: string;
}): string {
  const redirectUri = `${window.location.origin}/auth/callback`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: readRuntimeEnv("VITE_COGNITO_CLIENT_ID"),
    redirect_uri: redirectUri,
    scope: "openid email profile",
  });
  if (options?.identityProvider) {
    params.set("identity_provider", options.identityProvider);
  }
  if (options?.prompt) {
    params.set("prompt", options.prompt);
  }
  return `${getCognitoDomainBase()}/oauth2/authorize?${params.toString()}`;
}

const POST_AUTH_REDIRECT_KEY = "thinkwork:post-auth-redirect";

export function rememberPostAuthRedirect(path: string): void {
  if (!path.startsWith("/") || path.startsWith("//")) return;
  sessionStorage.setItem(POST_AUTH_REDIRECT_KEY, path);
}

export function consumePostAuthRedirect(fallback = "/new"): string {
  const stored = sessionStorage.getItem(POST_AUTH_REDIRECT_KEY);
  sessionStorage.removeItem(POST_AUTH_REDIRECT_KEY);
  if (!stored || !stored.startsWith("/") || stored.startsWith("//")) {
    return fallback;
  }
  return stored;
}

interface OAuthTokens {
  id_token: string;
  access_token: string;
  refresh_token: string;
}

export async function exchangeCodeForSession(
  code: string,
): Promise<OAuthTokens> {
  const redirectUri = `${window.location.origin}/auth/callback`;
  const base = getCognitoDomainBase();

  const res = await fetch(`${base}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: readRuntimeEnv("VITE_COGNITO_CLIENT_ID"),
      redirect_uri: redirectUri,
      code,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${text}`);
  }

  // Runtime guard: validate the response shape rather than trusting an
  // implicit `any` cast from `res.json()`. A misconfigured Cognito domain,
  // a network proxy returning HTML, or a future endpoint change would
  // otherwise silently propagate undefined fields into localStorage and
  // produce an unhelpful "missing token" failure later.
  const raw = (await res.json()) as Record<string, unknown>;
  if (
    typeof raw.id_token !== "string" ||
    typeof raw.access_token !== "string" ||
    typeof raw.refresh_token !== "string"
  ) {
    throw new Error("Token exchange returned an unexpected response shape");
  }
  return {
    id_token: raw.id_token,
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
  };
}

export function storeTokensInCognitoStorage(tokens: OAuthTokens): void {
  // Decode the id token to extract the username (sub claim)
  const payload = JSON.parse(atob(tokens.id_token.split(".")[1]));
  const username = payload["cognito:username"] || payload["sub"];

  const prefix = `CognitoIdentityServiceProvider.${readRuntimeEnv("VITE_COGNITO_CLIENT_ID")}`;

  tokenStorage.setItem(`${prefix}.${username}.idToken`, tokens.id_token);
  tokenStorage.setItem(
    `${prefix}.${username}.accessToken`,
    tokens.access_token,
  );
  tokenStorage.setItem(
    `${prefix}.${username}.refreshToken`,
    tokens.refresh_token,
  );
  tokenStorage.setItem(`${prefix}.LastAuthUser`, username);
}
