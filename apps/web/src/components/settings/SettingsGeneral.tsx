import { useState } from "react";
import { useMutation, useQuery } from "urql";
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
import { APP_VERSION_LABEL } from "@/lib/app-version";
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
  SettingsStartDeploymentReleaseUpdateMutation,
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
  const [deployResult] = useQuery({
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

      <SettingsSection label="About">
        <SettingsRow
          label="App version"
          description="The ThinkWork build running on this device."
        >
          {APP_VERSION_LABEL}
        </SettingsRow>
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

          <DeploymentReleasesSection enabled={showOperator} />

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
            </SettingsSection>
          ) : null}
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

interface DeploymentReleaseUpdateResult {
  executionArn: string;
  stateMachineArn: string;
  evidenceBucket?: string | null;
  evidencePrefix: string;
  message: string;
  release: Pick<
    DeploymentReleaseRow,
    "version" | "manifestUrl" | "manifestSha256" | "signed" | "deployable"
  >;
}

function DeploymentReleasesSection({ enabled }: { enabled: boolean }) {
  const [selectedRelease, setSelectedRelease] =
    useState<DeploymentReleaseRow | null>(null);
  const [lastDeployment, setLastDeployment] =
    useState<DeploymentReleaseUpdateResult | null>(null);
  const [result] = useQuery({
    query: SettingsDeploymentReleasesQuery,
    variables: { limit: 10 },
    pause: !enabled,
  });
  const [updateState, startReleaseUpdate] = useMutation(
    SettingsStartDeploymentReleaseUpdateMutation,
  );
  const releases = (result.data?.deploymentReleases ??
    []) as DeploymentReleaseRow[];

  async function confirmDeploy() {
    if (!selectedRelease) return;
    const response = await startReleaseUpdate({
      input: {
        version: selectedRelease.version,
        manifestUrl: selectedRelease.manifestUrl,
        manifestSha256: selectedRelease.manifestSha256,
        idempotencyKey: `settings-release-${selectedRelease.version}`,
      },
    });
    if (response.error) {
      toast.error("Release deploy failed", {
        description: response.error.message,
      });
      return;
    }
    const deployResult = response.data
      ?.startDeploymentReleaseUpdate as DeploymentReleaseUpdateResult | null;
    if (deployResult) setLastDeployment(deployResult);
    toast.success("Release deploy started", {
      description: deployResult?.message ?? selectedRelease.version,
    });
    setSelectedRelease(null);
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
            <SettingsRow
              key={release.version}
              label={release.version}
              description={releaseDescription(release)}
            >
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedRelease(release)}
                disabled={!release.deployable || updateState.fetching}
              >
                Deploy
              </Button>
            </SettingsRow>
          ))}
        </div>
      )}

      {lastDeployment ? (
        <div className="border-t border-border p-4 text-sm">
          <div className="mb-3">
            <div className="font-medium">Deployment controller started</div>
            <div className="text-muted-foreground">
              {lastDeployment.message}
            </div>
          </div>
          <div className="grid gap-3">
            <ConfirmFact
              label="Release"
              value={lastDeployment.release.version}
            />
            <ConfirmFact
              label="Execution"
              value={lastDeployment.executionArn}
            />
            <ConfirmFact
              label="Evidence"
              value={
                lastDeployment.evidenceBucket
                  ? `${lastDeployment.evidenceBucket}/${lastDeployment.evidencePrefix}`
                  : lastDeployment.evidencePrefix
              }
            />
          </div>
        </div>
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
              disabled={updateState.fetching}
            >
              Cancel
            </Button>
            <Button onClick={confirmDeploy} disabled={updateState.fetching}>
              {updateState.fetching ? "Deploying…" : "Confirm Deploy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
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
