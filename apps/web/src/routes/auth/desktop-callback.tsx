import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { getTokenStorage } from "@/lib/auth";
import { getDesktopBridge, normalizeDesktopNext } from "@/lib/desktop-runtime";

const POST_SIGN_IN_PATH = "/new";

export const Route = createFileRoute("/auth/desktop-callback")({
  component: DesktopAuthCallback,
});

export function DesktopAuthCallback() {
  const navigate = useNavigate();
  const consumed = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;

    const bridge = getDesktopBridge();
    if (!bridge) {
      setError("Desktop bridge is unavailable.");
      return;
    }
    const desktopBridge = bridge;

    let cancelled = false;

    async function consumeCallback(): Promise<void> {
      const callback = await desktopBridge.consumePendingOAuth();
      if (cancelled) return;

      if (!callback) {
        setError("No pending desktop sign-in callback.");
        return;
      }

      await Promise.resolve(getTokenStorage().hydrate?.());
      if (cancelled) return;

      navigateToDesktopPath(
        navigate,
        normalizeDesktopNext(callback.next) ?? POST_SIGN_IN_PATH,
      );
    }

    void consumeCallback().catch((callbackError) => {
      if (cancelled) return;
      setError(
        callbackError instanceof Error
          ? callbackError.message
          : "Desktop sign-in callback failed",
      );
    });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (error) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="space-y-3 text-center">
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

function navigateToDesktopPath(
  navigate: ReturnType<typeof useNavigate>,
  destination: string,
): void {
  void navigate({ to: destination, replace: true } as Parameters<
    typeof navigate
  >[0]);
}
