import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { exchangeCodeForSession, storeTokensInCognitoStorage, getGoogleSignInUrl } from "@/lib/auth";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
  validateSearch: (search: Record<string, unknown>) => ({
    code: (search.code as string) || "",
    error: (search.error as string) || "",
    error_description: (search.error_description as string) || "",
  }),
});

function AuthCallback() {
  const { code, error: oauthError, error_description } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const exchanged = useRef(false);

  useEffect(() => {
    if (oauthError) {
      // PreSignUp trigger throws on first Google sign-in to link accounts.
      // Cognito retries automatically, but the redirect carries the error.
      // Tell user to try again — the link is now established.
      if (error_description?.includes("PreSignUp") || error_description?.includes("Provider linked")) {
        setError("Account linking in progress. Please try signing in with Google again.");
      } else {
        setError(error_description || oauthError || "OAuth failed");
      }
      return;
    }

    if (!code) {
      setError("No authorization code received.");
      return;
    }

    // Guard against Strict Mode double-fire — auth codes are single-use
    if (exchanged.current) return;
    exchanged.current = true;

    exchangeCodeForSession(code)
      .then((tokens) => {
        storeTokensInCognitoStorage(tokens);
        // If opened as popup, notify parent and close
        if (window.opener) {
          window.opener.location.href = "/new";
          window.close();
          return;
        }
        // Full reload so AuthProvider picks up the new session from localStorage
        window.location.href = "/new";
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "OAuth callback failed");
      });
  }, [code]);

  if (error) {
    const isLinking = error.includes("linking") || error.includes("try again");
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <p className="text-sm text-destructive">{error}</p>
          {isLinking && (
            <button
              onClick={() => {
                // Retry Google sign-in from the popup
                window.location.href = getGoogleSignInUrl();
              }}
              className="text-sm font-medium underline underline-offset-2"
            >
              Try again
            </button>
          )}
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
