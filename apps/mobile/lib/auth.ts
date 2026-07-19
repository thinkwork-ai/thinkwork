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
import {
  CognitoSecureStorage,
  clearCognitoStorageForClientId,
  waitForStorageReady,
  isStorageReady,
  resetStorageHydrationForDeploymentChange,
} from "./cognito-storage";
import { getPlatformConfig } from "./platform-config";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
let _userPool: CognitoUserPool | null = null;
let _userPoolKey: string | null = null;
let _passwordAuthClientId: string | null = null;

export function configurePasswordAuthClient(clientId?: string): void {
  const normalized = clientId?.trim() || null;
  if (_passwordAuthClientId === normalized) return;
  _passwordAuthClientId = normalized;
  _userPool = null;
  _userPoolKey = null;
}

function getUserPool(): CognitoUserPool | null {
  const config = getPlatformConfig();
  const clientId = _passwordAuthClientId || config.cognitoClientId;
  if (!config.cognitoUserPoolId || !clientId) return null;
  const key = `${config.cognitoUserPoolId}:${clientId}`;
  if (!_userPool || _userPoolKey !== key) {
    _userPool = new CognitoUserPool({
      UserPoolId: config.cognitoUserPoolId,
      ClientId: clientId,
      Storage: CognitoSecureStorage,
    });
    _userPoolKey = key;
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
      onSuccess: (session) => {
        storeOAuthTokens(
          {
            id_token: session.getIdToken().getJwtToken(),
            access_token: session.getAccessToken().getJwtToken(),
            refresh_token: session.getRefreshToken().getToken(),
          },
          _passwordAuthClientId || getPlatformConfig().cognitoClientId,
        );
        resolve(session);
      },
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
const REMOTE_SIGN_OUT_TIMEOUT_MS = 4_000;
const MOBILE_LOGOUT_URI = "thinkwork://";

async function settleWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then((value) => ({ timedOut: false as const, value })),
      new Promise<{ timedOut: true }>((resolve) => {
        timeout = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function signOut(): Promise<void> {
  const config = getPlatformConfig();
  const refreshToken = getStoredOAuthRefreshToken();
  const clientId =
    getStoredOAuthClientId() || _passwordAuthClientId || config.cognitoClientId;

  if (refreshToken && clientId && config.cognitoDomain) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      REMOTE_SIGN_OUT_TIMEOUT_MS,
    );
    try {
      await fetch(`${config.cognitoDomain}/oauth2/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: refreshToken,
          client_id: clientId,
        }).toString(),
        signal: controller.signal,
      });
    } catch (error) {
      console.warn(
        "[auth] refresh-token revocation failed during sign-out:",
        error,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  if (clientId && config.cognitoDomain) {
    const logoutUri =
      Platform.OS === "web" ? globalThis.location?.origin : MOBILE_LOGOUT_URI;
    if (logoutUri) {
      const logoutUrl = new URL(`${config.cognitoDomain}/logout`);
      logoutUrl.searchParams.set("client_id", clientId);
      logoutUrl.searchParams.set("logout_uri", logoutUri);
      try {
        if (Platform.OS === "web") {
          globalThis.location?.assign(logoutUrl.toString());
        } else {
          const logout = await settleWithin(
            // Login uses the persistent ASWebAuthenticationSession cookie jar.
            // Logout must use that same jar so the hosted session is cleared.
            WebBrowser.openAuthSessionAsync(logoutUrl.toString(), logoutUri),
            REMOTE_SIGN_OUT_TIMEOUT_MS,
          );
          if (logout.timedOut) {
            try {
              WebBrowser.dismissAuthSession();
            } catch (error) {
              console.warn(
                "[auth] timed-out Cognito logout session could not be dismissed:",
                error,
              );
            }
          }
        }
      } catch (error) {
        console.warn("[auth] Cognito hosted-session logout failed:", error);
      }
    }
  }

  const pool = getUserPool();
  const user = pool?.getCurrentUser();
  if (user) {
    user.signOut();
  }
  clearStoredEnvironmentSession();
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

export async function getStoredAuthTokenForActiveEnvironment(): Promise<
  string | null
> {
  const stored = getStoredOAuthIdToken();
  if (stored && !isJwtExpiringSoon(stored)) return stored;
  return getIdToken();
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
  const config = getPlatformConfig();
  return !!(config.cognitoUserPoolId && config.cognitoClientId);
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
// Provider-specific Cognito hosted UI helpers
// ---------------------------------------------------------------------------

export interface OAuthTokens {
  id_token: string;
  access_token: string;
  refresh_token: string;
}

export interface OAuthAuthorizeRequest {
  authorizeUrl: string;
  clientId: string;
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
  state: string;
}

export async function createOAuthAuthorizeRequest(
  option: {
    route: {
      clientId: string;
      identityProvider: string;
      prompt?: string;
    };
  },
  redirectUri: string,
): Promise<OAuthAuthorizeRequest> {
  const config = getPlatformConfig();
  if (!config.cognitoDomain) throw new Error("Auth not configured");
  const state = Crypto.randomUUID();
  const nonce = Crypto.randomUUID();
  const codeVerifier = `${Crypto.randomUUID()}${Crypto.randomUUID()}`.replace(
    /-/g,
    "",
  );
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    codeVerifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  const params = new URLSearchParams({
    identity_provider: option.route.identityProvider,
    response_type: "code",
    client_id: option.route.clientId,
    redirect_uri: redirectUri,
    scope: "openid email profile",
    prompt: option.route.prompt || "select_account",
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: base64Url(digest),
  });
  return {
    authorizeUrl: `${config.cognitoDomain}/oauth2/authorize?${params.toString()}`,
    clientId: option.route.clientId,
    codeVerifier,
    nonce,
    redirectUri,
    state,
  };
}

/** Exchange an authorization code for tokens via the Cognito token endpoint. */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  clientId = getPlatformConfig().cognitoClientId,
  codeVerifier?: string,
): Promise<OAuthTokens> {
  const config = getPlatformConfig();
  if (!config.cognitoDomain || !clientId) {
    throw new Error("Auth not configured");
  }
  // Log the EXACT inputs Cognito will see. Don't log the full code (treat it
  // as a credential), just its length and a short prefix so we can tell two
  // attempts apart without leaking the secret.
  console.log("[auth] exchangeCodeForTokens", {
    domain: config.cognitoDomain,
    clientIdLen: clientId.length,
    redirectUri,
    codeLen: code.length,
    codePrefix: code.slice(0, 6),
  });
  const response = await fetch(`${config.cognitoDomain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
    }).toString(),
  });

  if (!response.ok) {
    await response.text();
    console.error("[auth] token exchange failed", {
      status: response.status,
      redirectUri,
      codeLen: code.length,
    });
    throw new Error(`Token exchange failed (${response.status})`);
  }

  return response.json();
}

/** Decode a JWT payload without verification (tokens come from Cognito over TLS). */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) throw new Error("Malformed OAuth token");
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(base64));
}

