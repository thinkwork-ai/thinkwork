import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  Button,
  Input,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  useTheme,
  type Theme,
} from "@thinkwork/ui";
import {
  EmailChannelProvider,
  EmailProviderInstallStatus,
} from "@/gql/graphql";
import { useTenant } from "@/context/TenantContext";
import {
  EDITOR_FONT_SIZES,
  setEditorFontSize,
  setEditorWrap,
  useEditorFontSize,
  useEditorWrap,
} from "@/lib/editor-prefs";
import {
  SettingsTenantFeaturesQuery,
  SettingsUpdateTenantBrandingMutation,
  SettingsDeploymentReleasesQuery,
  SettingsDeploymentStatusQuery,
  SettingsConfigureEmailProviderMutation,
  SettingsEmailChannelQuery,
  SettingsReleaseUpdateJobQuery,
  SettingsRemediateReleaseRunnerMutation,
  SettingsStartDeploymentReleaseUpdateMutation,
  SettingsStartReleaseUpdatePreflightMutation,
} from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsPane,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import { SetUpMobileCard } from "@/components/settings/SetUpMobileCard";
import {
  brandingFromFeatures,
  normalizeFeatures,
  DEFAULT_HEADER_TEXT,
  DEFAULT_LOGO_HEIGHT_PX,
  LOGO_SIZE_OPTIONS,
  MAX_HEADER_TEXT_LENGTH,
  MAX_LOGO_BYTES,
  type TenantBranding,
} from "@/lib/tenant-branding";

export function SettingsGeneral() {
  const { isOperator, roleResolved } = useTenant();

  // Operators only — members never issue the deployment query (it is also
  // gated server-side in U8).
  const showOperator = roleResolved && isOperator;
  const [deployResult, refreshDeploymentStatus] = useQuery({
    query: SettingsDeploymentStatusQuery,
    pause: !showOperator,
  });
  const [emailResult, refreshEmailProviders] = useQuery({
    query: SettingsEmailChannelQuery,
    pause: !showOperator,
    requestPolicy: "cache-and-network",
  });

  const deployment = deployResult.data?.deploymentStatus;
  const deploymentFailed = showOperator && !!deployResult.error;

  return (
    <SettingsPane>
      <SettingsHeader
        title="General"
        description="Configure appearance, notifications, deployment, and app metadata."
      />

      <SettingsSection label="Appearance">
        <ThemeRow />
        <EditorFontSizeRow />
        <EditorWrapRow />
        {showOperator ? <BrandingRows /> : null}
      </SettingsSection>

      {showOperator ? (
        <>
          <SettingsSection label="Deployment">
            {deploymentFailed ? (
              <div className="p-4 text-sm text-muted-foreground">
                Deployment status unavailable.
              </div>
            ) : (
              <>
                <SettingsRow
                  label="Deployed release"
                  description="The ThinkWork platform release currently selected for this environment."
                >
                  <MonoValue value={deployment?.releaseVersion} />
                </SettingsRow>
                <SettingsRow
                  label="Manifest SHA"
                  description="Release manifest digest for the deployed platform version."
                >
                  <MonoValue value={deployment?.releaseManifestSha256} />
                </SettingsRow>
                <SettingsRow
                  label="Stage"
                  description="Deployment stage this console is connected to."
                >
                  {deployment?.stage ?? "…"}
                </SettingsRow>
                <SettingsRow
                  label="Region"
                  description="AWS region hosting this deployment."
                >
                  {deployment?.region ?? "…"}
                </SettingsRow>
                <SettingsRow
                  label="Account"
                  description="AWS account ID hosting this deployment."
                >
                  {deployment?.accountId ?? "…"}
                </SettingsRow>
                <SettingsRow
                  label="AgentCore"
                  description="Bedrock AgentCore runtime status."
                >
                  {deployment?.agentcoreStatus ?? "…"}
                </SettingsRow>
              </>
            )}
          </SettingsSection>

          <SetUpMobileCard />

          {!deploymentFailed ? (
            <SettingsSection label="Resources & URLs">
              <EmailProviderRow
                summary={emailResult.data?.emailChannelSummary}
                onRefresh={() =>
                  refreshEmailProviders({ requestPolicy: "network-only" })
                }
              />
              <ResourceRow
                label="S3 bucket"
                description="Workspace and artifact storage bucket."
                value={deployment?.bucketName}
              />
              <ResourceRow
                label="Database"
                description="Aurora Postgres cluster endpoint."
                value={deployment?.databaseEndpoint}
              />
              <ResourceRow
                label="ECR"
                description="Container image registry for agent runtimes."
                value={deployment?.ecrUrl}
              />
              <ResourceRow
                label="API"
                description="GraphQL HTTP API endpoint."
                value={deployment?.apiEndpoint}
              />
              <ResourceRow
                label="AppSync"
                description="Realtime subscriptions endpoint."
                value={deployment?.appsyncUrl}
              />
              <ResourceRow
                label="Controller"
                description="Deployment controller state machine."
                value={deployment?.deploymentControllerArn}
              />
              <ResourceRow
                label="Runner"
                description="CodeBuild project that applies release updates."
                value={deployment?.deploymentRunnerProjectName}
              />
              <ResourceRow
                label="Evidence bucket"
                description="Deployment run evidence and status storage."
                value={deployment?.deploymentEvidenceBucket}
              />
            </SettingsSection>
          ) : null}

          <DeploymentReleasesSection
            enabled={showOperator}
            currentReleaseVersion={deployment?.releaseVersion}
            onRefreshDeploymentStatus={() =>
              refreshDeploymentStatus({ requestPolicy: "network-only" })
            }
          />
        </>
      ) : (
        <SetUpMobileCard />
      )}
    </SettingsPane>
  );
}

