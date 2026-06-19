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
  AUTH_DEPLOYMENT_BINDING_STORAGE_KEY,
  AUTH_DEPLOYMENT_PROFILE_SHA_STORAGE_KEY,
  ensureAuthStorageMatchesDeploymentProfile,
  markAuthStorageDeploymentProfile,
} from "@/lib/auth-deployment-binding";
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
  signIn: (
    email: string,
    password: string,
    newPassword?: string,
  ) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  signOut: () => void;
  getToken: () => Promise<string | null>;
}

const DEFAULT_SESSION_RESTORE_TIMEOUT_MS = 8_000;

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
  sessionRestoreTimeoutMs = DEFAULT_SESSION_RESTORE_TIMEOUT_MS,
}: {
  children: ReactNode;
  tokenStorage?: TokenStorage;
  desktopBridge?: ThinkworkBridge | null;
  sessionRestoreTimeoutMs?: number;
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
      try {
        if (hydrate) {
          await withTimeout(
            Promise.resolve(tokenStorage.hydrate?.()),
            sessionRestoreTimeoutMs,
            "Token storage hydration",
          ).catch((error) => {
            console.error("[auth] failed to hydrate token storage", error);
          });
        }

        if (!ensureAuthStorageMatchesDeploymentProfile(tokenStorage)) {
          auth.clearLocalAuthSession();
          clearSession();
          return;
        }

        const token = await withTimeout(
          auth.getIdToken(),
          sessionRestoreTimeoutMs,
          "Session restore",
        );
        const currentUser = auth.getCurrentUser();
        if (cancelled) return;

        if (token && currentUser) {
          markAuthStorageDeploymentProfile(tokenStorage);
          setUser(currentUser);
          setAuthToken(token);
          setTokenProvider(() => auth.getIdToken());
          startTokenRefresh();
          return;
        }

        clearSession();
      } catch (error) {
        if (cancelled) return;
        console.error("[auth] session restore failed", error);
        clearSession();
      }
    }

    void restoreSession(true).finally(() => {
      if (!cancelled) setIsLoading(false);
    });

    const unsubscribe = tokenStorage.subscribe(() => {
      void restoreSession(false);
    });
    const unsubscribeDeepLink = desktopBridge?.onDeepLink((callback) => {
      if ("type" in callback && callback.type === "deployment-profile") return;
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
  }, [desktopBridge, sessionRestoreTimeoutMs, tokenStorage]);

  const handleSignIn = useCallback(
    async (email: string, password: string, newPassword?: string) => {
      auth.configureTokenStorage(tokenStorage);
      const session = await auth.signIn(email, password, newPassword);
      void session;
      const token = await auth.getIdToken();
      markAuthStorageDeploymentProfile(tokenStorage);
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
    tokenStorage.removeItem(AUTH_DEPLOYMENT_BINDING_STORAGE_KEY);
    tokenStorage.removeItem(AUTH_DEPLOYMENT_PROFILE_SHA_STORAGE_KEY);
    if (desktopBridge) {
      void desktopBridge.signOut().catch((error) => {
        console.error("[auth] desktop sign-out failed", error);
      });
      return;
    }
    void auth.signOut();
  }, [desktopBridge, tokenStorage]);

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

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  if (timeoutMs <= 0) return promise;

  promise.catch(() => undefined);

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
