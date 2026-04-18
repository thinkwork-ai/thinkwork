import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  exchangeCodeForTokens,
  getCurrentSession,
  getGoogleSignInUrl,
  getIdToken,
  parseUserFromSession,
  signIn as cognitoSignIn,
  signOut as cognitoSignOut,
  storeOAuthTokens,
  waitForStorageReady,
} from "./cognito";
import type {
  ThinkworkAuthContextValue,
  ThinkworkAuthStatus,
  ThinkworkConfig,
  ThinkworkUser,
} from "../types";
import { setAuthToken } from "../graphql/token";

const AuthContext = createContext<ThinkworkAuthContextValue | null>(null);

export function ThinkworkAuthProvider({
  config,
  children,
}: {
  config: ThinkworkConfig;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<ThinkworkAuthStatus>("unknown");
  const [user, setUser] = useState<ThinkworkUser | null>(null);
  const refreshingRef = useRef(false);

  const restore = useCallback(async () => {
    try {
      await waitForStorageReady();
      const session = await getCurrentSession(config);
      if (!session) {
        setStatus("signed-out");
        setUser(null);
        setAuthToken(null);
        return;
      }
      const token = session.getIdToken().getJwtToken();
      setAuthToken(token);
      setUser(parseUserFromSession(session));
      setStatus("signed-in");
    } catch (e) {
      config.logger?.warn("auth restore failed", e);
      setStatus("error");
    }
  }, [config]);

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", async (next) => {
      if (next !== "active" || !user || refreshingRef.current) return;
      refreshingRef.current = true;
      try {
        const token = await getIdToken(config);
        if (token) setAuthToken(token);
      } finally {
        refreshingRef.current = false;
      }
    });
    return () => sub.remove();
  }, [config, user]);

  const handleSignIn = useCallback(
    async (email: string, password: string) => {
      const session = await cognitoSignIn(config, email, password);
      const token = session.getIdToken().getJwtToken();
      setAuthToken(token);
      setUser(parseUserFromSession(session));
      setStatus("signed-in");
    },
    [config],
  );

  const handleSignOut = useCallback(async () => {
    cognitoSignOut(config);
    setAuthToken(null);
    setUser(null);
    setStatus("signed-out");
  }, [config]);

  const handleSignInWithGoogle = useCallback(async () => {
    const redirectUri = config.oauthRedirectUri;
    if (!redirectUri) throw new Error("Google sign-in requires `oauthRedirectUri` in ThinkworkConfig.");
    const authorizeUrl = getGoogleSignInUrl(config);
    const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, redirectUri);
    if (result.type !== "success" || !("url" in result) || !result.url) {
      throw new Error("Google sign-in cancelled");
    }
    // Parse code without `new URL()` — not reliable on Hermes. Stop at `&` AND `#`
    // because Cognito appends a trailing `#` fragment in some flows.
    const match = result.url.match(/[?&]code=([^&#]+)/);
    const code = match?.[1] ? decodeURIComponent(match[1]) : null;
    if (!code) throw new Error("No authorization code returned from Cognito");
    const tokens = await exchangeCodeForTokens(config, code);
    const oauthUser = storeOAuthTokens(config, tokens);
    setAuthToken(tokens.id_token);
    setUser(oauthUser);
    setStatus("signed-in");
  }, [config]);

  const handleGetToken = useCallback(async () => {
    const token = await getIdToken(config);
    if (token) setAuthToken(token);
    return token;
  }, [config]);

  const value = useMemo<ThinkworkAuthContextValue>(
    () => ({
      status,
      user,
      signIn: handleSignIn,
      signInWithGoogle: handleSignInWithGoogle,
      signOut: handleSignOut,
      getIdToken: handleGetToken,
    }),
    [status, user, handleSignIn, handleSignInWithGoogle, handleSignOut, handleGetToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useThinkworkAuth(): ThinkworkAuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useThinkworkAuth must be used inside ThinkworkProvider");
  return ctx;
}