function expectedCognitoIssuer(): string {
  const poolId = getPlatformConfig().cognitoUserPoolId;
  const region = poolId.split("_")[0];
  if (!poolId || !region || region === poolId) {
    throw new Error("Auth not configured");
  }
  return `https://cognito-idp.${region}.amazonaws.com/${poolId}`;
}

function requireCurrentClaim(
  payload: Record<string, unknown>,
  claim: string,
  expected: string,
): void {
  if (payload[claim] !== expected) {
    throw new Error(`OAuth token ${claim} verification failed`);
  }
}

function requireUnexpired(payload: Record<string, unknown>): void {
  const exp = payload["exp"];
  if (typeof exp !== "number" || exp <= Math.floor(Date.now() / 1000) - 60) {
    throw new Error("OAuth token has expired");
  }
}

/**
 * Validate the claims bound to Cognito's TLS token response before any token
 * reaches persistent storage. API requests still perform full JWKS signature
 * verification; the mobile client pins issuer, app client, token type, nonce,
 * expiry, and subject here to prevent callback/session mix-ups.
 */
export function validateOAuthTokens(
  tokens: Pick<OAuthTokens, "id_token" | "access_token">,
  expected: { clientId: string; nonce?: string; subject?: string },
): Record<string, unknown> {
  const id = decodeJwtPayload(tokens.id_token);
  const access = decodeJwtPayload(tokens.access_token);
  const issuer = expectedCognitoIssuer();

  requireCurrentClaim(id, "iss", issuer);
  requireCurrentClaim(id, "aud", expected.clientId);
  requireCurrentClaim(id, "token_use", "id");
  requireCurrentClaim(access, "iss", issuer);
  requireCurrentClaim(access, "client_id", expected.clientId);
  requireCurrentClaim(access, "token_use", "access");
  requireUnexpired(id);
  requireUnexpired(access);

  const subject = id["sub"];
  if (typeof subject !== "string" || !subject || access["sub"] !== subject) {
    throw new Error("OAuth token subject verification failed");
  }
  if (expected.subject && subject !== expected.subject) {
    throw new Error("OAuth refresh subject verification failed");
  }
  if (expected.nonce !== undefined && id["nonce"] !== expected.nonce) {
    throw new Error("OAuth nonce verification failed");
  }

  return id;
}

