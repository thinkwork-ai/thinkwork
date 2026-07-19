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
import type { PublicOAuthOption } from "./auth-options";

// ---------------------------------------------------------------------------
// Config — lazy-init to avoid crashing when env vars aren't set (local dev)
// ---------------------------------------------------------------------------
let _userPool: CognitoUserPool | null = null;
let _userPoolClientId: string | null = null;
let passwordAuthClientId: string | null = null;
let tokenStorage: TokenStorage = new LocalStorageTokenStorage();
const TOKEN_REFRESH_SKEW_MS = 30_000;
const AUTH_CLIENT_STORAGE_KEY = "thinkwork:auth-client-id";
const OAUTH_FLOW_STORAGE_PREFIX = "thinkwork:oauth-flow:";
const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;
const REMOTE_SIGN_OUT_TIMEOUT_MS = 4_000;

export function configureTokenStorage(storage: TokenStorage): void {
  if (tokenStorage === storage) return;
  tokenStorage = storage;
  _userPool = null;
  _userPoolClientId = null;
}

export function getTokenStorage(): TokenStorage {
  return tokenStorage;
}

export function configurePasswordAuthClient(
  clientId: string | undefined,
): void {
  passwordAuthClientId = clientId?.trim() || null;
  if (_userPoolClientId !== getActiveClientId()) {
    _userPool = null;
    _userPoolClientId = null;
  }
}

function getActiveClientId(): string {
  return (
    tokenStorage.getItem(AUTH_CLIENT_STORAGE_KEY) ||
    passwordAuthClientId ||
    readRuntimeEnv("VITE_COGNITO_CLIENT_ID")
  );
}

function getUserPool(): CognitoUserPool | null {
  const userPoolId = readRuntimeEnv("VITE_COGNITO_USER_POOL_ID");
  const clientId = getActiveClientId();
  if (!userPoolId || !clientId) return null;
  if (!_userPool || _userPoolClientId !== clientId) {
    _userPool = new CognitoUserPool({
      UserPoolId: userPoolId,
      ClientId: clientId,
      Storage: tokenStorage as unknown as Storage,
    });
    _userPoolClientId = clientId;
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
    if (passwordAuthClientId) {
      tokenStorage.setItem(AUTH_CLIENT_STORAGE_KEY, passwordAuthClientId);
    }
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
// Clears local tokens and ends the provider session through Cognito Hosted UI.
export async function signOut(): Promise<void> {
  const clientId = getActiveClientId();
  const idToken = getStoredToken("idToken");
  const refreshToken = getStoredToken("refreshToken");

  try {
    if (idToken && refreshToken) {
      const controller = new AbortController();
      const timeout = window.setTimeout(
        () => controller.abort(),
        REMOTE_SIGN_OUT_TIMEOUT_MS,
      );
      try {
        const response = await fetch(`${apiBaseUrl()}/api/auth/revoke`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ refreshToken }),
          signal: controller.signal,
        });
        if (!response.ok) {
          console.warn(
            `[auth] refresh-token revocation failed during sign-out (${response.status}).`,
          );
        }
      } catch (error) {
        console.warn(
          "[auth] refresh-token revocation failed during sign-out:",
          error,
        );
      } finally {
        window.clearTimeout(timeout);
      }
    }
  } finally {
    // Local credentials must survive until the authenticated revoke request
    // has been attempted, but remote failure must never trap a user locally.
    clearLocalAuthSession();
  }

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
  const clientId = getActiveClientId();
  const prefix = clientId ? `CognitoIdentityServiceProvider.${clientId}` : "";
  const lastUser = prefix
    ? tokenStorage.getItem(`${prefix}.LastAuthUser`)
    : null;

  const pool = getUserPool();
  pool?.getCurrentUser()?.signOut();

  const storedKeys = tokenStorage.keys?.();
  if (storedKeys) {
    for (const key of storedKeys) {
      if (key.startsWith("CognitoIdentityServiceProvider.")) {
        tokenStorage.removeItem(key);
      }
    }
  } else if (prefix) {
    if (lastUser) {
      tokenStorage.removeItem(`${prefix}.${lastUser}.idToken`);
      tokenStorage.removeItem(`${prefix}.${lastUser}.accessToken`);
      tokenStorage.removeItem(`${prefix}.${lastUser}.refreshToken`);
      tokenStorage.removeItem(`${prefix}.${lastUser}.clockDrift`);
    }
    tokenStorage.removeItem(`${prefix}.LastAuthUser`);
  }
  tokenStorage.removeItem(AUTH_CLIENT_STORAGE_KEY);
  _userPool = null;
  _userPoolClientId = null;
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
  const prefix = `CognitoIdentityServiceProvider.${getActiveClientId()}`;
  return tokenStorage.getItem(`${prefix}.LastAuthUser`);
}

