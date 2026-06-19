import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { DesktopConfig } from "@thinkwork/desktop-ipc";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@thinkwork/ui";
import { DesktopWindowHeader } from "@/components/DesktopWindowHeader";
import { EmailPasswordForm } from "@/components/auth/EmailPasswordForm";
import { useAuth } from "@/context/AuthContext";
import {
  getAuthOptionSignInUrl,
  isPasswordSignInConfigured,
} from "@/lib/auth";
import {
  fetchPublicAuthOptions,
  type PublicAuthOptions,
  type PublicOAuthOption,
} from "@/lib/auth-options";
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
  const [authOptions, setAuthOptions] = useState<PublicAuthOptions>({
    password: { enabled: true },
    oauthOptions: [],
  });

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

  useEffect(() => {
    if (isDesktop) return;
    let cancelled = false;
    void fetchPublicAuthOptions().then((options) => {
      if (!cancelled) setAuthOptions(options);
    });
    return () => {
      cancelled = true;
    };
  }, [isDesktop]);

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

  async function handleDesktopOAuth() {
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
    setError("Desktop bridge is unavailable.");
  }

  function handlePublicOAuth(option: PublicOAuthOption) {
    setError(null);
    if (!webDeploymentProfile.okForOAuth) {
      setError(
        `Deployment configuration is incomplete: ${webDeploymentProfile.missing.join(", ")}`,
      );
      return;
    }
    window.location.href = getAuthOptionSignInUrl(option, next || "/new");
  }

  const webConfigBlocked = !isDesktop && !webDeploymentProfile.okForOAuth;
  const publicOAuthOptions = isDesktop ? [] : authOptions.oauthOptions;
  const showPasswordForm =
    !isDesktop && authOptions.password.enabled && isPasswordSignInConfigured();
  const showPublicOAuthOptions = publicOAuthOptions.length > 0;

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
          {isDesktop ? (
            <Button
              onClick={() => void handleDesktopOAuth()}
              size="lg"
              className="min-w-40"
              disabled={
                isLoading ||
                isStartingOAuth ||
                isProfileBusy ||
                Boolean(desktopConfig && !desktopConfig.configured)
              }
            >
              {isLoading
                ? "Checking session..."
                : isStartingOAuth || isProfileBusy
                  ? "Opening..."
                  : "Log in"}
            </Button>
          ) : (
            showPublicOAuthOptions &&
            publicOAuthOptions.map((option) => (
              <Button
                key={option.key}
                onClick={() => handlePublicOAuth(option)}
                size="lg"
                variant={showPasswordForm ? "outline" : "default"}
                className={showPasswordForm ? "w-full" : "min-w-40"}
                disabled={isLoading || isStartingOAuth || webConfigBlocked}
              >
                {isLoading ? (
                  "Checking session..."
                ) : isStartingOAuth ? (
                  "Opening..."
                ) : (
                  <>
                    <SsoIcon />
                    {option.label}
                  </>
                )}
              </Button>
            ))
          )}
          {showPasswordForm && (
            <>
              {showPublicOAuthOptions && (
                <div
                  aria-hidden="true"
                  className="flex w-full items-center gap-3 text-xs text-muted-foreground"
                >
                  <span className="h-px flex-1 bg-border" />
                  or
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              <EmailPasswordForm disabled={isLoading || webConfigBlocked} />
            </>
          )}
          {!isDesktop && !showPasswordForm && !showPublicOAuthOptions && (
            <p className="text-center text-sm text-muted-foreground">
              Sign-in options are unavailable.
            </p>
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

function desktopDeploymentLabel(config: DesktopConfig): string {
  const deployment = config.deployment;
  if (!deployment) return config.stage;
  return [deployment.displayName, deployment.stage, deployment.region]
    .filter(Boolean)
    .join(" · ");
}

function SsoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path
        d="M12 3 4.5 6.5v5.4c0 4.35 3.08 7.43 7.5 9.1 4.42-1.67 7.5-4.75 7.5-9.1V6.5L12 3Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M8.5 12.2 11 14.7l4.8-5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
