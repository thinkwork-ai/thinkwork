/**
 * Cognito AuthProvider + useAuth() hook for app-manager.
 *
 * Session lifecycle:
 *   1. On mount, wait for SecureStore hydration, then check for an existing
 *      Cognito session (tokens persisted across restarts via CognitoSecureStorage).
 *   2. If a valid session exists, the user is auto-logged in — no password needed.
 *   3. If biometric is enabled, a Face ID / Touch ID gate is shown before content.
 *   4. On app foreground, tokens are silently refreshed so GraphQL stays valid.
 *   5. On sign-in, credentials are stored in SecureStore for biometric re-auth.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import type { AuthUser } from "@/lib/auth";
import * as auth from "@/lib/auth";
import { setAuthToken, reconnectSubscriptions } from "@/lib/graphql/client";
import * as SecureStore from "expo-secure-store";

// Keys for biometric credential storage
const CRED_EMAIL_KEY = "biometric_stored_email";
const CRED_PASSWORD_KEY = "biometric_stored_password";
// Google federated JWTs don't carry custom:tenant_id, so we persist the
// id returned by bootstrapUser here and rehydrate it during the cold-start
// session restore. Without this, every cold start drops the user on /sign-in
// and silently disables their biometric preference (see _layout.tsx guard).
const STORED_TENANT_ID_KEY = "thinkwork_stored_tenant_id";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /**
   * True when SecureStore has a refresh_token — i.e. the user has been
   * authenticated at some point and we can, in principle, refresh back into
   * a valid session. Stays true even when `user` is null during a transient
   * bootstrap/refresh failure. The app uses this as the "soft auth" signal
   * to show the biometric lock screen instead of bouncing to /sign-in.
   */
  hasStoredSession: boolean;
  /** True when user actively signed in (typed password or biometric), false for auto-restore */
  didActiveLogin: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  signOut: () => void;
  getToken: () => Promise<string | null>;
  /** Attempt to restore session using stored credentials (after biometric) */
  restoreWithCredentials: () => Promise<boolean>;
  /**
   * Re-run the bootstrap flow (hydrate → session → OAuth refresh → tenantId).
   * Used by the biometric unlock handler to recover from a transient failure
   * without routing the user back to /sign-in. Resolves to `true` when a
   * usable user was restored, `false` otherwise.
   */
  retryBootstrap: () => Promise<boolean>;
  /** Sign in with Google via Cognito hosted UI */
  signInWithGoogle: () => Promise<void>;
  /** Increments each time the app returns to foreground and token is refreshed. Watch this to re-fetch data. */
  refreshCounter: number;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasStoredSession, setHasStoredSession] = useState(false);
  const [didActiveLogin, setDidActiveLogin] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const refreshingRef = useRef(false);

  // Resolve a tenantId for a restored user. Federated (Google) JWTs — and
  // sometimes even SRP-restored sessions that point at a federated user —
  // don't carry `custom:tenant_id`, so we need a fallback. Two tiers:
  //
  //   1. Fast path — cached tenantId in SecureStore (written after the last
  //      successful bootstrap). Zero network, sub-ms.
  //   2. Network fallback — bootstrapUser mutation using the current id
  //      token. Self-healing: persists to the cache for next cold start.
  //
  // Returns a new user object with `tenantId` populated if either path
  // succeeded, otherwise returns the input unchanged (caller decides how to
  // react to a missing tenantId).
  const resolveTenantId = useCallback(
    async (user: AuthUser, token: string): Promise<AuthUser> => {
      if (user.tenantId) return user;

      try {
        const cached = await SecureStore.getItemAsync(STORED_TENANT_ID_KEY);
        if (cached) {
          console.log("[auth-boot] tenantId resolved from cache");
          return { ...user, tenantId: cached };
        }
      } catch (e) {
        console.warn("[auth-boot] tenantId rehydrate failed:", e);
      }

      try {
        const graphqlUrl = process.env.EXPO_PUBLIC_GRAPHQL_URL;
        if (!graphqlUrl) return user;
        const res = await fetch(graphqlUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            query: `mutation { bootstrapUser { user { id email name } tenant { id name slug plan } isNew } }`,
          }),
        });
        const payload = await res.json();
        const tenantId = payload?.data?.bootstrapUser?.tenant?.id as string | undefined;
        if (tenantId) {
          console.log("[auth-boot] tenantId resolved via bootstrapUser");
          SecureStore.setItemAsync(STORED_TENANT_ID_KEY, tenantId).catch((e) =>
            console.warn("[auth-boot] tenantId persist failed:", e),
          );
          return { ...user, tenantId };
        }
        console.warn("[auth-boot] bootstrapUser returned no tenant", payload);
      } catch (e) {
        console.warn("[auth-boot] bootstrapUser fallback failed:", e);
      }

      return user;
    },
    [],
  );

  // ------ Bootstrap: wait for SecureStore hydration, then check session ------
  // Extracted to a callback so the biometric unlock handler can re-run it on
  // demand after a transient refresh failure. We never bounce the user back
  // to /sign-in while `hasStoredSession` is true — the app shows the biometric
  // lock screen instead.
  const runBootstrap = useCallback(async (): Promise<boolean> => {
    console.log("[auth-boot] bootstrap start");
    try {
      // Wait for CognitoSecureStorage to hydrate from SecureStore
      await auth.waitForStorageReady();

      // Set the soft-auth signal up-front so the routing guard can see it
      // even when session restore fails below.
      const stored = auth.hasStoredSession();
      setHasStoredSession(stored);
      console.log("[auth-boot] storage ready, hasStoredSession=", stored);

      // Try to restore the existing Cognito session (password / SRP flow).
      // Note: this path can also succeed for Google-federated users when the
      // stored refresh_token is still valid, and in that case the resulting
      // id token still won't carry custom:tenant_id — so we must run the
      // tenantId resolver here as well, not only in the OAuth fallback.
      const session = await auth.getCurrentSession();
      console.log("[auth-boot] getCurrentSession:", session ? "valid" : "null");
      if (session) {
        const token = session.getIdToken().getJwtToken();
        setAuthToken(token);
        const sessionUser = auth.parseUserFromSession(session);
        const resolved = await resolveTenantId(sessionUser, token);
        setUser(resolved);
        console.log(
          "[auth-boot] restored via SRP session, tenantId=",
          resolved.tenantId ?? "none",
        );
        return true;
      }

      // Fallback: OAuth/federated sessions can't be restored via SRP when
      // the refresh_token isn't usable (edge case). Read the id token sync
      // from storage instead so we don't depend on getSession's async
      // refresh callback returning in time.
      const restoredUser = auth.getCurrentUser();
      console.log(
        "[auth-boot] getCurrentUser:",
        restoredUser ? `sub=${restoredUser.sub.slice(0, 8)} tenantId=${restoredUser.tenantId ?? "none"}` : "null",
      );
      if (!restoredUser) {
        console.log("[auth-boot] no user from either path");
        return false;
      }

      const oauthToken = await auth.getIdToken();
      console.log("[auth-boot] getIdToken:", oauthToken ? `len=${oauthToken.length}` : "null");
      if (!oauthToken) {
        console.log("[auth-boot] OAuth path: no id token, leaving soft-auth state");
        return false;
      }

      setAuthToken(oauthToken);
      const resolved = await resolveTenantId(restoredUser, oauthToken);
      setUser(resolved);
      console.log(
        "[auth-boot] restored via OAuth path, tenantId=",
        resolved.tenantId ?? "none",
      );
      return true;
    } catch (e) {
      console.warn("[auth-boot] bootstrap error:", e);
      return false;
    }
  }, [resolveTenantId]);

  // First-run bootstrap on mount
  useEffect(() => {
    let cancelled = false;
    runBootstrap().finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [runBootstrap]);

  // ------ Refresh token when app comes to foreground ------
  useEffect(() => {
    if (Platform.OS === "web") return;

    const subscription = AppState.addEventListener("change", async (nextState) => {
      if (nextState === "active" && user && !refreshingRef.current) {
        refreshingRef.current = true;
        try {
          const token = await auth.getIdToken();
          if (token) {
            setAuthToken(token);
            // Force WS reconnect so subscriptions use the fresh token
            reconnectSubscriptions();
            // Signal screens to re-fetch data
            setRefreshCounter((c) => c + 1);
          }
        } catch (e) {
          console.warn("[AuthProvider] foreground refresh failed:", e);
        } finally {
          refreshingRef.current = false;
        }
      }
    });

    return () => subscription.remove();
  }, [user]);

  // ------ Proactive token refresh every 45 min while authenticated ------
  useEffect(() => {
    if (!user) return;
    const REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes
    const timer = setInterval(async () => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      try {
        const token = await auth.getIdToken();
        if (token) setAuthToken(token);
      } catch (e) {
        console.warn("[AuthProvider] proactive refresh failed:", e);
      } finally {
        refreshingRef.current = false;
      }
    }, REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [user]);

  // ------ Sign in ------
  const handleSignIn = useCallback(async (email: string, password: string) => {
    const session = await auth.signIn(email, password);
    const token = session.getIdToken().getJwtToken();
    setAuthToken(token);
    setDidActiveLogin(true);
    setHasStoredSession(true);
    setUser(auth.parseUserFromSession(session));

    // Persist credentials for biometric re-auth — fire-and-forget so it
    // doesn't block the login flow (SecureStore writes take ~50ms each)
    if (Platform.OS !== "web") {
      Promise.all([
        SecureStore.setItemAsync(CRED_EMAIL_KEY, email),
        SecureStore.setItemAsync(CRED_PASSWORD_KEY, password),
      ]).catch((e) => console.warn("[AuthProvider] credential store error:", e));
    }
  }, []);

  // ------ Restore session using stored credentials (biometric flow) ------
  const restoreWithCredentials = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === "web") return false;
    try {
      const email = await SecureStore.getItemAsync(CRED_EMAIL_KEY);
      const password = await SecureStore.getItemAsync(CRED_PASSWORD_KEY);
      if (!email || !password) return false;

      const session = await auth.signIn(email, password);
      const token = session.getIdToken().getJwtToken();
      setAuthToken(token);
      setUser(auth.parseUserFromSession(session));
      return true;
    } catch (e) {
      console.warn("[AuthProvider] credential restore failed:", e);
      return false;
    }
  }, []);

  // ------ Sign in with Google (OAuth) ------
  // Re-entry guard: if a sign-in is already in flight, ignore additional
  // calls. React's batched state updates can let two button presses fire
  // before `googleLoading` flips, which would issue two authorize requests
  // and burn the first single-use code.
  const oauthInFlightRef = useRef(false);
  const handleSignInWithGoogle = useCallback(async () => {
    if (oauthInFlightRef.current) {
      console.warn("[AuthProvider] Google OAuth: already in flight, ignoring re-entry");
      return;
    }
    oauthInFlightRef.current = true;
    try {
      if (Platform.OS === "web") {
        const redirectUri = window.location.origin + "/auth/callback";
        window.location.href = auth.getGoogleSignInUrl(redirectUri);
        return;
      }

      // Native: hard-code the redirect URI rather than computing via
      // Linking.createURL("auth/callback"). expo-linking's createURL applies
      // path normalization (host/slash placement, encodeURI) that produced a
      // URI which Cognito's exact-string comparison rejected on the
      // authorize→token leg, surfacing as `invalid_grant`. The literal
      // matches what's registered in the Cognito user pool client callback
      // list and removes any computation from the hot path.
      const redirectUri = "thinkwork://auth/callback";
      console.log("[AuthProvider] Google OAuth redirectUri:", redirectUri);
      const authorizeUrl = auth.getGoogleSignInUrl(redirectUri);
      console.log("[AuthProvider] Google OAuth authorizeUrl:", authorizeUrl);
      // preferEphemeralSession: true uses ASWebAuthenticationSession's
      // private session mode on iOS, which gives every sign-in attempt a
      // clean cookie jar. Without it, a failed previous attempt can leave
      // stale Cognito hosted-UI session cookies in the persistent jar; the
      // next authorize request gets short-circuited via SSO and Cognito
      // issues a code bound to the old session state, which the token
      // exchange then rejects as `invalid_grant`. Retrying works because
      // the failed exchange invalidates that stale state. Forcing
      // ephemeral sessions removes the failure mode entirely.
      const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, redirectUri, {
        preferEphemeralSession: true,
      });
      console.log("[AuthProvider] Google OAuth result type:", result.type, "url" in result ? result.url : "no url");

      if (result.type !== "success") return;

      // Parse code from callback URL — avoid `new URL()` which isn't reliable on Hermes.
      // Stop at `&` AND `#` — Cognito's redirect appends a trailing `#` fragment
      // that would otherwise get captured into the code and rejected as
      // `invalid_grant`. This was the root cause of every "Token exchange failed"
      // error we were chasing all day.
      const codeMatch = result.url.match(/[?&]code=([^&#]+)/);
      const code = codeMatch?.[1] ? decodeURIComponent(codeMatch[1]) : null;
      if (!code) throw new Error("No authorization code in callback URL");
      console.log("[AuthProvider] Google OAuth code length:", code.length);

      const tokens = await auth.exchangeCodeForTokens(code, redirectUri);
      let oauthUser = auth.storeOAuthTokens(tokens);
      setAuthToken(tokens.id_token);

      // Federated (Google) users don't have custom:tenant_id in their JWT on
      // first sign-in. Mirror the admin app's TenantContext bootstrap flow:
      // call bootstrapUser to auto-provision a tenant and merge the id into
      // local user state so the routing guard can redirect to the home tab.
      if (!oauthUser.tenantId) {
        const graphqlUrl = process.env.EXPO_PUBLIC_GRAPHQL_URL;
        if (!graphqlUrl) throw new Error("GraphQL URL not configured");
        const res = await fetch(graphqlUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${tokens.id_token}`,
          },
          body: JSON.stringify({
            query: `mutation { bootstrapUser { user { id email name } tenant { id name slug plan } isNew } }`,
          }),
        });
        const bootstrapResult = await res.json();
        const bootstrap = bootstrapResult?.data?.bootstrapUser;
        if (!bootstrap?.tenant?.id) {
          throw new Error(bootstrapResult?.errors?.[0]?.message ?? "Failed to provision workspace");
        }
        oauthUser = { ...oauthUser, tenantId: bootstrap.tenant.id };
      }

      // Persist the tenantId so the next cold start can rehydrate it and
      // skip the /sign-in bounce. Fire-and-forget — SecureStore writes are
      // async and we don't want to block the happy path for persistence.
      // This code runs after the `Platform.OS === "web"` early return above,
      // so we're guaranteed to be on native here.
      if (oauthUser.tenantId) {
        SecureStore.setItemAsync(STORED_TENANT_ID_KEY, oauthUser.tenantId).catch((e) => {
          console.warn("[AuthProvider] tenantId persist failed:", e);
        });
      }

      setUser(oauthUser);
      setHasStoredSession(true);
      setDidActiveLogin(true);
    } finally {
      oauthInFlightRef.current = false;
    }
  }, []);

  // ------ Sign up / confirm ------
  const handleSignUp = useCallback(
    async (email: string, password: string, name: string) => {
      await auth.signUp(email, password, name);
    },
    [],
  );

  const handleConfirmSignUp = useCallback(
    async (email: string, code: string) => {
      await auth.confirmSignUp(email, code);
    },
    [],
  );

  // ------ Sign out ------
  const handleSignOut = useCallback(() => {
    auth.signOut();
    setAuthToken(null);
    setUser(null);
    setHasStoredSession(false);
    setDidActiveLogin(false);
    // Don't clear stored credentials — user may want biometric login next time.
    // Do clear the persisted tenantId so a fresh sign-in (possibly as a
    // different user) doesn't pick up the previous tenant. Fire-and-forget.
    if (Platform.OS !== "web") {
      SecureStore.deleteItemAsync(STORED_TENANT_ID_KEY).catch(() => {});
    }
  }, []);

  // ------ Token getter (for manual use) ------
  const getToken = useCallback(async () => {
    const token = await auth.getIdToken();
    if (token) setAuthToken(token);
    return token;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: user !== null,
        hasStoredSession,
        didActiveLogin,
        signIn: handleSignIn,
        signUp: handleSignUp,
        confirmSignUp: handleConfirmSignUp,
        signOut: handleSignOut,
        getToken,
        restoreWithCredentials,
        retryBootstrap: runBootstrap,
        signInWithGoogle: handleSignInWithGoogle,
        refreshCounter,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