function getStoredToken(kind: "idToken" | "accessToken" | "refreshToken") {
  const prefix = `CognitoIdentityServiceProvider.${getActiveClientId()}`;
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
  const clientId = getActiveClientId();
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

export function getAuthOptionSignInUrl(
  option: PublicOAuthOption,
  next = "/new",
): Promise<string> {
  return createNativeAuthorizeUrl(option, next, { purpose: "sign_in" });
}

export interface IdentityMigrationGrant {
  startToken: string;
  recipientChallenge: string;
}

export function getAuthOptionIdentityMigrationUrl(
  option: PublicOAuthOption,
  grant: IdentityMigrationGrant,
  next = "/new",
): Promise<string> {
  return createNativeAuthorizeUrl(option, next, {
    purpose: "identity_migration",
    enrollment: grant,
  });
}

/**
 * Native email/password sign-in needs the user pool id + client id from the
 * runtime config. When either is missing (e.g. a partially configured local
 * dev shell), the sign-in page hides the password form and falls back to the
 * hosted-UI OAuth button only.
 */
export function isPasswordSignInConfigured(): boolean {
  return Boolean(
    readRuntimeEnv("VITE_COGNITO_USER_POOL_ID") &&
    (passwordAuthClientId || readRuntimeEnv("VITE_COGNITO_CLIENT_ID")),
  );
}

interface PendingOAuthFlow {
  version: 1;
  state: string;
  nonce: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
  initiatingOrigin: string;
  initiatingHost: string;
  next: string;
  expiresAt: number;
  purpose?: "sign_in" | "identity_migration";
  enrollment?: IdentityMigrationGrant;
}

async function createNativeAuthorizeUrl(
  option: PublicOAuthOption,
  next: string,
  context: Pick<PendingOAuthFlow, "purpose" | "enrollment">,
): Promise<string> {
  const state = randomUrlSafeValue(32);
  const nonce = randomUrlSafeValue(32);
  const codeVerifier = randomUrlSafeValue(64);
  const redirectUri = `${window.location.origin}/auth/callback`;
  const flow: PendingOAuthFlow = {
    version: 1,
    state,
    nonce,
    codeVerifier,
    clientId: option.route.clientId,
    redirectUri,
    initiatingOrigin: window.location.origin,
    initiatingHost: window.location.host,
    next: safeReturnTo(next),
    expiresAt: Date.now() + OAUTH_FLOW_TTL_MS,
    ...context,
  };
  sessionStorage.setItem(
    `${OAUTH_FLOW_STORAGE_PREFIX}${state}`,
    JSON.stringify(flow),
  );

  const params = new URLSearchParams({
    response_type: "code",
    client_id: option.route.clientId,
    redirect_uri: redirectUri,
    scope: "openid email profile",
    identity_provider: option.route.identityProvider,
    prompt: option.route.prompt || "select_account",
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: await sha256Base64Url(codeVerifier),
  });
  return `${getCognitoDomainBase()}/oauth2/authorize?${params.toString()}`;
}

function randomUrlSafeValue(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64Url(value);
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function apiBaseUrl(): string {
  const explicit = readRuntimeEnv("VITE_API_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  const graphql = readRuntimeEnv("VITE_GRAPHQL_HTTP_URL");
  if (graphql) return graphql.replace(/\/graphql\/?$/, "").replace(/\/+$/, "");
  return window.location.origin;
}

function safeReturnTo(value: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/new";
  try {
    const url = new URL(value, window.location.origin);
    return `${url.pathname}${url.search}`;
  } catch {
    return "/new";
  }
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

export interface OAuthTokens {
  id_token: string;
  access_token: string;
  refresh_token: string;
}

export interface NativeOAuthSession {
  tokens: OAuthTokens;
  clientId: string;
  next: string;
}

export function getLegacyIdentityMigrationStartUrl(
  authorizePath: string,
  next = "/new",
): string {
  if (authorizePath !== "/api/auth/workos/authorize") {
    throw new Error("Legacy identity migration is unavailable.");
  }
  const url = new URL(`${apiBaseUrl()}${authorizePath}`);
  url.searchParams.set(
    "redirect_uri",
    `${window.location.origin}/auth/callback`,
  );
  url.searchParams.set("return_to", safeReturnTo(next));
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function exchangeLegacyWorkosBridge(
  bridgeCode: string,
): Promise<NativeOAuthSession> {
  if (!bridgeCode.trim()) throw new Error("Legacy migration proof is missing.");
  const response = await fetch(`${apiBaseUrl()}/api/auth/workos/bridge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workos_bridge: bridgeCode }),
  });
  const raw = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (
    !response.ok ||
    typeof raw.id_token !== "string" ||
    typeof raw.access_token !== "string" ||
    typeof raw.refresh_token !== "string"
  ) {
    throw new Error("Legacy identity migration could not be started.");
  }
  const clientId = readRuntimeEnv("VITE_COGNITO_CLIENT_ID");
  if (!clientId) throw new Error("Auth client is not configured.");
  return {
    tokens: {
      id_token: raw.id_token,
      access_token: raw.access_token,
      refresh_token: raw.refresh_token,
    },
    clientId,
    next: "/new",
  };
}

export async function exchangeCodeForSession(
  code: string,
  state: string,
): Promise<NativeOAuthSession> {
  const flow = consumePendingOAuthFlow(state);
  const base = getCognitoDomainBase();

  const res = await fetch(`${base}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: flow.clientId,
      redirect_uri: flow.redirectUri,
      code,
      code_verifier: flow.codeVerifier,
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
  const tokens = {
    id_token: raw.id_token,
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
  };
  validateNativeOAuthTokens(tokens, flow);
  if (flow.purpose === "identity_migration") {
    await consumeIdentityEnrollmentGrant(tokens.id_token, flow);
  } else {
    await automaticallyLinkNativeIdentity(tokens.id_token);
  }
  return { tokens, clientId: flow.clientId, next: flow.next };
}

function consumePendingOAuthFlow(state: string): PendingOAuthFlow {
  if (!state) throw new Error("OAuth callback is missing state.");
  const key = `${OAUTH_FLOW_STORAGE_PREFIX}${state}`;
  const encoded = sessionStorage.getItem(key);
  // State is single-use even when token exchange or claim validation fails.
  sessionStorage.removeItem(key);
  if (!encoded)
    throw new Error("OAuth state is missing, expired, or already used.");
  let flow: PendingOAuthFlow;
  try {
    flow = JSON.parse(encoded) as PendingOAuthFlow;
  } catch {
    throw new Error("OAuth state is invalid.");
  }
  if (
    flow.version !== 1 ||
    flow.state !== state ||
    flow.expiresAt <= Date.now() ||
    flow.initiatingOrigin !== window.location.origin ||
    flow.initiatingHost !== window.location.host ||
    flow.redirectUri !== `${window.location.origin}/auth/callback` ||
    !flow.clientId ||
    !flow.codeVerifier ||
    !flow.nonce ||
    (flow.purpose !== undefined &&
      flow.purpose !== "sign_in" &&
      flow.purpose !== "identity_migration") ||
    (flow.purpose === "identity_migration" &&
      (!flow.enrollment?.startToken || !flow.enrollment.recipientChallenge))
  ) {
    throw new Error("OAuth state does not match this login attempt.");
  }
  return flow;
}

async function automaticallyLinkNativeIdentity(idToken: string): Promise<void> {
  const response = await fetch(
    `${apiBaseUrl()}/api/auth/enrollment/auto-link`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
    },
  );
  let body: { outcome?: string; error?: string } = {};
  try {
    body = (await response.json()) as { outcome?: string; error?: string };
  } catch {
    // Preserve a useful status-based error when an edge proxy returns HTML.
  }
  if (response.ok && body.outcome === "not_linked") {
    throw new Error("Automatic identity linking could not admit this account.");
  }
  const validOutcomes = new Set(["linked", "already_linked"]);
  if (!response.ok || !body.outcome || !validOutcomes.has(body.outcome)) {
    throw new Error(
      body.error
        ? `Automatic identity linking failed: ${body.error}`
        : `Automatic identity linking failed with status ${response.status}.`,
    );
  }
}

async function consumeIdentityEnrollmentGrant(
  idToken: string,
  flow: PendingOAuthFlow,
): Promise<void> {
  const enrollment = flow.enrollment;
  if (!enrollment) {
    throw new Error("The identity enrollment grant is missing.");
  }
  const response = await fetch(`${apiBaseUrl()}/api/auth/enrollment/consume`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      ...enrollment,
      redirectUri: flow.redirectUri,
    }),
  });
  let body: { outcome?: string } = {};
  try {
    body = (await response.json()) as { outcome?: string };
  } catch {
    // The status and generic error below remain safe when an edge proxy
    // returns a non-JSON response.
  }
  if (!response.ok || body.outcome !== "consumed") {
    throw new Error(
      body.outcome
        ? `Identity enrollment failed: ${body.outcome}`
        : `Identity enrollment failed with status ${response.status}.`,
    );
  }
}

function validateNativeOAuthTokens(
  tokens: OAuthTokens,
  flow: PendingOAuthFlow,
): void {
  const id = decodeJwtPayload(tokens.id_token);
  const access = decodeJwtPayload(tokens.access_token);
  const userPoolId = readRuntimeEnv("VITE_COGNITO_USER_POOL_ID");
  const region = userPoolId.split("_")[0];
  const expectedIssuer =
    userPoolId && region
      ? `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`
      : "";
  if (
    !id ||
    !access ||
    id.token_use !== "id" ||
    access.token_use !== "access" ||
    id.aud !== flow.clientId ||
    access.client_id !== flow.clientId ||
    id.nonce !== flow.nonce ||
    !expectedIssuer ||
    id.iss !== expectedIssuer ||
    access.iss !== expectedIssuer ||
    typeof id.exp !== "number" ||
    typeof access.exp !== "number" ||
    isExpiredJwt(tokens.id_token) ||
    isExpiredJwt(tokens.access_token)
  ) {
    throw new Error(
      "Cognito returned tokens that do not match this login attempt.",
    );
  }
}

export function storeTokensInCognitoStorage(
  tokens: OAuthTokens,
  clientId = getActiveClientId(),
): void {
  // Decode the id token to extract the username (sub claim)
  const payload = decodeJwtPayload(tokens.id_token);
  if (!payload) throw new Error("Cognito returned an invalid ID token.");
  const username = payload["cognito:username"] || payload["sub"];
  if (typeof username !== "string" || !username) {
    throw new Error("Cognito ID token is missing its subject.");
  }

  if (!clientId) throw new Error("Auth client is not configured.");
  // A provider change replaces the browser session. Retaining the previous
  // app client's tokens can resurrect that provider after sign-out.
  for (const key of tokenStorage.keys?.() ?? []) {
    if (key.startsWith("CognitoIdentityServiceProvider.")) {
      tokenStorage.removeItem(key);
    }
  }
  const prefix = `CognitoIdentityServiceProvider.${clientId}`;

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
  tokenStorage.setItem(AUTH_CLIENT_STORAGE_KEY, clientId);
  _userPool = null;
  _userPoolClientId = null;
}
