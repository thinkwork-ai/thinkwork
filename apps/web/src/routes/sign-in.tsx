import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { DesktopConfig } from "@thinkwork/desktop-ipc";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@thinkwork/ui";
import { DesktopWindowHeader } from "@/components/DesktopWindowHeader";
import { EmailPasswordForm } from "@/components/auth/EmailPasswordForm";
import { useAuth } from "@/context/AuthContext";
import {
  type AuthProvider,
  getEnabledAuthProviders,
  getHostedSignInUrl,
  getProviderSignInUrl,
  isPasswordSignInConfigured,
} from "@/lib/auth";
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
  const canCreateEnvironment = isCentralOnboardingHost();
  const authProviders = useMemo(() => getEnabledAuthProviders(), []);
  const webDeploymentProfile = useMemo(
    () => getSpacesDeploymentProfileSnapshot(),
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [desktopConfig, setDesktopConfig] = useState<DesktopConfig | null>(
    null,
  );
  const [isStartingOAuth, setIsStartingOAuth] = useState(false);
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

  async function handleProviderSignIn(provider: AuthProvider | null) {
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
        const request = {
          ...(next ? { next } : {}),
          ...(provider ? { provider: provider.identityProvider } : {}),
        };
        await bridge.startOAuth(Object.keys(request).length ? request : undefined);
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

    // Provider-specific redirects skip the unbranded Cognito hosted-UI
    // picker. That keeps customer deployments with password sign-in hidden
    // from landing on Cognito's "login option is not available" form.
    window.location.href = provider
      ? getProviderSignInUrl(provider)
      : getHostedSignInUrl();
  }

  const webConfigBlocked = !isDesktop && !webDeploymentProfile.okForOAuth;
  const showPasswordForm = !isDesktop && isPasswordSignInConfigured();

  const splash = (
    <main className="flex min-h-0 flex-1 items-center justify-center px-6 py-12">
      <section
        aria-label="Sign in"
        className="flex w-full max-w-xs flex-col items-center gap-8"
      >
        <div className="flex flex-col items-center gap-4">
          <img
            src="/logo.png"
            alt=""
            className="size-14 object-contain"
            aria-hidden="true"
          />
          <div className="flex flex-col items-center gap-1.5 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">
              Log in to ThinkWork
            </h1>
            {canCreateEnvironment && (
              <p className="text-xs text-muted-foreground">
                Don&apos;t have an environment?{" "}
                <Link
                  to="/onboarding/welcome"
                  className="rounded-sm font-medium text-foreground underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Create one
                </Link>
                .
              </p>
            )}
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
          </div>
        )}
        <div className="flex w-full flex-col items-center gap-4">
          <div className="flex w-full flex-col items-center gap-2">
            {authProviders.length > 0 ? (
              authProviders.map((provider, index) => (
                <Button
                  key={provider.key}
                  onClick={() => void handleProviderSignIn(provider)}
                  size="lg"
                  variant={showPasswordForm || index > 0 ? "outline" : "default"}
                  className="w-full"
                  disabled={
                    isLoading ||
                    isStartingOAuth ||
                    isProfileBusy ||
                    Boolean(desktopConfig && !desktopConfig.configured) ||
                    webConfigBlocked
                  }
                >
                  {isLoading ? (
                    "Checking session..."
                  ) : isStartingOAuth || isProfileBusy ? (
                    "Opening..."
                  ) : (
                    <>
                      <ProviderIcon provider={provider.key} />
                      Log in with {provider.label}
                    </>
                  )}
                </Button>
              ))
            ) : (
              <Button
                onClick={() => void handleProviderSignIn(null)}
                size="lg"
                className="w-full"
                disabled={
                  isLoading ||
                  isStartingOAuth ||
                  isProfileBusy ||
                  Boolean(desktopConfig && !desktopConfig.configured) ||
                  webConfigBlocked
                }
              >
                {isLoading
                  ? "Checking session..."
                  : isStartingOAuth || isProfileBusy
                    ? "Opening..."
                    : "Log in"}
              </Button>
            )}
          </div>
          {showPasswordForm && (
            <>
              <div
                aria-hidden="true"
                className="flex w-full items-center gap-3 text-xs text-muted-foreground"
              >
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>
              <EmailPasswordForm disabled={isLoading || webConfigBlocked} />
            </>
          )}
          {!isDesktop && (
            <div className="text-center text-xs text-muted-foreground/60">
              <p>
                {webDeploymentProfile.okForOAuth
                  ? `${webDeploymentProfile.displayName} · ${webDeploymentProfile.stage} · ${webDeploymentProfile.region}`
                  : `Configuration incomplete for ${webDeploymentProfile.stage}`}
              </p>
              {webConfigBlocked && (
                <p className="mt-1 text-destructive">
                  Missing {webDeploymentProfile.missing.join(", ")}
                </p>
              )}
            </div>
          )}
        </div>
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

function isCentralOnboardingHost(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "app.thinkwork.ai";
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#f25022" d="M3 3h8.5v8.5H3z" />
      <path fill="#7fba00" d="M12.5 3H21v8.5h-8.5z" />
      <path fill="#00a4ef" d="M3 12.5h8.5V21H3z" />
      <path fill="#ffb900" d="M12.5 12.5H21V21h-8.5z" />
    </svg>
  );
}

function ProviderIcon({ provider }: { provider: AuthProvider["key"] }) {
  if (provider === "microsoft") return <MicrosoftIcon />;
  return <GoogleIcon />;
}

function desktopDeploymentLabel(config: DesktopConfig): string {
  const deployment = config.deployment;
  if (!deployment) return config.stage;
  return [deployment.displayName, deployment.stage, deployment.region]
    .filter(Boolean)
    .join(" · ");
}
