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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** True when user actively signed in (typed password or biometric), false for auto-restore */
  didActiveLogin: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  signOut: () => void;
  getToken: () => Promise<string | null>;
  /** Attempt to restore session using stored credentials (after biometric) */
  restoreWithCredentials: () => Promise<boolean>;
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
  const [didActiveLogin, setDidActiveLogin] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const refreshingRef = useRef(false);

  // ------ Bootstrap: wait for SecureStore hydration, then check session ------
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        // Wait for CognitoSecureStorage to hydrate from SecureStore
        await auth.waitForStorageReady();

        // Try to restore the existing Cognito session (password / SRP flow)
        const session = await auth.getCurrentSession();
        if (session && !cancelled) {
          const token = session.getIdToken().getJwtToken();
          setAuthToken(token);
          setUser(auth.parseUserFromSession(session));
          return;
        }

        // Fallback: OAuth/federated sessions can't be restored via SRP,
        // but tokens are stored directly in CognitoSecureStorage. Read the
        // id token sync from storage so we don't depend on getSession's
        // async refresh callback returning in time.
        if (!cancelled) {
          const restoredUser = auth.getCurrentUser();
          if (restoredUser) {
            const oauthToken = await auth.getIdToken();
            if (oauthToken) {
              setAuthToken(oauthToken);
              setUser(restoredUser);
            }
          }
        }
      } catch (e) {
        console.warn("[AuthProvider] bootstrap error:", e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    bootstrap();
    return () => { cancelled = true; };
  }, []);

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
      const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, redirectUri);
      console.log("[AuthProvider] Google OAuth result type:", result.type, "url" in result ? result.url : "no url");

      if (result.type !== "success") return;

      // Parse code from callback URL — avoid `new URL()` which isn't reliable on Hermes
      const codeMatch = result.url.match(/[?&]code=([^&]+)/);
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

      setUser(oauthUser);
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
    setDidActiveLogin(false);
    // Don't clear stored credentials — user may want biometric login next time
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
        didActiveLogin,
        signIn: handleSignIn,
        signUp: handleSignUp,
        confirmSignUp: handleConfirmSignUp,
        signOut: handleSignOut,
        getToken,
        restoreWithCredentials,
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
