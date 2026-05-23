import { useCallback, useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useMutation } from "urql";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  suggestTenantSlug,
  TenantSlugPicker,
  tenantSlugServerError,
} from "@/components/tenant/TenantSlugPicker";
import { useAuth } from "@/context/AuthContext";
import { useTenant } from "@/context/TenantContext";
import { getGoogleSignInUrl, rememberPostAuthRedirect } from "@/lib/auth";
import { RenameTenantSlugMutation } from "@/lib/graphql-queries";

// Unauthenticated route: landing page after Stripe Checkout success.
// Reads ?session_id={CHECKOUT_SESSION_ID} — Stripe substitutes it on the
// success_url. We don't verify the session ID here (that's the webhook's
// job); we just wait briefly for the webhook to pre-provision the tenant,
// then send the visitor into Cognito Hosted UI via Google.
//
// `bootstrapUser` on the other side matches the signed-in user's email
// against tenants.pending_owner_email and claims the paid tenant.

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

// 2.2 s matches typical webhook-arrival times for checkout.session.completed
// observed in Stripe's docs. A dedicated provisioning-status endpoint is a
// follow-up; this fixed delay is the smallest-delta first cut.
const WEBHOOK_WAIT_MS = 2200;

function WelcomePage() {
  const { session_id } = Route.useSearch();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { tenant, isLoading: tenantLoading, refetch } = useTenant();
  const [ready, setReady] = useState(false);
  const [slug, setSlug] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [renameResult, renameTenantSlug] = useMutation(
    RenameTenantSlugMutation,
  );

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
    // Kick Cognito Hosted UI with Google as the identity provider. On
    // successful sign-in, /auth/callback lands, exchanges the code, and
    // bootstrapUser claims the tenant by email.
    startGoogleSignIn();
  }, [ready, isAuthenticated, startGoogleSignIn]);

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
      navigate({ to: "/dashboard", replace: true });
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
    navigate({ to: "/dashboard", replace: true });
  }

  if (!session_id) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Hmm — that link is missing something.</CardTitle>
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
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Preparing your tenant...
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
                loading={renameResult.fetching}
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
            Finalizing your ThinkWork account…
          </CardTitle>
          <CardDescription>
            Payment confirmed. We're preparing your workspace — you'll be
            redirected to sign in with Google in a moment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Don't close this tab. If the redirect doesn't happen on its own
            within a few seconds, click below.
          </p>
          <div className="mt-6">
            <Button className="w-full" onClick={startGoogleSignIn}>
              Continue to sign in
            </Button>
          </div>
          <p className="text-muted-foreground mt-4 text-center text-xs">
            Session: <code className="font-mono">{session_id}</code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
