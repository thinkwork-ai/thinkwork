import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
  CognitoUserAttribute,
} from "amazon-cognito-identity-js";

// ---------------------------------------------------------------------------
// Config — lazy-init to avoid crashing when env vars aren't set (local dev)
// ---------------------------------------------------------------------------
const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID || "";
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID || "";
const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN || "";

let _userPool: CognitoUserPool | null = null;

function getUserPool(): CognitoUserPool | null {
  if (!USER_POOL_ID || !CLIENT_ID) return null;
  if (!_userPool) {
    _userPool = new CognitoUserPool({
      UserPoolId: USER_POOL_ID,
      ClientId: CLIENT_ID,
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
          user.completeNewPasswordChallenge(newPassword, {}, {
            onSuccess: (session) => resolve(session),
            onFailure: (err) => reject(err),
          });
        } else {
          // Signal that a new password is needed
          reject(Object.assign(new Error("New password required"), { code: "NewPasswordRequired" }));
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
  const pool = getUserPool();
  pool?.getCurrentUser()?.signOut();

  if (!CLIENT_ID) {
    window.location.href = "/sign-in";
    return;
  }

  // logout_uri must exactly match an entry in the Cognito user-pool client's
  // LogoutURLs allowlist. The Terraform module registers bare origins (not
  // `/sign-in`), so target the origin here and let the `_authed` route guard
  // bounce the unauthenticated user to `/sign-in`.
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    logout_uri: window.location.origin,
  });
  window.location.href = `${getCognitoDomainBase()}/logout?${params.toString()}`;
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
// Token helpers — fall back to raw localStorage for OAuth sessions
// ---------------------------------------------------------------------------

function getStoredIdToken(): string | null {
  const prefix = `CognitoIdentityServiceProvider.${CLIENT_ID}`;
  const lastUser = localStorage.getItem(`${prefix}.LastAuthUser`);
  if (!lastUser) return null;
  return localStorage.getItem(`${prefix}.${lastUser}.idToken`);
}

export async function getAccessToken(): Promise<string | null> {
  const session = await getCurrentSession();
  if (session) return session.getAccessToken().getJwtToken();
  // Fallback for OAuth sessions
  const prefix = `CognitoIdentityServiceProvider.${CLIENT_ID}`;
  const lastUser = localStorage.getItem(`${prefix}.LastAuthUser`);
  if (!lastUser) return null;
  return localStorage.getItem(`${prefix}.${lastUser}.accessToken`);
}

export async function getIdToken(): Promise<string | null> {
  const session = await getCurrentSession();
  if (session) return session.getIdToken().getJwtToken();
  // Fallback for OAuth sessions where amazon-cognito-identity-js can't
  // reconstruct the session (no SRP verifier for federated users)
  return getStoredIdToken();
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

  user.getSession(
    (err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) return;
      authUser = parseIdToken(session);
    },
  );

  // Fallback: parse id token directly from localStorage (OAuth sessions)
  if (!authUser) {
    const rawToken = getStoredIdToken();
    if (rawToken) {
      try {
        const payload = JSON.parse(atob(rawToken.split(".")[1]));
        authUser = {
          email: payload["email"] ?? "",
          name: payload["name"] ?? undefined,
          sub: payload["sub"] ?? "",
          tenantId: payload["custom:tenant_id"] ?? undefined,
          groups: payload["cognito:groups"] ?? [],
        };
      } catch {
        // Corrupted token — ignore
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
// Google OAuth — federated sign-in via Cognito hosted UI
// ---------------------------------------------------------------------------

function getCognitoDomainBase(): string {
  const raw = COGNITO_DOMAIN.replace(/\/$/, "");
  // If it's already a full URL, use as-is
  if (raw.startsWith("https://")) return raw;
  // Otherwise treat it as the domain prefix
  return `https://${raw}.auth.us-east-1.amazoncognito.com`;
}

export function getGoogleSignInUrl(): string {
  const redirectUri = `${window.location.origin}/auth/callback`;
  // `prompt=select_account` is forwarded to Google so the account chooser is
  // shown every time. Without it, Google silently re-uses its session cookie
  // and the user can never switch identities by signing back in.
  const params = new URLSearchParams({
    identity_provider: "Google",
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid email profile",
    prompt: "select_account",
  });
  return `${getCognitoDomainBase()}/oauth2/authorize?${params.toString()}`;
}

interface OAuthTokens {
  id_token: string;
  access_token: string;
  refresh_token: string;
}

export async function exchangeCodeForSession(code: string): Promise<OAuthTokens> {
  const redirectUri = `${window.location.origin}/auth/callback`;
  const base = getCognitoDomainBase();

  const res = await fetch(`${base}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      code,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${text}`);
  }

  return res.json();
}

export function storeTokensInCognitoStorage(tokens: OAuthTokens): void {
  // Decode the id token to extract the username (sub claim)
  const payload = JSON.parse(atob(tokens.id_token.split(".")[1]));
  const username = payload["cognito:username"] || payload["sub"];

  const prefix = `CognitoIdentityServiceProvider.${CLIENT_ID}`;

  localStorage.setItem(`${prefix}.${username}.idToken`, tokens.id_token);
  localStorage.setItem(`${prefix}.${username}.accessToken`, tokens.access_token);
  localStorage.setItem(`${prefix}.${username}.refreshToken`, tokens.refresh_token);
  localStorage.setItem(`${prefix}.LastAuthUser`, username);
}
