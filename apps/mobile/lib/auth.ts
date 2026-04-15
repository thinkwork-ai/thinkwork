/**
 * Cognito auth module for app-manager (React Native + Web)
 *
 * Uses SecureStore-backed storage on native so sessions survive app restarts.
 */

import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
  CognitoUserAttribute,
} from "amazon-cognito-identity-js";
import { CognitoSecureStorage, waitForStorageReady, isStorageReady } from "./cognito-storage";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const USER_POOL_ID = process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID || "";
const CLIENT_ID = process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID || "";
const COGNITO_DOMAIN = process.env.EXPO_PUBLIC_COGNITO_DOMAIN || "";

let _userPool: CognitoUserPool | null = null;

function getUserPool(): CognitoUserPool | null {
  if (!USER_POOL_ID || !CLIENT_ID) return null;
  if (!_userPool) {
    _userPool = new CognitoUserPool({
      UserPoolId: USER_POOL_ID,
      ClientId: CLIENT_ID,
      Storage: CognitoSecureStorage,
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
// Wait for storage to hydrate before using any auth functions
// ---------------------------------------------------------------------------
export { waitForStorageReady, isStorageReady };

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------
export function signIn(
  email: string,
  password: string,
): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    const pool = getUserPool();
    if (!pool) return reject(new Error("Auth not configured"));

    const user = new CognitoUser({
      Username: email,
      Pool: pool,
      Storage: CognitoSecureStorage,
    });

    // Use USER_PASSWORD_AUTH instead of default USER_SRP_AUTH.
    // SRP does heavy modular exponentiation in pure JS which takes 3-8 seconds
    // on React Native. USER_PASSWORD_AUTH sends the password over TLS directly,
    // which is equally secure and returns in <500ms.
    user.setAuthenticationFlowType("USER_PASSWORD_AUTH");

    const authDetails = new AuthenticationDetails({
      Username: email,
      Password: password,
    });

    user.authenticateUser(authDetails, {
      onSuccess: (session) => resolve(session),
      onFailure: (err) => reject(err),
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

    const user = new CognitoUser({
      Username: email,
      Pool: pool,
      Storage: CognitoSecureStorage,
    });
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
// Sign out
// ---------------------------------------------------------------------------
export function signOut(): void {
  const pool = getUserPool();
  if (!pool) return;

  const user = pool.getCurrentUser();
  if (user) {
    user.signOut();
  }
}

// ---------------------------------------------------------------------------
// Get current session (refreshes tokens automatically if expired)
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

    user.getSession(
      (err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session || !session.isValid()) {
          resolve(null);
          return;
        }
        resolve(session);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------
export async function getAccessToken(): Promise<string | null> {
  const session = await getCurrentSession();
  if (session) return session.getAccessToken().getJwtToken();
  // Fallback for OAuth sessions (federated users can't refresh via SRP)
  return getStoredOAuthAccessToken();
}

export async function getIdToken(): Promise<string | null> {
  const session = await getCurrentSession();
  if (session) return session.getIdToken().getJwtToken();
  // Fallback for OAuth/federated sessions: the Cognito SDK can't refresh these
  // via SRP, so we manage them ourselves. Refresh the stored id token via the
  // Cognito hosted-UI /oauth2/token endpoint if it's expired or near-expiry.
  const stored = getStoredOAuthIdToken();
  if (!stored) return null;
  if (!isJwtExpiringSoon(stored)) return stored;
  const refreshed = await refreshOAuthTokens();
  if (refreshed) return refreshed;
  // Refresh attempted and failed, AND the stored token is expired/near-expiry.
  // Returning the stale token would just cause 401 loops downstream; signal
  // unauthenticated so the caller can route the user back to sign-in.
  return null;
}

// ---------------------------------------------------------------------------
// Current user (reads from last-known session)
//
// Purely synchronous: decodes whatever id token is in CognitoSecureStorage
// (memory-cache backed) rather than going through `user.getSession(cb)` —
// that callback fires async whenever the stored session needs an HTTP refresh,
// which returned `null` to callers that expected a sync answer (e.g. bootstrap
// right after an `Updates.reloadAsync()`). Refresh is handled separately by
// getCurrentSession/getIdToken; here we only need to identify who is signed in.
// ---------------------------------------------------------------------------
export function getCurrentUser(): AuthUser | null {
  const idToken = getStoredOAuthIdToken();
  if (!idToken) return null;
  try {
    const payload = decodeJwtPayload(idToken);
    return {
      email: (payload["email"] as string) ?? "",
      name: (payload["name"] as string) ?? undefined,
      sub: (payload["sub"] as string) ?? "",
      tenantId: (payload["custom:tenant_id"] as string) ?? undefined,
      groups: (payload["cognito:groups"] as string[]) ?? [],
    };
  } catch {
    return null;
  }
}

/** Parse a CognitoUserSession's id token into an AuthUser (fully sync). */
export function parseUserFromSession(session: CognitoUserSession): AuthUser {
  return parseIdToken(session);
}

// ---------------------------------------------------------------------------
// Check if auth is configured
// ---------------------------------------------------------------------------
export function isAuthConfigured(): boolean {
  return !!(USER_POOL_ID && CLIENT_ID);
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
// OAuth helpers (Google sign-in via Cognito hosted UI)
// ---------------------------------------------------------------------------

export interface OAuthTokens {
  id_token: string;
  access_token: string;
  refresh_token: string;
}

/** Build the Cognito hosted UI authorize URL for Google sign-in. */
export function getGoogleSignInUrl(redirectUri: string): string {
  const params = new URLSearchParams({
    identity_provider: "Google",
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid email profile",
  });
  return `${COGNITO_DOMAIN}/oauth2/authorize?${params.toString()}`;
}

/** Exchange an authorization code for tokens via the Cognito token endpoint. */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<OAuthTokens> {
  // Log the EXACT inputs Cognito will see. Don't log the full code (treat it
  // as a credential), just its length and a short prefix so we can tell two
  // attempts apart without leaking the secret.
  console.log("[auth] exchangeCodeForTokens", {
    domain: COGNITO_DOMAIN,
    clientIdLen: CLIENT_ID.length,
    redirectUri,
    codeLen: code.length,
    codePrefix: code.slice(0, 6),
  });
  const response = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("[auth] token exchange failed", {
      status: response.status,
      body: text,
      redirectUri,
      codeLen: code.length,
    });
    throw new Error(`Token exchange failed: ${text}`);
  }

  return response.json();
}

/** Decode a JWT payload without verification (tokens come from Cognito over TLS). */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(base64));
}

/**
 * Store OAuth tokens in CognitoSecureStorage using the standard Cognito key format.
 * This lets getCurrentUser/getCurrentSession find them on subsequent loads.
 */
export function storeOAuthTokens(tokens: OAuthTokens): AuthUser {
  const payload = decodeJwtPayload(tokens.id_token);
  const username = (payload["sub"] as string) ?? (payload["cognito:username"] as string) ?? "";

  // Write tokens into CognitoSecureStorage using Cognito SDK key format
  const prefix = `CognitoIdentityServiceProvider.${CLIENT_ID}`;
  CognitoSecureStorage.setItem(`${prefix}.LastAuthUser`, username);
  CognitoSecureStorage.setItem(`${prefix}.${username}.idToken`, tokens.id_token);
  CognitoSecureStorage.setItem(`${prefix}.${username}.accessToken`, tokens.access_token);
  CognitoSecureStorage.setItem(`${prefix}.${username}.refreshToken`, tokens.refresh_token);
  CognitoSecureStorage.setItem(`${prefix}.${username}.clockDrift`, "0");

  return {
    email: (payload["email"] as string) ?? "",
    name: (payload["name"] as string) ?? undefined,
    sub: (payload["sub"] as string) ?? "",
    tenantId: (payload["custom:tenant_id"] as string) ?? undefined,
    groups: (payload["cognito:groups"] as string[]) ?? [],
  };
}

/**
 * Get the stored OAuth id token directly from CognitoSecureStorage.
 * Fallback for OAuth sessions where the Cognito SDK can't reconstruct
 * the session via SRP (federated users have no password).
 */
export function getStoredOAuthIdToken(): string | null {
  const prefix = `CognitoIdentityServiceProvider.${CLIENT_ID}`;
  const username = CognitoSecureStorage.getItem(`${prefix}.LastAuthUser`);
  if (!username) return null;
  return CognitoSecureStorage.getItem(`${prefix}.${username}.idToken`);
}

/**
 * Get the stored OAuth access token directly from CognitoSecureStorage.
 */
export function getStoredOAuthAccessToken(): string | null {
  const prefix = `CognitoIdentityServiceProvider.${CLIENT_ID}`;
  const username = CognitoSecureStorage.getItem(`${prefix}.LastAuthUser`);
  if (!username) return null;
  return CognitoSecureStorage.getItem(`${prefix}.${username}.accessToken`);
}

/**
 * Get the stored OAuth refresh token directly from CognitoSecureStorage.
 */
export function getStoredOAuthRefreshToken(): string | null {
  const prefix = `CognitoIdentityServiceProvider.${CLIENT_ID}`;
  const username = CognitoSecureStorage.getItem(`${prefix}.LastAuthUser`);
  if (!username) return null;
  return CognitoSecureStorage.getItem(`${prefix}.${username}.refreshToken`);
}

/**
 * Returns true if there's any usable session material in CognitoSecureStorage
 * — specifically a refresh_token. This is the "soft auth" signal the app uses
 * to avoid bouncing users to /sign-in on a transient bootstrap failure: as
 * long as a refresh_token is present, we consider the user logged in and show
 * the biometric gate instead of the sign-in screen.
 *
 * MUST be called after `waitForStorageReady()` so the in-memory cache is
 * populated.
 */
export function hasStoredSession(): boolean {
  return getStoredOAuthRefreshToken() !== null;
}

/**
 * Returns true when a JWT is expired or within 2 minutes of expiring.
 * Used to decide whether to refresh the stored OAuth id token.
 */
function isJwtExpiringSoon(token: string, skewSeconds = 120): boolean {
  try {
    const payload = decodeJwtPayload(token);
    const exp = payload["exp"];
    if (typeof exp !== "number") return true;
    return exp <= Math.floor(Date.now() / 1000) + skewSeconds;
  } catch {
    return true;
  }
}

// Serialize concurrent refresh attempts so we don't fire multiple
// /oauth2/token requests when several callers hit an expired token at once.
let _oauthRefreshInFlight: Promise<string | null> | null = null;

/**
 * Use the stored OAuth refresh_token to mint a new id/access token via the
 * Cognito hosted-UI /oauth2/token endpoint. Writes the new tokens back into
 * CognitoSecureStorage so subsequent reads see them.
 *
 * Returns the new id token on success, or null if there's no refresh token,
 * the refresh call fails, or the response is malformed. On refresh failure
 * the stored tokens are left in place — caller decides whether to sign out.
 *
 * Note: Cognito's refresh_token grant returns id_token + access_token but
 * typically NOT a new refresh_token; the existing refresh_token stays valid
 * until its own expiry (default 30 days).
 */
export async function refreshOAuthTokens(): Promise<string | null> {
  if (_oauthRefreshInFlight) return _oauthRefreshInFlight;

  _oauthRefreshInFlight = (async () => {
    const refreshToken = getStoredOAuthRefreshToken();
    if (!refreshToken) return null;

    try {
      const response = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: CLIENT_ID,
          refresh_token: refreshToken,
        }).toString(),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as {
        id_token?: string;
        access_token?: string;
      };
      if (!body.id_token || !body.access_token) return null;

      const prefix = `CognitoIdentityServiceProvider.${CLIENT_ID}`;
      const username = CognitoSecureStorage.getItem(`${prefix}.LastAuthUser`);
      if (!username) return null;
      CognitoSecureStorage.setItem(`${prefix}.${username}.idToken`, body.id_token);
      CognitoSecureStorage.setItem(`${prefix}.${username}.accessToken`, body.access_token);
      return body.id_token;
    } catch (e) {
      console.warn("[auth] refreshOAuthTokens failed:", e);
      return null;
    } finally {
      _oauthRefreshInFlight = null;
    }
  })();

  return _oauthRefreshInFlight;
}
