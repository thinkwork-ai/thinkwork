import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "urql";
import { toast } from "sonner";
import {
  Button,
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
} from "@thinkwork/ui";
import { useTenant } from "@/context/TenantContext";
import { isDesktop } from "@/lib/desktop-detection";
import { requestDesktopNotificationPermission } from "@/lib/desktop-notifications";
import {
  setThreadNotificationsEnabled,
  useThreadNotificationsEnabled,
} from "@/lib/thread-notifications-pref";
import {
  EDITOR_FONT_SIZES,
  setEditorFontSize,
  setEditorWrap,
  useEditorFontSize,
  useEditorWrap,
} from "@/lib/editor-prefs";
import {
  SettingsDeploymentReleasesQuery,
  SettingsDeploymentStatusQuery,
} from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsPane,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

export function SettingsGeneral() {
  const { isOperator, roleResolved } = useTenant();

  // Operators only — members never issue the deployment query (it is also
  // gated server-side in U8).
  const showOperator = roleResolved && isOperator;
  const [deployResult, refreshDeploymentStatus] = useQuery({
    query: SettingsDeploymentStatusQuery,
    pause: !showOperator,
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
      </SettingsSection>

      {isDesktop() ? (
        <SettingsSection label="Notifications">
          <ThreadNotificationsRow />
        </SettingsSection>
      ) : null}

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

          {!deploymentFailed ? (
            <SettingsSection label="Resources & URLs">
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
      ) : null}
    </SettingsPane>
  );
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
  signed: boolean;
  deployable: boolean;
}

interface DeploymentReleaseUpdateJobResult {
  id: string;
  status: string;
  targetReleaseVersion: string;
  executionArn?: string | null;
  stateMachineArn?: string | null;
  evidenceBucket?: string | null;
  evidencePrefix?: string | null;
  failureMessage?: string | null;
  recoveryAction?: string | null;
}

type DeploymentProgressState =
  | {
      phase: "starting";
      release: DeploymentReleaseRow;
      message: string;
    }
  | {
      phase: "accepted";
      release: DeploymentReleaseRow;
      message: string;
      result: DeploymentReleaseUpdateJobResult;
    }
  | {
      phase: "failed";
      release: DeploymentReleaseRow;
      message: string;
    };

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
  const [deploymentProgress, setDeploymentProgress] =
    useState<DeploymentProgressState | null>(null);
  const [result] = useQuery({
    query: SettingsDeploymentReleasesQuery,
    variables: { limit: 5 },
    pause: !enabled,
  });
  const releases = (result.data?.deploymentReleases ??
    []) as DeploymentReleaseRow[];
  const deploymentCompleted =
    deploymentProgress?.phase === "accepted" &&
    deploymentProgress.release.version === currentReleaseVersion;
  const deploymentBusy = false;

  useEffect(() => {
    if (deploymentProgress?.phase !== "accepted" || deploymentCompleted) {
      return;
    }
    const interval = window.setInterval(() => {
      onRefreshDeploymentStatus?.();
    }, 8000);
    return () => window.clearInterval(interval);
  }, [
    deploymentCompleted,
    deploymentProgress?.phase,
    onRefreshDeploymentStatus,
  ]);

  async function confirmDeploy() {
    if (!selectedRelease) return;
    const release = selectedRelease;
    setSelectedRelease(null);
    const message =
      "Release updates now require preflight review before dispatch.";
    setDeploymentProgress({ phase: "failed", release, message });
    toast.error("Release preflight required", { description: message });
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
                Deploy
              </Button>
            </ReleaseRow>
          ))}
        </div>
      )}

      {deploymentProgress ? (
        <DeploymentProgressPanel
          progress={deploymentProgress}
          completed={deploymentCompleted}
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
            <DialogTitle>Deploy release?</DialogTitle>
            <DialogDescription>
              Start the deployment controller for this ThinkWork environment.
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
            <Button onClick={confirmDeploy} disabled={deploymentBusy}>
              {deploymentBusy ? "Starting…" : "Confirm Deploy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}

function DeploymentProgressPanel({
  progress,
  completed,
}: {
  progress: DeploymentProgressState;
  completed: boolean;
}) {
  const steps = useMemo(
    () => deploymentSteps(progress.phase, completed),
    [completed, progress.phase],
  );
  const result = progress.phase === "accepted" ? progress.result : null;
  const title = completed
    ? "Deployment completed"
    : progress.phase === "failed"
      ? "Deployment failed before the controller started"
      : progress.phase === "accepted"
        ? "Deployment controller started"
        : "Starting deployment controller";

  return (
    <div
      className="border-t border-border p-4 text-sm"
      role="status"
      aria-live="polite"
    >
      <div className="mb-4">
        <div className="font-medium">{title}</div>
        <div
          className={
            progress.phase === "failed"
              ? "text-destructive"
              : "text-muted-foreground"
          }
        >
          {progress.message}
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

      <div className="grid gap-3">
        <ConfirmFact label="Release" value={progress.release.version} />
        {result ? (
          <>
            <ConfirmFact label="Execution" value={result.executionArn ?? ""} />
            <ConfirmFact
              label="Evidence"
              value={
                result.evidenceBucket
                  ? `${result.evidenceBucket}/${result.evidencePrefix}`
                  : (result.evidencePrefix ?? "")
              }
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function deploymentSteps(
  phase: DeploymentProgressState["phase"],
  completed: boolean,
) {
  if (phase === "failed") {
    return [
      { label: "Submit release request", state: "failed" as const },
      { label: "Start deployment controller", state: "pending" as const },
      { label: "Run Terraform update", state: "pending" as const },
      { label: "Record deployment evidence", state: "pending" as const },
    ];
  }
  if (phase === "starting") {
    return [
      { label: "Submit release request", state: "active" as const },
      { label: "Start deployment controller", state: "pending" as const },
      { label: "Run Terraform update", state: "pending" as const },
      { label: "Record deployment evidence", state: "pending" as const },
    ];
  }
  return [
    { label: "Submit release request", state: "complete" as const },
    { label: "Start deployment controller", state: "complete" as const },
    {
      label: "Run Terraform update",
      state: completed ? ("complete" as const) : ("active" as const),
    },
    {
      label: "Record deployment evidence",
      state: completed ? ("complete" as const) : ("pending" as const),
    },
  ];
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

function ThreadNotificationsRow() {
  const enabled = useThreadNotificationsEnabled();

  async function onToggle(next: boolean) {
    setThreadNotificationsEnabled(next);
    if (next) {
      // Ask the OS for permission on enable; warn if the user has blocked it.
      const result = await requestDesktopNotificationPermission();
      if (result === "denied") {
        toast.message("Notifications are blocked", {
          description:
            "Enable notifications for ThinkWork in your system settings to receive them.",
        });
      }
    }
  }

  return (
    <SettingsRow
      label="Thread notifications"
      description="Show a desktop notification when a thread updates."
    >
      <Switch
        checked={enabled}
        onCheckedChange={(next) => void onToggle(next)}
        aria-label="Thread notifications"
      />
    </SettingsRow>
  );
}

function ThemeRow() {
  const { theme, setTheme } = useTheme();
  return (
    <SettingsRow
      label="Theme"
      description="Light or dark appearance on this device."
    >
      <Select
        value={theme}
        onValueChange={(v) => setTheme(v as "light" | "dark")}
      >
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="light">Light</SelectItem>
          <SelectItem value="dark">Dark</SelectItem>
        </SelectContent>
      </Select>
    </SettingsRow>
  );
}
