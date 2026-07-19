import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  exchangeLegacyWorkosBridge,
  exchangeCodeForSession,
  storeTokensInCognitoStorage,
} from "@/lib/auth";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
  validateSearch: (search: Record<string, unknown>) => ({
    code: (search.code as string) || "",
    state: (search.state as string) || "",
    error: (search.error as string) || "",
    error_description: (search.error_description as string) || "",
    workos_bridge: (search.workos_bridge as string) || "",
  }),
});

export function AuthCallback() {
  const {
    code,
    state,
    error: oauthError,
    error_description,
    workos_bridge,
  } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const exchanged = useRef(false);

  useEffect(() => {
    if (oauthError) {
      setError(error_description || oauthError || "OAuth failed");
      return;
    }

    if (!code && !workos_bridge) {
      setError("No authorization code received.");
      return;
    }

    // Guard against Strict Mode double-fire — auth codes are single-use
    if (exchanged.current) return;
    exchanged.current = true;

    (workos_bridge
      ? exchangeLegacyWorkosBridge(workos_bridge)
      : exchangeCodeForSession(code, state)
    )
      .then((session) => {
        storeTokensInCognitoStorage(session.tokens, session.clientId);
        const nextTarget = session.next;
        // If opened as popup, notify parent and close
        if (window.opener) {
          window.opener.location.href = nextTarget;
          window.close();
          return;
        }
        // Full reload so AuthProvider picks up the new session from localStorage
        window.location.href = nextTarget;
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "OAuth callback failed");
      });
  }, [code, error_description, oauthError, state, workos_bridge]);

  if (error) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <p className="text-sm text-destructive">{error}</p>
          <a href="/sign-in" className="block text-sm underline">
            Back to sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Signing you in...</p>
    </div>
  );
}
