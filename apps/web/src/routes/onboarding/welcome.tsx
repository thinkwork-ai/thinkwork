import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { gql, useMutation } from "urql";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@thinkwork/ui";
import {
  suggestTenantSlug,
  TenantSlugPicker,
  tenantSlugServerError,
} from "@/components/tenant/TenantSlugPicker";
import { useAuth } from "@/context/AuthContext";
import { useTenant } from "@/context/TenantContext";
import { getGoogleSignInUrl, rememberPostAuthRedirect } from "@/lib/auth";
import { SettingsRenameTenantSlugMutation } from "@/lib/settings-queries";

interface WelcomeSearch {
  session_id?: string;
}

export const Route = createFileRoute("/onboarding/welcome")({
  component: WelcomePage,
  validateSearch: (search: Record<string, unknown>): WelcomeSearch => ({
    session_id:
      typeof search.session_id === "string" ? search.session_id : undefined,
  }),
});

const WEBHOOK_WAIT_MS = 2200;

const BootstrapUserMutation = gql`
  mutation OnboardingBootstrapUser {
    bootstrapUser {
      tenant {
        id
        name
        slug
        plan
      }
    }
  }
`;

function WelcomePage() {
  const { session_id } = Route.useSearch();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { tenant, isLoading: tenantLoading, refetch } = useTenant();
  const [ready, setReady] = useState(false);
  const [slug, setSlug] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const bootstrapAttempted = useRef(false);
  const [renameResult, renameTenantSlug] = useMutation(
    SettingsRenameTenantSlugMutation,
  );
  const [bootstrapResult, bootstrapUser] = useMutation(BootstrapUserMutation);

  const startGoogleSignIn = useCallback(() => {
    rememberPostAuthRedirect(
      `${window.location.pathname}${window.location.search}`,
    );
    window.location.assign(getGoogleSignInUrl());
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), WEBHOOK_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!ready || isAuthenticated) return;
    startGoogleSignIn();
  }, [ready, isAuthenticated, startGoogleSignIn]);

  useEffect(() => {
    if (
      !ready ||
      !isAuthenticated ||
      tenantLoading ||
      tenant ||
      bootstrapAttempted.current
    ) {
      return;
    }

    bootstrapAttempted.current = true;
    void (async () => {
      const result = await bootstrapUser({});
      if (result.error) {
        setServerError(result.error.message);
        return;
      }
      await refetch();
    })();
  }, [
    bootstrapUser,
    isAuthenticated,
    ready,
    refetch,
    tenant,
    tenantLoading,
  ]);

  useEffect(() => {
    if (!tenant) return;
    setSlug((current) =>
      current ? current : suggestTenantSlug(tenant.name, tenant.slug),
    );
  }, [tenant]);

  async function submitSlug(nextSlug: string) {
    if (!tenant) return;
    setServerError(null);
    if (nextSlug === tenant.slug) {
      navigate({ to: "/new", search: { spaceId: undefined }, replace: true });
      return;
    }

    const result = await renameTenantSlug({
      tenantId: tenant.id,
      newSlug: nextSlug,
    });
    if (result.error) {
      const code = result.error.graphQLErrors?.[0]?.extensions?.code;
      setServerError(tenantSlugServerError(code, result.error.message));
      return;
    }
    await refetch();
    navigate({ to: "/new", search: { spaceId: undefined }, replace: true });
  }

  if (!session_id) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>That link is missing something.</CardTitle>
            <CardDescription>
              We couldn't find a checkout session in the URL. If you completed a
              payment, check your inbox for a receipt, or head back to plans to
              try again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <a href="https://thinkwork.ai/cloud">Return to plans</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Choose your tenant identifier</CardTitle>
            <CardDescription>
              This becomes your ThinkWork email subdomain.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tenantLoading || !tenant ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Preparing your tenant...
                </div>
                {serverError ? (
                  <p className="text-sm text-destructive">{serverError}</p>
                ) : null}
              </div>
            ) : (
              <TenantSlugPicker
                value={slug}
                onValueChange={(value) => {
                  setSlug(value);
                  setServerError(null);
                }}
                currentSlug={tenant.slug}
                serverError={serverError}
                loading={renameResult.fetching || bootstrapResult.fetching}
                submitLabel="Continue"
                onSubmit={submitSlug}
              />
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            Finalizing your ThinkWork account...
          </CardTitle>
          <CardDescription>
            Payment confirmed. We're preparing your workspace, then you'll sign
            in with Google.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Don't close this tab. If the redirect doesn't happen on its own
            within a few seconds, click below.
          </p>
          <div className="mt-6">
            <Button className="w-full" onClick={startGoogleSignIn}>
              Continue to sign in
            </Button>
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Session: <code className="font-mono">{session_id}</code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
