import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { Button } from "@thinkwork/ui";
import { useAuth } from "@/context/AuthContext";
import { getGoogleSignInUrl } from "@/lib/auth";
import {
  getDesktopBridge,
  isDesktopBuild,
  normalizeDesktopNext,
} from "@/lib/desktop-runtime";

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>) => ({
    next: normalizeDesktopNext(search.next),
  }),
  component: SignInPage,
});

export function SignInPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [isStartingOAuth, setIsStartingOAuth] = useState(false);

  // If the user is already signed in, send them to the new-thread workspace.
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate({ to: "/new", search: { spaceId: undefined }, replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;

    return bridge.onOAuthError((event) => {
      setError(event.message);
      setIsStartingOAuth(false);
    });
  }, []);

  async function handleGoogle() {
    setError(null);
    const bridge = getDesktopBridge();
    if (bridge) {
      setIsStartingOAuth(true);
      try {
        await bridge.startOAuth(next ? { next } : undefined);
      } catch (oauthError) {
        setError(
          oauthError instanceof Error
            ? oauthError.message
            : "Desktop sign-in failed",
        );
      } finally {
        setIsStartingOAuth(false);
      }
      return;
    }
    if (isDesktopBuild()) {
      setError("Desktop bridge is unavailable.");
      return;
    }

    window.location.href = getGoogleSignInUrl();
  }

  return (
    <div className="min-h-svh flex flex-col items-center justify-center gap-6 px-6 py-12">
      <div className="flex items-center gap-3">
        <Bot className="h-8 w-8 text-primary" />
        <span className="text-2xl font-semibold tracking-tight">ThinkWork</span>
      </div>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        Sign in with the Google account associated with your tenant.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        onClick={() => void handleGoogle()}
        size="lg"
        className="min-w-[280px]"
        disabled={isStartingOAuth}
      >
        {isStartingOAuth ? "Opening Google..." : "Continue with Google"}
      </Button>
      <p className="text-xs text-muted-foreground">
        ThinkWork is the collaborative workspace for your AI workplace.
      </p>
    </div>
  );
}