/**
 * Store OAuth tokens in CognitoSecureStorage using the standard Cognito key format.
 * This lets getCurrentUser/getCurrentSession find them on subsequent loads.
 */
export function storeOAuthTokens(
  tokens: OAuthTokens,
  oauthClientId = getPlatformConfig().cognitoClientId,
): AuthUser {
  const payload = decodeJwtPayload(tokens.id_token);
  const username =
    (payload["sub"] as string) ?? (payload["cognito:username"] as string) ?? "";
  const prefix = cognitoStoragePrefix();
  if (!prefix) throw new Error("Auth not configured");

  // Write tokens into CognitoSecureStorage using Cognito SDK key format
  CognitoSecureStorage.setItem(`${prefix}.LastAuthUser`, username);
  CognitoSecureStorage.setItem(
    `${prefix}.${username}.idToken`,
    tokens.id_token,
  );
  CognitoSecureStorage.setItem(
    `${prefix}.${username}.accessToken`,
    tokens.access_token,
  );
  CognitoSecureStorage.setItem(
    `${prefix}.${username}.refreshToken`,
    tokens.refresh_token,
  );
  if (oauthClientId) {
    CognitoSecureStorage.setItem(
      `${prefix}.${username}.oauthClientId`,
      oauthClientId,
    );
  }
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
  const prefix = cognitoStoragePrefix();
  if (!prefix) return null;
  const username = CognitoSecureStorage.getItem(`${prefix}.LastAuthUser`);
  if (!username) return null;
  return CognitoSecureStorage.getItem(`${prefix}.${username}.idToken`);
}

/**
 * Get the stored OAuth access token directly from CognitoSecureStorage.
 */
export function getStoredOAuthAccessToken(): string | null {
  const prefix = cognitoStoragePrefix();
  if (!prefix) return null;
  const username = CognitoSecureStorage.getItem(`${prefix}.LastAuthUser`);
  if (!username) return null;
  return CognitoSecureStorage.getItem(`${prefix}.${username}.accessToken`);
}

/**
 * Get the stored OAuth refresh token directly from CognitoSecureStorage.
 */
