import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@thinkwork/ui";
import { DesktopWindowHeader } from "@/components/DesktopWindowHeader";
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
  const isDesktop = isDesktopBuild();
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

  const splash = (
    <main className="flex min-h-0 flex-1 items-center justify-center px-6 py-12">
      <section
        aria-label="Sign in"
        className="flex w-full max-w-xs flex-col items-center gap-8"
      >
        <div className="flex flex-col items-center gap-3">
          <img
            src="/logo.png"
            alt=""
            className="size-16 object-contain"
            aria-hidden="true"
          />
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">ThinkWork</h1>
            <p className="text-sm text-muted-foreground">Spaces</p>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-center text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          onClick={() => void handleGoogle()}
          size="lg"
          className="min-w-40"
          disabled={isLoading || isStartingOAuth}
        >
          {isLoading
            ? "Checking session..."
            : isStartingOAuth
              ? "Opening..."
              : "Log in"}
        </Button>
      </section>
    </main>
  );

  if (isDesktop) {
    return (
      <div className="flex min-h-svh flex-col bg-background text-foreground">
        <DesktopWindowHeader />
        {splash}
      </div>
    );
  }

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      {splash}
    </div>
  );
}
