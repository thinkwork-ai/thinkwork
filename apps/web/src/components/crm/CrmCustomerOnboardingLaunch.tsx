import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertCircle, ArrowRight, ExternalLink, Loader2 } from "lucide-react";
import { useMutation } from "urql";
import { Button } from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { StartTwentyCustomerOnboardingMutation } from "@/lib/graphql-queries";

interface TwentyCustomerOnboardingLaunchProps {
  provider: string;
  objectType: string;
  objectId: string;
  workflowKey: string;
  search: {
    opportunityUrl?: string;
    opportunityName?: string;
    companyName?: string;
    outcomeKey?: string;
  };
}

interface StartTwentyCustomerOnboardingResult {
  startTwentyCustomerOnboarding?: {
    action: "CREATED" | "RESUMED";
    threadId: string;
    goalId?: string | null;
    pluginActivationRequired: boolean;
    statusWritebackState: string;
    missingFields: string[];
    thread: {
      id: string;
      title: string;
      spaceId?: string | null;
    };
    link: {
      id: string;
      statusHandleState: string;
      statusHandleUrl?: string | null;
      failureCode?: string | null;
      failureMessage?: string | null;
    };
  } | null;
}

export function TwentyCustomerOnboardingLaunch({
  provider,
  objectType,
  objectId,
  workflowKey,
  search,
}: TwentyCustomerOnboardingLaunchProps) {
  const { tenantId, isLoading } = useTenant();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] =
    useState<
      StartTwentyCustomerOnboardingResult["startTwentyCustomerOnboarding"]
    >(null);
  const [{ fetching }, startOnboarding] =
    useMutation<StartTwentyCustomerOnboardingResult>(
      StartTwentyCustomerOnboardingMutation,
    );

  const allowed =
    provider === "twenty" &&
    objectType === "opportunity" &&
    workflowKey === "customer_onboarding";
  const displayName =
    search.companyName || search.opportunityName || `Opportunity ${objectId}`;

  const recordSnapshot = useMemo(
    () => ({
      name: search.opportunityName ?? null,
      companyName: search.companyName ?? null,
      source: "twenty_launch_route",
    }),
    [search.companyName, search.opportunityName],
  );

  async function handleStart() {
    if (!tenantId || !allowed) return;
    setError(null);
    const response = await startOnboarding({
      input: {
        tenantId,
        opportunityId: objectId,
        opportunityUrl: search.opportunityUrl ?? null,
        opportunityName: search.opportunityName ?? null,
        companyName: search.companyName ?? null,
        outcomeKey: search.outcomeKey ?? null,
        startSeparateOutcome: Boolean(search.outcomeKey),
        recordSnapshot,
      },
    });
    if (response.error) {
      setError(response.error.message);
      return;
    }
    setResult(response.data?.startTwentyCustomerOnboarding ?? null);
  }

  if (!allowed) {
    return (
      <LaunchShell title="Unsupported CRM launch">
        <p className="text-sm text-muted-foreground">
          This launch link is outside the enabled Twenty Opportunity onboarding
          proof.
        </p>
      </LaunchShell>
    );
  }

  return (
    <LaunchShell title="Customer onboarding">
      <div className="space-y-5">
        <div className="rounded-lg border bg-background p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Twenty Opportunity
          </div>
          <div className="mt-2 text-lg font-semibold text-foreground">
            {displayName}
          </div>
          <div className="mt-1 break-all text-sm text-muted-foreground">
            {objectId}
          </div>
          {search.opportunityUrl ? (
            <a
              href={search.opportunityUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary"
            >
              Open in Twenty
              <ExternalLink className="size-4" />
            </a>
          ) : null}
        </div>

        {error ? (
          <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{friendlyError(error)}</span>
          </div>
        ) : null}

        {result ? (
          <div className="rounded-lg border bg-background p-4">
            <div className="text-sm font-medium">
              {result.action === "RESUMED"
                ? "Existing onboarding work found"
                : "Onboarding work started"}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {result.thread.title}
            </div>
            {result.link.failureMessage ? (
              <div className="mt-3 rounded-md bg-muted p-3 text-sm text-muted-foreground">
                {result.link.failureMessage}
              </div>
            ) : null}
            <Button asChild className="mt-4">
              <Link to="/threads/$id" params={{ id: result.threadId }}>
                Open Thread
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={handleStart}
              disabled={isLoading || !tenantId || fetching}
            >
              {fetching ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" />
              )}
              Start or resume
            </Button>
            <Button asChild type="button" variant="outline">
              <Link
                to="/settings/plugins/$pluginKey"
                params={{ pluginKey: "twenty" }}
              >
                Connect Twenty
              </Link>
            </Button>
          </div>
        )}
      </div>
    </LaunchShell>
  );
}

function LaunchShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-10">
      <div className="mb-6">
        <div className="text-sm font-medium text-muted-foreground">
          ThinkWork for Twenty
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-normal text-foreground">
          {title}
        </h1>
      </div>
      {children}
    </main>
  );
}

function friendlyError(message: string) {
  if (message.includes("PLUGIN_ACTIVATION_REQUIRED")) {
    return "Connect Twenty before starting new onboarding work from this record.";
  }
  if (message.includes("PLUGIN_INSTALL_REQUIRED")) {
    return "Install the Twenty plugin before using this launch handle.";
  }
  return message;
}