export function getStoredOAuthRefreshToken(): string | null {
  const prefix = cognitoStoragePrefix();
  if (!prefix) return null;
  const username = CognitoSecureStorage.getItem(`${prefix}.LastAuthUser`);
  if (!username) return null;
  return CognitoSecureStorage.getItem(`${prefix}.${username}.refreshToken`);
}

export function getStoredOAuthClientId(): string | null {
  const prefix = cognitoStoragePrefix();
  if (!prefix) return null;
  const username = CognitoSecureStorage.getItem(`${prefix}.LastAuthUser`);
  if (!username) return null;
  return CognitoSecureStorage.getItem(`${prefix}.${username}.oauthClientId`);
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
    const config = getPlatformConfig();
    const oauthClientId = getStoredOAuthClientId() || config.cognitoClientId;
    if (!config.cognitoDomain || !oauthClientId) return null;

    try {
      const response = await fetch(`${config.cognitoDomain}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: oauthClientId,
          refresh_token: refreshToken,
        }).toString(),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as {
        id_token?: string;
        access_token?: string;
      };
      if (!body.id_token || !body.access_token) return null;

      const prefix = cognitoStoragePrefix();
      if (!prefix) return null;
      const username = CognitoSecureStorage.getItem(`${prefix}.LastAuthUser`);
      if (!username) return null;
      const currentIdToken = CognitoSecureStorage.getItem(
        `${prefix}.${username}.idToken`,
      );
      const currentSubject = currentIdToken
        ? decodeJwtPayload(currentIdToken)["sub"]
        : undefined;
      validateOAuthTokens(
        { id_token: body.id_token, access_token: body.access_token },
        {
          clientId: oauthClientId,
          ...(typeof currentSubject === "string"
            ? { subject: currentSubject }
            : {}),
        },
      );
      CognitoSecureStorage.setItem(
        `${prefix}.${username}.idToken`,
        body.id_token,
      );
      CognitoSecureStorage.setItem(
        `${prefix}.${username}.accessToken`,
        body.access_token,
      );
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

/**
 * Re-point the auth engine at the (new) active environment without touching
 * persisted sessions: drop pool caches and re-run SecureStore hydration for
 * the active environment's clientId. Environment switches keep each
 * environment's stored session intact — this is rescoping, not sign-out.
 */
export function resetAuthEngineForEnvironmentChange(): void {
  _userPool = null;
  _userPoolKey = null;
  _oauthRefreshInFlight = null;
  resetStorageHydrationForDeploymentChange();
}

export function clearAuthStorageForDeploymentChange(): void {
  void signOut();
  _userPool = null;
  _userPoolKey = null;
  _oauthRefreshInFlight = null;
  CognitoSecureStorage.clear();
  resetStorageHydrationForDeploymentChange();
}

export async function clearAuthStorageForEnvironment(
  cognitoClientId: string,
): Promise<void> {
  const activeClientId = getPlatformConfig().cognitoClientId;
  if (activeClientId === cognitoClientId) await signOut();
  if (activeClientId === cognitoClientId) {
    _userPool = null;
    _userPoolKey = null;
  }
  _oauthRefreshInFlight = null;
  await clearCognitoStorageForClientId(cognitoClientId);
}

function cognitoStoragePrefix(): string | null {
  const clientId = getPlatformConfig().cognitoClientId;
  return clientId ? `CognitoIdentityServiceProvider.${clientId}` : null;
}

function clearStoredEnvironmentSession(): void {
  const prefix = cognitoStoragePrefix();
  if (!prefix) return;
  const username = CognitoSecureStorage.getItem(`${prefix}.LastAuthUser`);
  CognitoSecureStorage.removeItem(`${prefix}.LastAuthUser`);
  if (!username) return;
  for (const suffix of [
    "idToken",
    "accessToken",
    "refreshToken",
    "clockDrift",
    "oauthClientId",
    "userData",
  ]) {
    CognitoSecureStorage.removeItem(`${prefix}.${username}.${suffix}`);
  }
}

function base64Url(value: string): string {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
