import { useEffect, useState } from "react";
import { Button } from "@thinkwork/ui";

import { apiFetch } from "@/lib/api-fetch";
import {
  getAuthOptionIdentityMigrationUrl,
  type IdentityMigrationGrant,
} from "@/lib/auth";
import {
  fetchPublicAuthOptions,
  type PublicOAuthOption,
} from "@/lib/auth-options";
import { isDesktopBuild } from "@/lib/desktop-runtime";

const DISMISSED_KEY = "thinkwork:native-identity-migration-dismissed";

interface AuthMeMigrationState {
  migrationRequired?: boolean;
  migrationRecoveryDeadline?: string | null;
}

interface IssuedMigrationGrant extends IdentityMigrationGrant {
  expiresAt: string;
  routeKeys: string[];
}

export function NativeIdentityMigrationPrompt() {
  const [state, setState] = useState<AuthMeMigrationState | null>(null);
  const [options, setOptions] = useState<PublicOAuthOption[]>([]);
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(DISMISSED_KEY) === "true",
  );
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isDesktopBuild()) return;
    let cancelled = false;
    void Promise.all([
      apiFetch<AuthMeMigrationState>("/api/auth/me"),
      fetchPublicAuthOptions(),
    ])
      .then(([authMe, authOptions]) => {
        if (cancelled) return;
        setState(authMe);
        setOptions(authOptions.oauthOptions);
      })
      .catch(() => {
        // A transient discovery failure must not block the authenticated app.
        // The prompt is retried on the next full page load.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isDesktopBuild() || !state?.migrationRequired || dismissed) return null;

  const deadline = state.migrationRecoveryDeadline
    ? Date.parse(state.migrationRecoveryDeadline)
    : Number.NaN;
  const canDefer = !Number.isFinite(deadline) || Date.now() < deadline;

  async function startMigration(option: PublicOAuthOption) {
    setError(null);
    setStarting(option.key);
    try {
      const redirectUri = `${window.location.origin}/auth/callback`;
      const grant = await apiFetch<IssuedMigrationGrant>(
        "/api/auth/enrollment/migrate",
        {
          method: "POST",
          body: JSON.stringify({ redirectUri }),
        },
      );
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.href = await getAuthOptionIdentityMigrationUrl(
        option,
        grant,
        next,
      );
    } catch (migrationError) {
      setError(
        migrationError instanceof Error
          ? migrationError.message
          : "Identity migration could not be started.",
      );
      setStarting(null);
    }
  }

  function deferMigration() {
    sessionStorage.setItem(DISMISSED_KEY, "true");
    setDismissed(true);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 px-6 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="native-identity-migration-title"
        className="flex w-full max-w-md flex-col gap-5 rounded-xl border bg-card p-6 text-card-foreground shadow-2xl"
      >
        <div className="space-y-2 text-center">
          <h2
            id="native-identity-migration-title"
            className="text-xl font-semibold tracking-tight"
          >
            Secure your ThinkWork sign-in
          </h2>
          <p className="text-sm text-muted-foreground">
            Choose Google or Microsoft once to move this account to ThinkWork&apos;s
            AWS-native sign-in. Your workspace and data stay the same.
          </p>
        </div>
        {error ? (
          <p role="alert" className="text-center text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {options.map((option) => (
            <Button
              key={option.key}
              type="button"
              variant="outline"
              disabled={starting !== null}
              onClick={() => void startMigration(option)}
            >
              {starting === option.key ? "Opening..." : providerLabel(option)}
            </Button>
          ))}
        </div>
        {options.length === 0 ? (
          <p role="alert" className="text-center text-sm text-destructive">
            Native sign-in options are temporarily unavailable. You can keep
            working and try again after reloading.
          </p>
        ) : null}
        {canDefer ? (
          <Button type="button" variant="ghost" onClick={deferMigration}>
            Later
          </Button>
        ) : (
          <p className="text-center text-xs text-muted-foreground">
            This sign-in update is required before you continue.
          </p>
        )}
      </section>
    </div>
  );
}

function providerLabel(option: PublicOAuthOption): string {
  return option.provider === "google" ? "Google" : "Microsoft";
}