function EmailProviderRow({
  summary,
  onRefresh,
}: {
  summary?: {
    providers?: Array<{
      id: string;
      provider: string;
      displayName?: string | null;
      status: string;
      activeForProduction: boolean;
      credentialConfigured: boolean;
      defaultFromEmail?: string | null;
      metadata?: string | null;
      updatedAt?: string | null;
    }>;
  } | null;
  onRefresh: () => void;
}) {
  const [, configureProvider] = useMutation(
    SettingsConfigureEmailProviderMutation,
  );
  const providers = summary?.providers ?? [];
  const activeProvider = providers.find((provider) =>
    Boolean(provider.activeForProduction),
  );
  const selectedProvider = activeProvider?.provider ?? "SES";
  const availableProviderOptions = providers.filter(
    (provider) => provider.provider !== "SES" && provider.status === "READY",
  );

  async function selectProvider(provider: string) {
    if (provider === "SES") {
      const response = await configureProvider({
        input: {
          provider: EmailChannelProvider.Ses,
          displayName: "SES",
          activeForProduction: true,
          status: EmailProviderInstallStatus.Ready,
        },
      });
      if (response.error) {
        toast.error(`Could not select SES: ${response.error.message}`);
        return;
      }
      toast.success("SES selected for invitations.");
      onRefresh();
      return;
    }
    const providerRow = availableProviderOptions.find(
      (option) => option.provider === provider,
    );
    if (!providerRow) {
      toast.error(`${providerLabel(provider)} is not available.`);
      return;
    }
    const response = await configureProvider({
      input: {
        providerInstallId: providerRow.id,
        provider: emailProviderEnum(provider),
        displayName: providerLabel(provider),
        status: EmailProviderInstallStatus.Ready,
        activeForProduction: true,
        defaultFromEmail: providerRow.defaultFromEmail,
        metadata: providerRow.metadata,
      },
    });
    if (response.error) {
      toast.error(
        `Could not select ${providerLabel(provider)}: ${response.error.message}`,
      );
      return;
    }
    toast.success(`${providerLabel(provider)} selected for invitations.`);
    onRefresh();
  }

  return (
    <SettingsRow
      label="Email Provider"
      description="Email service used for tenant member invitations."
    >
      <Select value={selectedProvider} onValueChange={selectProvider}>
        <SelectTrigger aria-label="Email provider" className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="SES">SES</SelectItem>
          {availableProviderOptions.map((provider) => (
            <SelectItem key={provider.id} value={provider.provider}>
              {provider.displayName ?? providerLabel(provider.provider)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
}

function providerLabel(provider: string) {
  if (provider === "SENDGRID") return "SendGrid";
  if (provider === "RESEND") return "Resend";
  return "SES";
}

function emailProviderEnum(provider: string) {
  if (provider === "SENDGRID") return EmailChannelProvider.Sendgrid;
  if (provider === "RESEND") return EmailChannelProvider.Resend;
  return EmailChannelProvider.Ses;
}

interface DeploymentReleaseRow {
  version: string;
  name?: string | null;
  prerelease: boolean;
  draft: boolean;
  publishedAt?: string | null;
  htmlUrl: string;
  manifestUrl: string;
  manifestSha256: string;
  signatureUrl?: string | null;
  signed: boolean;
  deployable: boolean;
}

interface ReleaseUpdateJobRow {
  id: string;
  status: string;
  targetReleaseVersion: string;
  currentReleaseVersion?: string | null;
  manifestSha256: string;
  manifestSigned: boolean;
  manifestTrustPolicy?: string | null;
  terraformModuleVersion?: string | null;
  preflightSummary: Record<string, unknown>;
  preservedConfigSummary: Record<string, unknown>;
  remediationSummary: Record<string, unknown>;
  executionArn?: string | null;
  stateMachineArn?: string | null;
  codebuildBuildArn?: string | null;
  evidenceBucket?: string | null;
  evidencePrefix?: string | null;
  statusPointerBucket?: string | null;
  statusPointerKey?: string | null;
  finalStatus: Record<string, unknown>;
  failureCategory?: string | null;
  failureMessage?: string | null;
  recoveryAction?: string | null;
  events?: Array<{
    id: string;
    eventType: string;
    message: string;
    payload: Record<string, unknown>;
    createdAt?: string | null;
  }>;
}

interface ReleaseWorkflowState {
  release: DeploymentReleaseRow;
  job?: ReleaseUpdateJobRow | null;
  message?: string | null;
  error?: string | null;
}

function DeploymentReleasesSection({
  enabled,
  currentReleaseVersion,
  onRefreshDeploymentStatus,
}: {
  enabled: boolean;
  currentReleaseVersion?: string | null;
  onRefreshDeploymentStatus?: () => void;
}) {
  const [selectedRelease, setSelectedRelease] =
    useState<DeploymentReleaseRow | null>(null);
  const [workflow, setWorkflow] = useState<ReleaseWorkflowState | null>(null);
  const [result] = useQuery({
    query: SettingsDeploymentReleasesQuery,
    variables: { limit: 5 },
    pause: !enabled,
  });
  const [preflightState, startPreflight] = useMutation(
    SettingsStartReleaseUpdatePreflightMutation,
  );
  const [runnerState, remediateRunner] = useMutation(
    SettingsRemediateReleaseRunnerMutation,
  );
  const [dispatchState, startReleaseUpdate] = useMutation(
    SettingsStartDeploymentReleaseUpdateMutation,
  );
  const jobId = workflow?.job?.id ?? "";
  const [jobResult, refreshReleaseJob] = useQuery({
    query: SettingsReleaseUpdateJobQuery,
    variables: { jobId },
    pause: !jobId,
    requestPolicy: "network-only",
  });
  const releases = (result.data?.deploymentReleases ??
    []) as DeploymentReleaseRow[];
  const polledJob =
    (jobResult.data?.releaseUpdateJob as ReleaseUpdateJobRow | null) ?? null;
  const activeJob = polledJob ?? workflow?.job ?? null;
  const deploymentCompleted =
    activeJob?.status === "succeeded" &&
    activeJob.targetReleaseVersion === currentReleaseVersion;
  const deploymentBusy =
    preflightState.fetching || runnerState.fetching || dispatchState.fetching;

  useEffect(() => {
    if (!activeJob || activeJob.status !== "updating") {
      return;
    }
    const interval = window.setInterval(() => {
      refreshReleaseJob({ requestPolicy: "network-only" });
      onRefreshDeploymentStatus?.();
    }, 8000);
    return () => window.clearInterval(interval);
  }, [
    activeJob?.id,
    activeJob?.status,
    onRefreshDeploymentStatus,
    refreshReleaseJob,
  ]);

  async function beginPreflight(release: DeploymentReleaseRow) {
    setSelectedRelease(null);
    setWorkflow({
      release,
      message: "Running release preflight.",
      error: null,
    });
    const response = await startPreflight({
      input: {
        version: release.version,
        manifestUrl: release.manifestUrl,
        manifestSha256: release.manifestSha256,
        signatureUrl: release.signatureUrl,
        signed: release.signed,
        idempotencyKey: `settings-release-preflight-${release.version}`,
      },
    });
    if (response.error) {
      const message = response.error.message;
      setWorkflow({ release, error: message });
      toast.error("Release preflight failed", { description: message });
      return;
    }
    const job = response.data
      ?.startReleaseUpdatePreflight as ReleaseUpdateJobRow | null;
    if (!job) {
      const message = "The deployment API returned no preflight job.";
      setWorkflow({ release, error: message });
      toast.error("Release preflight failed", { description: message });
      return;
    }
    setWorkflow({
      release,
      job,
      message: releaseJobMessage(job),
      error: null,
    });
    if (hasBlockers(job)) {
      toast.message("Release preflight needs attention", {
        description: releaseJobMessage(job),
      });
      return;
    }
    toast.success("Release preflight passed", {
      description: releaseJobMessage(job),
    });
  }

  async function refreshRunner(job: ReleaseUpdateJobRow) {
    if (!workflow) return;
    const response = await remediateRunner({
      input: {
        jobId: job.id,
        idempotencyKey: `settings-release-runner-${job.id}`,
      },
    });
    if (response.error) {
      const message = response.error.message;
      setWorkflow({ ...workflow, job, error: message });
      toast.error("Runner refresh failed", { description: message });
      return;
    }
    const updated = response.data
      ?.remediateReleaseRunner as ReleaseUpdateJobRow | null;
    if (!updated) return;
    setWorkflow({
      ...workflow,
      job: updated,
      message: releaseJobMessage(updated),
      error: null,
    });
    toast.success("Runner refreshed", {
      description: releaseJobMessage(updated),
    });
  }

  async function dispatchUpdate(job: ReleaseUpdateJobRow) {
    if (!workflow) return;
    const response = await startReleaseUpdate({
      input: {
        jobId: job.id,
        idempotencyKey: `settings-release-dispatch-${job.id}`,
      },
    });
    if (response.error) {
      const message = response.error.message;
      setWorkflow({ ...workflow, job, error: message });
      toast.error("Release dispatch failed", { description: message });
      return;
    }
    const updated = response.data
      ?.startDeploymentReleaseUpdate as ReleaseUpdateJobRow | null;
    if (!updated) return;
    setWorkflow({
      ...workflow,
      job: updated,
      message: releaseJobMessage(updated),
      error: null,
    });
    onRefreshDeploymentStatus?.();
    toast.success("Release update started", {
      description: releaseJobMessage(updated),
    });
  }

  return (
    <SettingsSection label="Releases">
      {result.fetching ? (
        <div className="p-4 text-sm text-muted-foreground">
          Loading releases…
        </div>
      ) : result.error ? (
        <div className="p-4 text-sm text-muted-foreground">
          Releases unavailable.
        </div>
      ) : releases.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">
          No deployable release manifests found.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {releases.map((release) => (
            <ReleaseRow key={release.version} release={release}>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedRelease(release)}
                disabled={!release.deployable || deploymentBusy}
              >
                Review
              </Button>
            </ReleaseRow>
          ))}
        </div>
      )}

      {workflow ? (
        <ReleaseWorkflowPanel
          release={workflow.release}
          job={activeJob}
          busy={deploymentBusy || jobResult.fetching}
          completed={deploymentCompleted}
          message={workflow.error ?? workflow.message}
          error={workflow.error}
          onRunPreflight={() => beginPreflight(workflow.release)}
          onRefreshRunner={
            activeJob ? () => refreshRunner(activeJob) : undefined
          }
          onDispatch={activeJob ? () => dispatchUpdate(activeJob) : undefined}
          onClose={() => setWorkflow(null)}
        />
      ) : null}

      <Dialog
        open={Boolean(selectedRelease)}
        onOpenChange={(open) => {
          if (!open) setSelectedRelease(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Review release?</DialogTitle>
            <DialogDescription>
              Run preflight before dispatching this ThinkWork environment.
            </DialogDescription>
          </DialogHeader>
          {selectedRelease ? (
            <div className="space-y-3 text-sm">
              <ConfirmFact label="Release" value={selectedRelease.version} />
              <ConfirmFact
                label="Manifest"
                value={selectedRelease.manifestUrl}
              />
              <ConfirmFact
                label="SHA-256"
                value={selectedRelease.manifestSha256}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setSelectedRelease(null)}
              disabled={deploymentBusy}
            >
              Cancel
            </Button>
            <Button
              onClick={() => selectedRelease && beginPreflight(selectedRelease)}
              disabled={deploymentBusy}
            >
              {deploymentBusy ? "Checking…" : "Run Preflight"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}

function ReleaseWorkflowPanel({
  release,
  job,
  busy,
  completed,
  message,
  error,
  onRunPreflight,
  onRefreshRunner,
  onDispatch,
  onClose,
}: {
  release: DeploymentReleaseRow;
  job: ReleaseUpdateJobRow | null;
  busy: boolean;
  completed: boolean;
  message?: string | null;
  error?: string | null;
  onRunPreflight: () => void;
  onRefreshRunner?: () => void;
  onDispatch?: () => void;
  onClose: () => void;
}) {
  const steps = useMemo(
    () => releaseSteps(job, busy, completed),
    [busy, completed, job],
  );
  const title = releaseWorkflowTitle(job, busy, completed);
  const blockers = blockersFor(job);
  const warnings = warningsFor(job);
  const runner = objectValue(objectValue(job?.preflightSummary).runner);
  const iam = objectValue(objectValue(job?.preflightSummary).iam);
  const preserved = objectValue(
    objectValue(job?.preservedConfigSummary).fields,
  );
  const runnerRefresh = objectValue(
    objectValue(job?.remediationSummary).runnerRefresh,
  );
  const canRefreshRunner =
    runnerRefresh.required === true && Boolean(onRefreshRunner);
  const canDispatch = Boolean(job && isDispatchable(job) && onDispatch);

  return (
    <div
      className="border-t border-border p-4 text-sm"
      role="status"
      aria-live="polite"
    >
      <div className="mb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="font-medium">{title}</div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <div
          className={
            error || job?.status === "failed"
              ? "text-destructive"
              : "text-muted-foreground"
          }
        >
          {message ?? releaseJobMessage(job)}
        </div>
      </div>

      <div className="mb-4 grid gap-2">
        {steps.map((step) => (
          <DeploymentStep
            key={step.label}
            label={step.label}
            state={step.state}
          />
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ConfirmFact
          label="Current release"
          value={job?.currentReleaseVersion ?? "unknown"}
        />
        <ConfirmFact label="Target release" value={release.version} />
        <ConfirmFact label="Manifest SHA" value={release.manifestSha256} />
        <ConfirmFact
          label="Manifest trust"
          value={
            job
              ? `${job.manifestSigned ? "signed" : "unsigned"} · ${
                  job.manifestTrustPolicy ?? "default"
                }`
              : release.signed
                ? "signed"
                : "unsigned"
          }
        />
        <ConfirmFact
          label="Runner"
          value={runnerStatusText(runner, runnerRefresh)}
        />
        <ConfirmFact label="IAM" value={stringValue(iam.status) || "pending"} />
        <ConfirmFact
          label="Customer domain"
          value={stringValue(preserved.customerDomain) || "none"}
        />
        <ConfirmFact label="Domain flags" value={domainFlagsText(preserved)} />
        <ConfirmFact label="SES sender" value={sesSenderText(preserved)} />
        <ConfirmFact
          label="Operators"
          value={stringValue(preserved.platformOperatorEmails) || "unknown"}
        />
        <ConfirmFact
          label="OAuth"
          value={
            preserved.googleOauthClientIdConfigured === true
              ? "configured"
              : "not configured"
          }
        />
        <ConfirmFact
          label="Optional apps"
          value={optionalAppsText(objectValue(preserved.optionalApps))}
        />
        <ConfirmFact label="Execution" value={job?.executionArn ?? "pending"} />
        <ConfirmFact
          label="CodeBuild"
          value={job?.codebuildBuildArn ?? "pending"}
        />
        <ConfirmFact label="Evidence" value={evidenceText(job)} />
        <ConfirmFact label="Status pointer" value={statusPointerText(job)} />
      </div>

      {blockers.length > 0 ? (
        <ReleaseNotice
          tone="danger"
          title="Blocking checks"
          items={blockers.map(blockerText)}
        />
      ) : null}

      {warnings.length > 0 ? (
        <ReleaseNotice
          tone="warning"
          title="Warnings"
          items={warnings.map(blockerText)}
        />
      ) : null}

      {job?.failureMessage ? (
        <ReleaseNotice
          tone="danger"
          title="Failure"
          items={[
            job.failureMessage,
            job.recoveryAction ?? "Review deployment evidence before retrying.",
          ]}
        />
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!job || job.status === "failed" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onRunPreflight}
            disabled={busy}
          >
            Run Preflight
          </Button>
        ) : null}
        {canRefreshRunner ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onRefreshRunner}
            disabled={busy}
          >
            Refresh Runner
          </Button>
        ) : null}
        {canDispatch ? (
          <Button size="sm" onClick={onDispatch} disabled={busy}>
            Start Update
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function releaseSteps(
  job: ReleaseUpdateJobRow | null,
  busy: boolean,
  completed: boolean,
) {
  if (!job) {
    return [
      {
        label: "Run preflight",
        state: busy ? ("active" as const) : ("pending" as const),
      },
      { label: "Review checks", state: "pending" as const },
      { label: "Start controller", state: "pending" as const },
      { label: "Record evidence", state: "pending" as const },
    ];
  }
  if (job.status === "failed") {
    return [
      { label: "Run preflight", state: "complete" as const },
      { label: "Review checks", state: "complete" as const },
      { label: "Start controller", state: "failed" as const },
      { label: "Record evidence", state: "pending" as const },
    ];
  }
  return [
    { label: "Run preflight", state: "complete" as const },
    {
      label: "Review checks",
      state: hasBlockers(job) ? ("failed" as const) : ("complete" as const),
    },
    {
      label: "Start controller",
      state:
        job.status === "updating"
          ? ("active" as const)
          : job.executionArn
            ? ("complete" as const)
            : ("pending" as const),
    },
    {
      label: "Record evidence",
      state: completed ? ("complete" as const) : ("pending" as const),
    },
  ];
}

function releaseWorkflowTitle(
  job: ReleaseUpdateJobRow | null,
  busy: boolean,
  completed: boolean,
): string {
  if (completed) return "Release update completed";
  if (!job) return busy ? "Running release preflight" : "Release preflight";
  if (job.status === "updating") return "Deployment controller running";
  if (job.status === "failed") return "Release update failed";
  if (hasBlockers(job)) return "Release checks need attention";
  return "Release ready for dispatch";
}

function ReleaseNotice({
  tone,
  title,
  items,
}: {
  tone: "danger" | "warning";
  title: string;
  items: string[];
}) {
  const color =
    tone === "danger"
      ? "border-destructive/40 text-destructive"
      : "border-amber-500/40 text-amber-700 dark:text-amber-300";
  return (
    <div className={`mt-4 rounded-lg border p-3 ${color}`}>
      <div className="text-sm font-medium">{title}</div>
      <ul className="mt-2 space-y-1 text-sm">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function releaseJobMessage(job: ReleaseUpdateJobRow | null): string {
  if (!job) return "Run release preflight.";
  if (job.status === "preflight_ready") {
    return `Preflight passed for ${job.targetReleaseVersion}.`;
  }
  if (job.status === "runner_remediated") {
    return "Runner refresh completed; release is ready for dispatch.";
  }
  if (job.status === "preflight_blocked") {
    return job.recoveryAction ?? "Resolve blocking checks before dispatch.";
  }
  if (job.status === "updating") {
    return "Deployment controller accepted the reviewed release update.";
  }
  if (job.status === "succeeded") {
    return `Release update completed for ${job.targetReleaseVersion}.`;
  }
  if (job.status === "failed") {
    return job.failureMessage ?? "Deployment controller reported a failure.";
  }
  return job.status;
}

function isDispatchable(job: ReleaseUpdateJobRow): boolean {
  return (
    (job.status === "preflight_ready" || job.status === "runner_remediated") &&
    !hasBlockers(job)
  );
}

function hasBlockers(job: ReleaseUpdateJobRow): boolean {
  return blockersFor(job).length > 0;
}

function blockersFor(
  job: ReleaseUpdateJobRow | null,
): Record<string, unknown>[] {
  if (!job) return [];
  const preflight = objectValue(job.preflightSummary);
  if (Array.isArray(preflight.blockers)) {
    return preflight.blockers.filter(isRecord);
  }
  return [];
}

function warningsFor(
  job: ReleaseUpdateJobRow | null,
): Record<string, unknown>[] {
  if (!job) return [];
  const preflight = objectValue(job.preflightSummary);
  if (Array.isArray(preflight.warnings)) {
    return preflight.warnings.filter(isRecord);
  }
  return [];
}

function blockerText(blocker: Record<string, unknown>): string {
  const message = stringValue(blocker.message);
  const category = stringValue(blocker.category);
  const recovery = stringValue(blocker.recoveryAction);
  return [message || category || "Check failed", recovery]
    .filter(Boolean)
    .join(" ");
}

function runnerStatusText(
  runner: Record<string, unknown>,
  runnerRefresh: Record<string, unknown>,
): string {
  if (runnerRefresh.completed === true) return "refreshed";
  if (runnerRefresh.required === true) return "refresh required";
  return stringValue(runner.status) || "pending";
}

function domainFlagsText(fields: Record<string, unknown>): string {
  return [
    fields.customerDomainDelegated === true ? "delegated" : "not delegated",
    fields.customerDomainLegacyRetired === true
      ? "legacy retired"
      : "legacy active",
  ].join(" · ");
}

function sesSenderText(fields: Record<string, unknown>): string {
  const ses = objectValue(fields.sesSender);
  return (
    stringValue(ses.cognitoFromEmailAddress) ||
    stringValue(ses.cognitoEmailSourceArn) ||
    "default"
  );
}

function optionalAppsText(optionalApps: Record<string, unknown>): string {
  const enabled = [optionalApps.twenty === true ? "twenty" : null].filter(
    Boolean,
  );
  return enabled.length ? enabled.join(", ") : "none";
}

function evidenceText(job: ReleaseUpdateJobRow | null): string {
  if (!job?.evidencePrefix) return "pending";
  return job.evidenceBucket
    ? `${job.evidenceBucket}/${job.evidencePrefix}`
    : job.evidencePrefix;
}

function statusPointerText(job: ReleaseUpdateJobRow | null): string {
  if (!job?.statusPointerBucket || !job.statusPointerKey) return "pending";
  return `${job.statusPointerBucket}/${job.statusPointerKey}`;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function DeploymentStep({
  label,
  state,
}: {
  label: string;
  state: "active" | "complete" | "failed" | "pending";
}) {
  const marker =
    state === "complete"
      ? "bg-emerald-500"
      : state === "failed"
        ? "bg-destructive"
        : state === "active"
          ? "bg-blue-500"
          : "bg-muted";
  const text =
    state === "pending" ? "text-muted-foreground" : "text-foreground";

  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${marker}`} />
      <span className={`text-xs ${text}`}>{label}</span>
      {state === "active" ? (
        <span className="text-xs text-muted-foreground">in progress</span>
      ) : null}
      {state === "failed" ? (
        <span className="text-xs text-destructive">failed</span>
      ) : null}
    </div>
  );
}

function ReleaseRow({
  release,
  children,
}: {
  release: DeploymentReleaseRow;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{release.version}</p>
        <p className="mt-0.5 whitespace-nowrap text-sm text-muted-foreground">
          {releaseDescription(release)}
        </p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function releaseDescription(release: DeploymentReleaseRow): string {
  const parts = [
    release.signed ? "signed manifest" : "unsigned canary",
    release.publishedAt ? new Date(release.publishedAt).toLocaleString() : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function ConfirmFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="break-all font-mono text-xs">{value}</div>
    </div>
  );
}

function MonoValue({ value }: { value?: string | null }) {
  return (
    <span className="max-w-[22rem] truncate font-mono text-xs">
      {value ?? "—"}
    </span>
  );
}

function ResourceRow({
  label,
  description,
  value,
}: {
  label: string;
  description?: string;
  value?: string | null;
}) {
  return (
    <SettingsRow label={label} description={description}>
      <span className="max-w-[22rem] truncate font-mono text-xs">
        {value ?? "—"}
      </span>
    </SettingsRow>
  );
}

function EditorWrapRow() {
  const wrap = useEditorWrap();
  return (
    <SettingsRow
      label="Editor Wrap Text"
      description="Soft-wrap long lines in the workspace editor."
    >
      <Switch
        checked={wrap}
        onCheckedChange={(next) => setEditorWrap(next)}
        aria-label="Wrap text"
      />
    </SettingsRow>
  );
}

function EditorFontSizeRow() {
  const fontSize = useEditorFontSize();
  return (
    <SettingsRow
      label="Editor Font size"
      description="Text size for the workspace code/markdown editor."
    >
      <Select
        value={String(fontSize)}
        onValueChange={(v) => setEditorFontSize(Number(v))}
      >
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EDITOR_FONT_SIZES.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {size}px
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
}

// Accepted logo formats; the file is stored as a data URL on
// tenant_settings.features.branding, so SVG/PNG with transparency work best.
const LOGO_MIME_TYPES = [
  "image/png",
  "image/svg+xml",
  "image/jpeg",
  "image/webp",
];

function BrandingRows() {
  const { tenantId } = useTenant();
  const [{ data }, refetch] = useQuery({
    query: SettingsTenantFeaturesQuery,
    variables: { id: tenantId ?? "" },
    pause: !tenantId,
  });
  const [{ fetching: saving }, updateBranding] = useMutation(
    SettingsUpdateTenantBrandingMutation,
  );

  const features = useMemo(
    () => normalizeFeatures(data?.tenant?.settings?.features),
    [data?.tenant?.settings?.features],
  );
  const branding = useMemo(() => brandingFromFeatures(features), [features]);

  // null = untouched (mirror the saved value); string = user is editing.
  const [textDraft, setTextDraft] = useState<string | null>(null);
  const headerTextValue = textDraft ?? branding.headerText ?? "";
  const textDirty =
    textDraft !== null &&
    textDraft.trim() !== (branding.headerText ?? "").trim();
  const [mobileTextDraft, setMobileTextDraft] = useState<string | null>(null);
  const mobileHeaderTextValue =
    mobileTextDraft ?? branding.mobileHeaderText ?? "";
  const mobileTextDirty =
    mobileTextDraft !== null &&
    mobileTextDraft.trim() !== (branding.mobileHeaderText ?? "").trim();

  async function saveBranding(next: TenantBranding) {
    if (!tenantId) return;
    const nextFeatures = {
      ...features,
      branding: {
        ...(next.logoDataUrl ? { logoDataUrl: next.logoDataUrl } : {}),
        ...(next.headerText !== undefined
          ? { headerText: next.headerText }
          : {}),
        ...(next.mobileHeaderText !== undefined
          ? { mobileHeaderText: next.mobileHeaderText }
          : {}),
        ...(next.logoHeightPx !== undefined
          ? { logoHeightPx: next.logoHeightPx }
          : {}),
        updatedAt: new Date().toISOString(),
      },
    };
    const result = await updateBranding({
      tenantId,
      input: { features: JSON.stringify(nextFeatures) },
    });
    if (result.error) {
      toast.error(`Could not save branding: ${result.error.message}`);
      return;
    }
    toast.success("Branding updated");
    setTextDraft(null);
    setMobileTextDraft(null);
    refetch({ requestPolicy: "network-only" });
  }

  function handleLogoFile(file: File | undefined) {
    if (!file) return;
    if (!LOGO_MIME_TYPES.includes(file.type)) {
      toast.error("Logo must be a PNG, SVG, JPEG, or WebP image.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error(
        `Logo file is too large (max ${Math.round(MAX_LOGO_BYTES / 1024)} KB).`,
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
      if (!dataUrl) {
        toast.error("Could not read that image file.");
        return;
      }
      void saveBranding({ ...branding, logoDataUrl: dataUrl });
    };
    reader.onerror = () => toast.error("Could not read that image file.");
    reader.readAsDataURL(file);
  }

  return (
    <>
      <SettingsRow
        label="Logo"
        description="Replaces the app logo in the navigation headers. PNG or SVG with a transparent background works best."
      >
        <div className="flex items-center gap-2">
          {branding.logoDataUrl ? (
            <>
              <img
                src={branding.logoDataUrl}
                alt="Custom logo"
                className="h-8 max-w-36 rounded-sm object-contain"
                data-testid="branding-logo-preview"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() =>
                  void saveBranding({
                    headerText: branding.headerText,
                  })
                }
                data-testid="branding-logo-remove"
              >
                Remove
              </Button>
            </>
          ) : null}
          <label>
            <input
              type="file"
              accept={LOGO_MIME_TYPES.join(",")}
              className="sr-only"
              disabled={saving}
              onChange={(event) => {
                handleLogoFile(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
              data-testid="branding-logo-input"
            />
            <span className="inline-flex h-8 cursor-pointer items-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground">
              {branding.logoDataUrl ? "Replace…" : "Upload…"}
            </span>
          </label>
        </div>
      </SettingsRow>
      {branding.logoDataUrl ? (
        <SettingsRow
          label="Logo Size"
          description="Logo height in the navigation headers when Header Text is blank (logo-only mode)."
        >
          <Select
            value={String(branding.logoHeightPx ?? DEFAULT_LOGO_HEIGHT_PX)}
            onValueChange={(v) =>
              void saveBranding({ ...branding, logoHeightPx: Number(v) })
            }
            disabled={saving}
          >
            <SelectTrigger className="w-40" data-testid="branding-logo-size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOGO_SIZE_OPTIONS.map((opt) => (
                <SelectItem key={opt.px} value={String(opt.px)}>
                  {opt.label} ({opt.px}px)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      ) : null}
      <SettingsRow
        label="Header Text"
        description="Shown next to the logo in the navigation headers. Leave blank to show only the logo."
      >
        <div className="flex items-center gap-2">
          <Input
            value={headerTextValue}
            maxLength={MAX_HEADER_TEXT_LENGTH}
            placeholder={
              branding.logoDataUrl ? "Logo only" : DEFAULT_HEADER_TEXT
            }
            className="w-56"
            onChange={(event) => setTextDraft(event.target.value)}
            data-testid="branding-header-text"
          />
          <Button
            type="button"
            size="sm"
            disabled={saving || !textDirty}
            onClick={() =>
              void saveBranding({
                ...branding,
                headerText: (textDraft ?? "").trim(),
              })
            }
            data-testid="branding-header-text-save"
          >
            Save
          </Button>
        </div>
      </SettingsRow>
      <SettingsRow
        label="Mobile Header Text"
        description="Shown as the title in the mobile app header. Leave blank to show the default title."
      >
        <div className="flex items-center gap-2">
          <Input
            value={mobileHeaderTextValue}
            maxLength={MAX_HEADER_TEXT_LENGTH}
            placeholder="Default title"
            className="w-56"
            onChange={(event) => setMobileTextDraft(event.target.value)}
            data-testid="branding-mobile-header-text"
          />
          <Button
            type="button"
            size="sm"
            disabled={saving || !mobileTextDirty}
            onClick={() =>
              void saveBranding({
                ...branding,
                mobileHeaderText: (mobileTextDraft ?? "").trim(),
              })
            }
            data-testid="branding-mobile-header-text-save"
          >
            Save
          </Button>
        </div>
      </SettingsRow>
    </>
  );
}

function ThemeRow() {
  const { theme, setTheme } = useTheme();
  return (
    <SettingsRow
      label="Theme"
      description="Light, neutral dark, or LastMile-style blue dark appearance on this device."
    >
      <Select value={theme} onValueChange={(v) => setTheme(v as Theme)}>
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="light">Light</SelectItem>
          <SelectItem value="dark">Dark</SelectItem>
          <SelectItem value="dark-blue">Dark Blue</SelectItem>
        </SelectContent>
      </Select>
    </SettingsRow>
  );
}
