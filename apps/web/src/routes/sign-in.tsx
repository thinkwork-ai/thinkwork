import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button, Spinner } from "@thinkwork/ui";
import { EmailPasswordForm } from "@/components/auth/EmailPasswordForm";
import { useAuth } from "@/context/AuthContext";
import {
  configurePasswordAuthClient,
  getAuthOptionSignInUrl,
  getLegacyIdentityMigrationStartUrl,
  isPasswordSignInConfigured,
} from "@/lib/auth";
import {
  fetchPublicAuthOptions,
  type PublicAuthOptions,
  type PublicOAuthOption,
} from "@/lib/auth-options";
import { getSpacesDeploymentProfileSnapshot } from "@/lib/deployment-profile";

interface SignInSearch {
  next?: string;
  legacyMigration?: "workos";
}

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    next: normalizeNextPath(search.next),
    legacyMigration:
      search.legacyMigration === "workos" ? ("workos" as const) : undefined,
  }),
  component: SignInPage,
});

export function SignInPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const { next, legacyMigration } = Route.useSearch();
  const navigate = useNavigate();
  const canCreateEnvironment = isCentralOnboardingHost();
  const webDeploymentProfile = useMemo(
    () => getSpacesDeploymentProfileSnapshot(),
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [startingOAuthKey, setStartingOAuthKey] = useState<string | null>(null);
  const isStartingOAuth = startingOAuthKey !== null;
  const [authOptions, setAuthOptions] = useState<PublicAuthOptions>({
    password: { enabled: false },
    oauthOptions: [],
  });

  // If the user is already signed in, send them to the new-thread workspace.
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      if (next) {
        window.location.href = next;
      } else {
        navigate({ to: "/new", search: { spaceId: undefined }, replace: true });
      }
    }
  }, [isAuthenticated, isLoading, navigate, next]);

  useEffect(() => {
    let cancelled = false;
    void fetchPublicAuthOptions(fetch, "web").then((options) => {
      if (!cancelled) {
        configurePasswordAuthClient(options.password.clientId);
        setAuthOptions(options);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handlePublicOAuth(option: PublicOAuthOption) {
    setError(null);
    if (!webDeploymentProfile.okForOAuth) {
      setError(
        `Deployment configuration is incomplete: ${webDeploymentProfile.missing.join(", ")}`,
      );
      return;
    }
    setStartingOAuthKey(option.key);
    try {
      window.location.href = await getAuthOptionSignInUrl(
        option,
        next || "/new",
      );
    } catch (oauthError) {
      setError(
        oauthError instanceof Error
          ? oauthError.message
          : "Sign-in could not be started.",
      );
      setStartingOAuthKey(null);
    }
  }

  function handleLegacyIdentityMigration() {
    const migration = authOptions.legacyMigration;
    if (!migration) return;
    setError(null);
    try {
      window.location.href = getLegacyIdentityMigrationStartUrl(
        migration.authorizePath,
        next || "/new",
      );
    } catch (migrationError) {
      setError(
        migrationError instanceof Error
          ? migrationError.message
          : "Account migration could not be started.",
      );
    }
  }

  const webConfigBlocked = !webDeploymentProfile.okForOAuth;
  const publicOAuthOptions = authOptions.oauthOptions;
  const showPasswordForm =
    authOptions.password.enabled && isPasswordSignInConfigured();
  const showPublicOAuthOptions = publicOAuthOptions.length > 0;
  const showLegacyMigration =
    legacyMigration === "workos" && Boolean(authOptions.legacyMigration);
  const loginBlocked = webConfigBlocked;

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
        <div className="flex w-full flex-col items-center gap-4">
          {showLegacyMigration && (
            <div className="flex w-full flex-col gap-3 text-center">
              <p className="text-sm text-muted-foreground">
                Verify your previous account before choosing a new sign-in
                method.
              </p>
              <Button
                size="lg"
                className="w-full"
                disabled={isLoading || isStartingOAuth || webConfigBlocked}
                onClick={handleLegacyIdentityMigration}
              >
                Continue account migration
              </Button>
            </div>
          )}
          {!showLegacyMigration && showPublicOAuthOptions && (
            <div
              className={
                publicOAuthOptions.length > 1
                  ? "grid w-full gap-3 min-[360px]:grid-cols-2"
                  : "grid w-full gap-3"
              }
            >
              {publicOAuthOptions.map((option) => {
                const provider = oauthProviderLabel(option);
                const isOpening = startingOAuthKey === option.key;
                const label = option.label;
                return (
                  <Button
                    key={option.key}
                    aria-label={
                      isLoading
                        ? "Checking session"
                        : isOpening
                          ? `Opening ${provider}`
                          : label
                    }
                    onClick={() => void handlePublicOAuth(option)}
                    size="lg"
                    variant={showPasswordForm ? "outline" : "default"}
                    className="w-full min-w-0"
                    disabled={isLoading || isStartingOAuth || loginBlocked}
                  >
                    {isOpening ? (
                      <Spinner aria-label={`Opening ${provider}`} />
                    ) : (
                      <>
                        <ProviderIcon icon={option.icon} />
                        {provider}
                      </>
                    )}
                  </Button>
                );
              })}
            </div>
          )}
          {!showLegacyMigration && showPasswordForm && (
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
              <EmailPasswordForm disabled={isLoading || loginBlocked} />
            </>
          )}
          {!showLegacyMigration &&
            !showPasswordForm &&
            !showPublicOAuthOptions && (
              <p className="text-center text-sm text-muted-foreground">
                Sign-in options are unavailable.
              </p>
            )}
          <div className="text-center text-xs text-muted-foreground/60">
            <p>
              {webDeploymentProfile.okForOAuth
                ? `${webDeploymentProfile.releaseVersion || webDeploymentProfile.displayName} · ${webDeploymentProfile.stage} · ${webDeploymentProfile.region}`
                : `Configuration incomplete for ${webDeploymentProfile.stage}`}
            </p>
            {webConfigBlocked && (
              <p className="mt-1 text-destructive">
                Missing {webDeploymentProfile.missing.join(", ")}
              </p>
            )}
          </div>
        </div>
      </section>
    </main>
  );

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

/** Only same-origin absolute paths may be used as a post-sign-in redirect. */
function normalizeNextPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) return undefined;
  return value;
}

function ProviderIcon({ icon }: { icon: PublicOAuthOption["icon"] }) {
  if (icon === "google") return <GoogleIcon />;
  return <MicrosoftIcon />;
}

function oauthProviderLabel(option: PublicOAuthOption): string {
  return option.label.replace(/^Continue with\s+/i, "");
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.97-.9 6.62-2.36l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.39 13.93A6 6 0 0 1 6.08 12c0-.67.11-1.32.31-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.55l3.35-2.62Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.94c1.47 0 2.8.51 3.84 1.5l2.86-2.87A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z"
      />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
      <path fill="#F25022" d="M2 2h9.5v9.5H2z" />
      <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" />
      <path fill="#00A4EF" d="M2 12.5h9.5V22H2z" />
      <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" />
    </svg>
  );
}
