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
import { setAuthToken, setTokenProvider, startTokenRefresh, stopTokenRefresh } from "@/lib/graphql-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    name: string,
  ) => Promise<void>;
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
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check session on mount — restore cached token for GraphQL client
  useEffect(() => {
    auth
      .getCurrentSession()
      .then(async (session) => {
        if (session) {
          setUser(auth.getCurrentUser());
          const token = await auth.getIdToken();
          setAuthToken(token);
          setTokenProvider(() => auth.getIdToken());
          startTokenRefresh();
        }
      })
      .finally(() => setIsLoading(false));

    return () => stopTokenRefresh();
  }, []);

  const handleSignIn = useCallback(
    async (email: string, password: string) => {
      const session = await auth.signIn(email, password);
      void session;
      const token = await auth.getIdToken();
      setAuthToken(token);
      setTokenProvider(() => auth.getIdToken());
      startTokenRefresh();
      setUser(auth.getCurrentUser());
    },
    [],
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
    auth.signOut();
    setAuthToken(null);
    setUser(null);
    window.location.href = "/sign-in";
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
