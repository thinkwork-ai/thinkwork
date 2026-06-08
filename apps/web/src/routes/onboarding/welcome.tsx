import {
  type FormEvent,
  type InputHTMLAttributes,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Circle, Loader2, RotateCcw } from "lucide-react";
import { gql, useMutation } from "urql";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@thinkwork/ui";
import {
  suggestTenantSlug,
  TenantSlugPicker,
  tenantSlugServerError,
} from "@/components/tenant/TenantSlugPicker";
import { useAuth } from "@/context/AuthContext";
import { useTenant } from "@/context/TenantContext";
import { getGoogleSignInUrl, rememberPostAuthRedirect } from "@/lib/auth";
import {
  createDeploymentSession,
  readDeploymentSession,
  requestDeploymentSessionTeardown,
  type DeploymentSession,
  type DeploymentSessionResume,
} from "@/lib/deployment-sessions";
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
const DEPLOYMENT_SESSION_STORAGE_KEY =
  "thinkwork:new-environment-deployment-session:v1";

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
    if (!session_id) return;
    const timer = window.setTimeout(() => setReady(true), WEBHOOK_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [session_id]);

  useEffect(() => {
    if (!session_id || !ready || isAuthenticated) return;
    startGoogleSignIn();
  }, [session_id, ready, isAuthenticated, startGoogleSignIn]);

  useEffect(() => {
    if (
      !session_id ||
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
    session_id,
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

  if (!session_id) return <NewEnvironmentInstaller />;

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

const INSTALL_STEPS = [
  { key: "intake", label: "Environment details" },
  { key: "connect_aws", label: "AWS connection" },
  { key: "foundation", label: "Foundation bootstrap" },
  { key: "deploy_stack", label: "ThinkWork stack" },
  { key: "first_admin", label: "First admin" },
  { key: "managed_apps", label: "Managed apps" },
  { key: "desktop_mobile", label: "Desktop and mobile profile" },
  { key: "teardown", label: "Teardown" },
] as const;

function NewEnvironmentInstaller() {
  const [session, setSession] = useState<DeploymentSession | null>(null);
  const [resume, setResume] = useState<DeploymentSessionResume | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingLabel, setLoadingLabel] = useState<string | null>(null);
  const [passwordDraft, setPasswordDraft] = useState("");

  useEffect(() => {
    const stored = readStoredResume();
    if (!stored) return;
    setResume(stored);
    setLoadingLabel("Resuming deployment session...");
    void readDeploymentSession(stored)
      .then(setSession)
      .catch(() => clearStoredResume())
      .finally(() => setLoadingLabel(null));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoadingLabel("Creating deployment session...");
    const form = new FormData(event.currentTarget);
    const availabilityZones = ["az1", "az2", "az3"]
      .map((key) => String(form.get(key) || "").trim())
      .filter(Boolean);

    try {
      const result = await createDeploymentSession({
        customerName: String(form.get("customerName") || ""),
        environmentName: String(form.get("environmentName") || ""),
        awsAccountId: String(form.get("awsAccountId") || ""),
        awsRegion: String(form.get("awsRegion") || ""),
        availabilityZones,
        adminName: String(form.get("adminName") || ""),
        adminEmail: String(form.get("adminEmail") || ""),
        source: isLocalDev() ? "local_dev" : "browser",
      });
      const nextResume = {
        sessionId: result.session.id,
        clientToken: result.clientToken,
      };
      storeResume(nextResume);
      setResume(nextResume);
      setPasswordDraft("");
      setSession(result.session);
    } catch (sessionError) {
      setError(
        sessionError instanceof Error
          ? sessionError.message
          : "Deployment session could not be created.",
      );
    } finally {
      setLoadingLabel(null);
    }
  }

  async function teardown() {
    if (!resume) return;
    setError(null);
    setLoadingLabel("Requesting teardown...");
    try {
      const nextSession = await requestDeploymentSessionTeardown(resume);
      setSession(nextSession);
    } catch (teardownError) {
      setError(
        teardownError instanceof Error
          ? teardownError.message
          : "Teardown could not be requested.",
      );
    } finally {
      setLoadingLabel(null);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-col gap-3 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              New environment
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Deploy ThinkWork
            </h1>
          </div>
          {session ? (
            <Button
              type="button"
              variant="outline"
              className="gap-2 self-start"
              onClick={() => void teardown()}
              disabled={Boolean(loadingLabel)}
            >
              {loadingLabel === "Requesting teardown..." ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RotateCcw className="h-4 w-4" aria-hidden />
              )}
              Teardown
            </Button>
          ) : null}
        </header>

        <div className="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-3">
            {INSTALL_STEPS.map((step) => (
              <TimelineStep
                key={step.key}
                label={step.label}
                state={stepState(step.key, session, loadingLabel)}
              />
            ))}
          </aside>

          <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
            {session ? (
              <SessionStatus
                session={session}
                loadingLabel={loadingLabel}
                error={error}
              />
            ) : (
              <form
                className="space-y-6"
                onSubmit={(event) => void submit(event)}
              >
                <div>
                  <h2 className="text-lg font-semibold">Environment details</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    State starts in the ThinkWork control plane. The browser
                    keeps only a resume token.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Company"
                    name="customerName"
                    placeholder="TEI"
                    required
                  />
                  <Field
                    label="Environment"
                    name="environmentName"
                    placeholder="tei-e2e"
                    required
                  />
                  <Field
                    label="AWS account ID"
                    name="awsAccountId"
                    placeholder="123456789012"
                    inputMode="numeric"
                    required
                  />
                  <Field
                    label="AWS region"
                    name="awsRegion"
                    placeholder="us-east-1"
                    required
                  />
                  <Field
                    label="Availability zone 1"
                    name="az1"
                    placeholder="us-east-1a"
                    required
                  />
                  <Field
                    label="Availability zone 2"
                    name="az2"
                    placeholder="us-east-1b"
                    required
                  />
                  <Field
                    label="Availability zone 3"
                    name="az3"
                    placeholder="us-east-1c"
                  />
                  <Field
                    label="First admin name"
                    name="adminName"
                    placeholder="Eric Odom"
                    required
                  />
                  <Field
                    label="First admin email"
                    name="adminEmail"
                    type="email"
                    placeholder="eric@example.com"
                    required
                  />
                  <div className="space-y-2">
                    <Label htmlFor="first-admin-password">
                      First admin password
                    </Label>
                    <Input
                      id="first-admin-password"
                      name="adminPassword"
                      type="password"
                      autoComplete="new-password"
                      value={passwordDraft}
                      onChange={(event) => setPasswordDraft(event.target.value)}
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Held only for this browser step.
                    </p>
                  </div>
                </div>

                {error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}

                <div className="flex items-center justify-end gap-3 border-t border-border pt-5">
                  {loadingLabel ? (
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      {loadingLabel}
                    </span>
                  ) : null}
                  <Button type="submit" disabled={Boolean(loadingLabel)}>
                    Create deployment session
                  </Button>
                </div>
              </form>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function SessionStatus({
  session,
  loadingLabel,
  error,
}: {
  session: DeploymentSession;
  loadingLabel: string | null;
  error: string | null;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{session.environmentName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {session.customerName} · {session.awsAccountId} ·{" "}
            {session.awsRegion}
          </p>
        </div>
        <span className="rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {session.status.replace(/_/g, " ")}
        </span>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2">
        <Fact
          label="Current step"
          value={labelForStep(session.currentStepKey)}
        />
        <Fact label="AWS connection" value={session.credentialsStatus} />
        <Fact label="Runner" value={session.runnerMode} />
        <Fact label="First admin" value={session.adminEmail} />
      </dl>

      {loadingLabel ? (
        <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {loadingLabel}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div>
        <h3 className="text-sm font-medium">Session events</h3>
        <div className="mt-3 divide-y divide-border rounded-md border border-border">
          {session.events.map((event) => (
            <div key={event.id} className="px-3 py-3">
              <p className="text-sm">{event.message}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(event.createdAt).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TimelineStep({
  label,
  state,
}: {
  label: string;
  state: "complete" | "active" | "loading" | "pending";
}) {
  const icon =
    state === "complete" ? (
      <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
    ) : state === "loading" ? (
      <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
    ) : (
      <Circle
        className={
          state === "active"
            ? "h-4 w-4 fill-primary text-primary"
            : "h-4 w-4 text-muted-foreground"
        }
        aria-hidden
      />
    );

  return (
    <div
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
        state === "active" || state === "loading"
          ? "bg-muted text-foreground"
          : "text-muted-foreground"
      }`}
    >
      {icon}
      <span>{label}</span>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  placeholder,
  inputMode,
  required,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  required?: boolean;
}) {
  const id = `new-environment-${name}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        placeholder={placeholder}
        inputMode={inputMode}
        required={required}
      />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium">{value}</dd>
    </div>
  );
}

function stepState(
  key: (typeof INSTALL_STEPS)[number]["key"],
  session: DeploymentSession | null,
  loadingLabel: string | null,
): "complete" | "active" | "loading" | "pending" {
  if (!session) {
    return key === "intake" && loadingLabel
      ? "loading"
      : key === "intake"
        ? "active"
        : "pending";
  }
  if (key === session.currentStepKey)
    return loadingLabel ? "loading" : "active";
  const currentIndex = INSTALL_STEPS.findIndex(
    (step) => step.key === session.currentStepKey,
  );
  const stepIndex = INSTALL_STEPS.findIndex((step) => step.key === key);
  return stepIndex < currentIndex ? "complete" : "pending";
}

function labelForStep(key: string): string {
  return INSTALL_STEPS.find((step) => step.key === key)?.label ?? key;
}

function readStoredResume(): DeploymentSessionResume | null {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(DEPLOYMENT_SESSION_STORAGE_KEY) || "null",
    ) as Partial<DeploymentSessionResume> | null;
    if (!parsed?.sessionId || !parsed.clientToken) return null;
    return {
      sessionId: parsed.sessionId,
      clientToken: parsed.clientToken,
    };
  } catch {
    return null;
  }
}

function storeResume(resume: DeploymentSessionResume) {
  localStorage.setItem(DEPLOYMENT_SESSION_STORAGE_KEY, JSON.stringify(resume));
}

function clearStoredResume() {
  localStorage.removeItem(DEPLOYMENT_SESSION_STORAGE_KEY);
}

function isLocalDev(): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}
