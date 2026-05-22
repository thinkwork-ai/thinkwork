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
import type { TokenStorage } from "@/lib/token-storage";
import {
  setAuthToken,
  setTokenProvider,
  startTokenRefresh,
  stopTokenRefresh,
} from "@/lib/graphql-client";

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
}: {
  children: ReactNode;
  tokenStorage?: TokenStorage;
}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check session on mount — restore cached token for GraphQL client
  useEffect(() => {
    let cancelled = false;
    auth.configureTokenStorage(tokenStorage);

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

      setUser(null);
      setAuthToken(null);
      setTokenProvider(null);
      stopTokenRefresh();
    }

    void restoreSession(true).finally(() => {
      if (!cancelled) setIsLoading(false);
    });

    const unsubscribe = tokenStorage.subscribe(() => {
      void restoreSession(false);
    });

    return () => {
      cancelled = true;
      unsubscribe();
      stopTokenRefresh();
    };
  }, [tokenStorage]);

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
    // `auth.signOut()` redirects through Cognito's hosted-UI `/logout` so the
    // Cognito session cookie is cleared on its way back to `/sign-in`.
    auth.signOut();
  }, []);

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
