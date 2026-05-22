import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { AuthUser } from "@/lib/auth";
import * as auth from "@/lib/auth";
import { getDesktopBridge } from "@/lib/desktop-runtime";
import type { TokenStorage } from "@/lib/token-storage";
import {
  setAuthToken,
  setTokenProvider,
  startTokenRefresh,
  stopTokenRefresh,
} from "@/lib/graphql-client";
import type { ThinkworkBridge } from "@thinkwork/desktop-ipc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  signOut: () => void;
  getToken: () => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export function AuthProvider({
  children,
  tokenStorage = auth.getTokenStorage(),
  desktopBridge = getDesktopBridge(),
}: {
  children: ReactNode;
  tokenStorage?: TokenStorage;
  desktopBridge?: ThinkworkBridge | null;
}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check session on mount — restore cached token for GraphQL client
  useEffect(() => {
    let cancelled = false;
    auth.configureTokenStorage(tokenStorage);

    function clearSession(): void {
      setUser(null);
      setAuthToken(null);
      setTokenProvider(null);
      stopTokenRefresh();
    }

    async function restoreSession(hydrate: boolean): Promise<void> {
      if (hydrate) {
        await Promise.resolve(tokenStorage.hydrate?.()).catch((error) => {
          console.error("[auth] failed to hydrate token storage", error);
        });
      }

      const token = await auth.getIdToken();
      const currentUser = auth.getCurrentUser();
      if (cancelled) return;

      if (token && currentUser) {
        setUser(currentUser);
        setAuthToken(token);
        setTokenProvider(() => auth.getIdToken());
        startTokenRefresh();
        return;
      }

      clearSession();
    }

    void restoreSession(true).finally(() => {
      if (!cancelled) setIsLoading(false);
    });

    const unsubscribe = tokenStorage.subscribe(() => {
      void restoreSession(false);
    });
    const unsubscribeDeepLink = desktopBridge?.onDeepLink(() => {
      void restoreSession(true);
    });
    const unsubscribeSignedOut = desktopBridge?.onSignedOut(() => {
      if (cancelled) return;
      clearSession();
    });
    const unsubscribeOAuthError = desktopBridge?.onOAuthError((event) => {
      console.error("[auth] desktop OAuth failed", event.message);
    });

    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribeDeepLink?.();
      unsubscribeSignedOut?.();
      unsubscribeOAuthError?.();
      stopTokenRefresh();
    };
  }, [desktopBridge, tokenStorage]);

  const handleSignIn = useCallback(
    async (email: string, password: string) => {
      auth.configureTokenStorage(tokenStorage);
      const session = await auth.signIn(email, password);
      void session;
      const token = await auth.getIdToken();
      setAuthToken(token);
      setTokenProvider(() => auth.getIdToken());
      startTokenRefresh();
      setUser(auth.getCurrentUser());
    },
    [tokenStorage],
  );

  const handleSignUp = useCallback(
    async (email: string, password: string, name: string) => {
      await auth.signUp(email, password, name);
      // After sign-up the user still needs to confirm — don't set user yet
    },
    [],
  );

  const handleConfirmSignUp = useCallback(
    async (email: string, code: string) => {
      await auth.confirmSignUp(email, code);
    },
    [],
  );

  const handleSignOut = useCallback(() => {
    stopTokenRefresh();
    setTokenProvider(null);
    setAuthToken(null);
    setUser(null);
    if (desktopBridge) {
      void desktopBridge.signOut().catch((error) => {
        console.error("[auth] desktop sign-out failed", error);
      });
      return;
    }
    // `auth.signOut()` redirects through Cognito's hosted-UI `/logout` so the
    // Cognito session cookie is cleared on its way back to `/sign-in`.
    auth.signOut();
  }, [desktopBridge]);

  const getToken = useCallback(() => auth.getIdToken(), []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: user !== null,
        signIn: handleSignIn,
        signUp: handleSignUp,
        confirmSignUp: handleConfirmSignUp,
        signOut: handleSignOut,
        getToken,
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
