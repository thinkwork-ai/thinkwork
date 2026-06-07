import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { DesktopConfig } from "@thinkwork/desktop-ipc";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@thinkwork/ui";
import { DesktopWindowHeader } from "@/components/DesktopWindowHeader";
import { useAuth } from "@/context/AuthContext";
import { getGoogleSignInUrl } from "@/lib/auth";
import { getSpacesDeploymentProfileSnapshot } from "@/lib/deployment-profile";
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
  const webDeploymentProfile = useMemo(
    () => getSpacesDeploymentProfileSnapshot(),
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [desktopConfig, setDesktopConfig] = useState<DesktopConfig | null>(
    null,
  );
  const [isStartingOAuth, setIsStartingOAuth] = useState(false);
  const [profileJson, setProfileJson] = useState("");
  const [isProfileBusy, setIsProfileBusy] = useState(false);

  const refreshDesktopConfig = useCallback(async () => {
    const bridge = getDesktopBridge();
    if (!bridge || typeof bridge.getDesktopConfig !== "function") return null;
    const config = await bridge.getDesktopConfig();
    setDesktopConfig(config);
    return config;
  }, []);

  // If the user is already signed in, send them to the new-thread workspace.
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate({ to: "/new", search: { spaceId: undefined }, replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge || typeof bridge.onOAuthError !== "function") return;

    return bridge.onOAuthError((event) => {
      setError(event.message);
      setIsStartingOAuth(false);
    });
  }, []);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge || typeof bridge.getDesktopConfig !== "function") return;

    let cancelled = false;
    void refreshDesktopConfig()
      .then((config) => {
        if (!cancelled) setDesktopConfig(config);
      })
      .catch((configError) => {
        if (!cancelled) {
          setError(
            configError instanceof Error
              ? configError.message
              : "Desktop configuration could not be read.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshDesktopConfig]);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge || typeof bridge.onDeepLink !== "function") return;

    return bridge.onDeepLink((callback) => {
      if (!("type" in callback) || callback.type !== "deployment-profile") {
        return;
      }
      void importDesktopProfile(callback.json);
    });
  });

  async function importDesktopProfile(json: string) {
    const bridge = getDesktopBridge();
    if (!bridge || typeof bridge.importDeploymentProfile !== "function") {
      setError("Desktop profile import is unavailable.");
      return;
    }

    setError(null);
    setIsProfileBusy(true);
    try {
      const config = await bridge.importDeploymentProfile({ json });
      await bridge.clearTokenStorage();
      setDesktopConfig(config);
      setProfileJson("");
    } catch (profileError) {
      setError(
        profileError instanceof Error
          ? profileError.message
          : "Deployment profile import failed.",
      );
      await refreshDesktopConfig().catch(() => undefined);
    } finally {
      setIsProfileBusy(false);
    }
  }

  async function handleProfileFile(file: File | null | undefined) {
    if (!file) return;
    await importDesktopProfile(await file.text());
  }

  async function removeDesktopProfile() {
    const bridge = getDesktopBridge();
    if (!bridge || typeof bridge.removeDeploymentProfile !== "function") {
      setError("Desktop profile removal is unavailable.");
      return;
    }

    setError(null);
    setIsProfileBusy(true);
    try {
      const config = await bridge.removeDeploymentProfile();
      await bridge.clearTokenStorage();
      setDesktopConfig(config);
      setProfileJson("");
    } catch (profileError) {
      setError(
        profileError instanceof Error
          ? profileError.message
          : "Deployment profile removal failed.",
      );
    } finally {
      setIsProfileBusy(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    const bridge = getDesktopBridge();
    if (bridge) {
      if (desktopConfig && !desktopConfig.configured) {
        setError(
          `Desktop is missing configuration: ${desktopConfig.missing.join(", ")}`,
        );
        return;
      }
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
    if (!webDeploymentProfile.okForOAuth) {
      setError(
        `Deployment configuration is incomplete: ${webDeploymentProfile.missing.join(", ")}`,
      );
      return;
    }

    window.location.href = getGoogleSignInUrl();
  }

  const webConfigBlocked = !isDesktop && !webDeploymentProfile.okForOAuth;

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
          </div>
        </div>
        {error && (
          <p role="alert" className="text-center text-sm text-destructive">
            {error}
          </p>
        )}
        {isDesktop && desktopConfig && (
          <div className="flex w-full flex-col items-center gap-3 text-center text-xs text-muted-foreground">
            <p>
              {desktopConfig.configured
                ? `Connected to ${desktopDeploymentLabel(desktopConfig)}`
                : `Configuration incomplete for ${desktopDeploymentLabel(desktopConfig)}`}
            </p>
            {desktopConfig.deployment && (
              <p className="max-w-full truncate">
                {desktopConfig.deployment.trustLabel}
              </p>
            )}
            {!desktopConfig.configured && (
              <p className="mt-1 text-destructive">
                Missing {desktopConfig.missing.join(", ")}
              </p>
            )}
            <div className="grid w-full gap-2">
              <textarea
                aria-label="Deployment profile JSON"
                value={profileJson}
                onChange={(event) => setProfileJson(event.target.value)}
                rows={3}
                className="min-h-20 w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-left text-xs text-foreground shadow-sm outline-none focus:border-ring"
                disabled={isProfileBusy || isAuthenticated}
              />
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    isProfileBusy || isAuthenticated || !profileJson.trim()
                  }
                  onClick={() => void importDesktopProfile(profileJson)}
                >
                  Import
                </Button>
                <label className="inline-flex h-8 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground has-[:disabled]:pointer-events-none has-[:disabled]:opacity-50">
                  File
                  <input
                    aria-label="Deployment profile file"
                    type="file"
                    accept="application/json,.json"
                    className="sr-only"
                    disabled={isProfileBusy || isAuthenticated}
                    onChange={(event) =>
                      void handleProfileFile(event.currentTarget.files?.[0])
                    }
                  />
                </label>
                {desktopConfig.deployment?.source === "profile" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isProfileBusy || isAuthenticated}
                    onClick={() => void removeDesktopProfile()}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
        {!isDesktop && (
          <div className="text-center text-xs text-muted-foreground">
            <p>
              {webDeploymentProfile.okForOAuth
                ? `${webDeploymentProfile.displayName} · ${webDeploymentProfile.stage} · ${webDeploymentProfile.region}`
                : `Configuration incomplete for ${webDeploymentProfile.stage}`}
            </p>
            <p className={webConfigBlocked ? "mt-1 text-destructive" : "mt-1"}>
              {webConfigBlocked
                ? `Missing ${webDeploymentProfile.missing.join(", ")}`
                : webDeploymentProfile.trustLabel}
            </p>
          </div>
        )}
        <Button
          onClick={() => void handleGoogle()}
          size="lg"
          className="min-w-40"
          disabled={
            isLoading ||
            isStartingOAuth ||
            Boolean(desktopConfig && !desktopConfig.configured) ||
            webConfigBlocked
          }
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

function desktopDeploymentLabel(config: DesktopConfig): string {
  const deployment = config.deployment;
  if (!deployment) return config.stage;
  return [deployment.displayName, deployment.stage, deployment.region]
    .filter(Boolean)
    .join(" · ");
}
