import { useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
} from "@thinkwork/ui";
import {
  Copy,
  ExternalLink,
  PauseCircle,
  Plug,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { ManagedApplicationDeploymentAction } from "@/gql/graphql";
import {
  SettingsDeploymentStatusQuery,
  SettingsInstallManagedApplicationMcpServerMutation,
  SettingsSetManagedApplicationDeploymentMutation,
  SettingsManagedApplicationHealthCheckQuery,
} from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsPane,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

export function SettingsCrm() {
  const [statusResult, refreshStatus] = useQuery({
    query: SettingsDeploymentStatusQuery,
  });
  const [healthResult, runHealthCheck] = useQuery({
    query: SettingsManagedApplicationHealthCheckQuery,
    variables: { key: "twenty" },
    pause: true,
    requestPolicy: "network-only",
  });
  const [deploymentState, setManagedDeployment] = useMutation(
    SettingsSetManagedApplicationDeploymentMutation,
  );
  const [installMcpState, installMcpServer] = useMutation(
    SettingsInstallManagedApplicationMcpServerMutation,
  );
  const [pendingAction, setPendingAction] =
    useState<ManagedApplicationDeploymentAction | null>(null);
  const [confirmAction, setConfirmAction] =
    useState<ManagedApplicationDeploymentAction | null>(null);
  const [workflowUrl, setWorkflowUrl] = useState<string | null>(null);
  const [deploymentError, setDeploymentError] = useState<string | null>(null);

  const deployment = statusResult.data?.deploymentStatus;
  const crm = deployment?.managedApplications.find(
    (app) => app.key === "twenty",
  );
  const queued =
    pendingAction !== null &&
    !crmActionSatisfied(
      {
        provisioned: crm?.provisioned ?? false,
        runtimeEnabled: crm?.runtimeEnabled ?? false,
      },
      pendingAction,
    );
  const statusLabel = queued ? "queued" : (crm?.status ?? "...");
  const deploymentDescription = queued
    ? `${actionVerb(pendingAction)} queued. The deploy workflow is updating Twenty CRM for this stage.`
    : (crm?.message ?? "Runtime state from deployment status.");

  async function requestDeployment(action: ManagedApplicationDeploymentAction) {
    setPendingAction(action);
    setDeploymentError(null);
    setConfirmAction(null);

    const result = await setManagedDeployment({ key: "twenty", action });
    if (result.error) {
      setPendingAction(null);
      setDeploymentError(result.error.message);
      toast.error(`Could not update Twenty CRM: ${result.error.message}`);
      return;
    }

    setWorkflowUrl(
      result.data?.setManagedApplicationDeployment.workflowUrl ?? null,
    );
    toast.success(
      result.data?.setManagedApplicationDeployment.message ??
        "Twenty CRM deployment queued.",
    );
    refreshStatus({ requestPolicy: "network-only" });
  }

  async function requestMcpInstall() {
    const result = await installMcpServer({ key: "twenty" });
    if (result.error) {
      toast.error(
        `Could not install Twenty MCP server: ${result.error.message}`,
      );
      return;
    }
    toast.success(
      result.data?.installManagedApplicationMcpServer.message ??
        "Twenty CRM MCP server installed.",
    );
    refreshStatus({ requestPolicy: "network-only" });
  }

  return (
    <SettingsPane>
      <SettingsHeader
        title="CRM"
        description="Twenty CRM deployment for this ThinkWork stage."
      />

      {statusResult.error ? (
        <SettingsSection>
          <div className="p-4 text-sm text-muted-foreground">
            CRM deployment status unavailable.
          </div>
        </SettingsSection>
      ) : (
        <>
          <SettingsSection label="Application">
            <SettingsRow label="Deployment" description={deploymentDescription}>
              <Badge
                variant={
                  queued || crm?.runtimeEnabled ? "default" : "secondary"
                }
              >
                {statusLabel}
              </Badge>
              <CrmDeployAction
                provisioned={crm?.provisioned ?? false}
                runtimeEnabled={crm?.runtimeEnabled ?? false}
                queued={queued}
                fetching={deploymentState.fetching || statusResult.fetching}
                onDeploy={() =>
                  void requestDeployment(
                    ManagedApplicationDeploymentAction.Enable,
                  )
                }
              />
            </SettingsRow>
            {deploymentError ? (
              <SettingsRow
                label="Last deployment request"
                description="Twenty CRM was not queued."
              >
                <Badge variant="destructive">failed</Badge>
                <span className="max-w-md text-sm text-muted-foreground">
                  {deploymentError}
                </span>
              </SettingsRow>
            ) : null}
            {workflowUrl ? (
              <SettingsRow
                label="Workflow"
                description="The deploy workflow will update status when it finishes."
              >
                <Button asChild type="button" variant="outline" size="sm">
                  <a href={workflowUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                    Open workflow
                  </a>
                </Button>
              </SettingsRow>
            ) : null}
            <CopyableSettingsRow label="URL" value={crm?.url} external />
            {crm?.runtimeEnabled ? (
              <SettingsRow
                label="MCP server"
                description={
                  crm.managedMcpMessage ??
                  "Twenty CRM MCP server registration for ThinkWork agents."
                }
              >
                <Badge
                  variant={
                    crm.managedMcpStatus === "installed"
                      ? "default"
                      : "secondary"
                  }
                >
                  {crm.managedMcpStatus}
                </Badge>
                {crm.managedMcpInstallAvailable ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={installMcpState.fetching}
                    onClick={() => void requestMcpInstall()}
                  >
                    <Plug className="size-4" />
                    Install MCP Server
                  </Button>
                ) : null}
              </SettingsRow>
            ) : null}
            <SettingsRow
              label="First admin setup"
              description="Twenty native first-user setup creates the initial CRM workspace admin."
            />
            <SettingsRow
              label="SSO"
              description="Follow-up: connect ThinkWork/Cognito SSO after the smallest deployable release."
            />
            <SettingsRow label="Stage">
              {deployment?.stage ?? "..."}
            </SettingsRow>
            <SettingsRow label="Region">
              {deployment?.region ?? "..."}
            </SettingsRow>
          </SettingsSection>

          <SettingsSection label="Service details">
            <CopyableSettingsRow label="Cluster" value={crm?.clusterArn} />
            <ValueListRow label="Services" values={crm?.serviceNames ?? []} />
            <ValueListRow label="Logs" values={crm?.logGroupNames ?? []} />
            <CopyableSettingsRow label="Load balancer" value={crm?.albArn} />
            <CopyableSettingsRow
              label="Target group"
              value={crm?.targetGroupArn}
            />
          </SettingsSection>

          <SettingsSection label="Health">
            <SettingsRow
              label="Connection test"
              description="Probe the public Twenty /healthz endpoint through the ThinkWork API."
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!crm?.runtimeEnabled || healthResult.fetching}
                onClick={() =>
                  runHealthCheck({ requestPolicy: "network-only" })
                }
              >
                <RefreshCw className="size-4" />
                Test connection
              </Button>
            </SettingsRow>
            {healthResult.data?.managedApplicationHealthCheck ? (
              <SettingsRow label="Last test">
                <Badge
                  variant={
                    healthResult.data.managedApplicationHealthCheck.healthy
                      ? "default"
                      : "destructive"
                  }
                >
                  {healthResult.data.managedApplicationHealthCheck.healthy
                    ? "healthy"
                    : "unhealthy"}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {formatHealthCheck(
                    healthResult.data.managedApplicationHealthCheck,
                  )}
                </span>
              </SettingsRow>
            ) : healthResult.error ? (
              <SettingsRow label="Last test">
                <Badge variant="destructive">unavailable</Badge>
                <span className="text-sm text-muted-foreground">
                  {healthResult.error.message}
                </span>
              </SettingsRow>
            ) : null}
          </SettingsSection>

          {crm?.provisioned ? (
            <SettingsSection label="Teardown">
              <SettingsRow
                label="Park runtime"
                description="Stop the Twenty server and worker while keeping the dedicated database, files, secrets, and re-enable path."
              >
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={
                    queued ||
                    deploymentState.fetching ||
                    statusResult.fetching ||
                    !crm.runtimeEnabled
                  }
                  onClick={() =>
                    setConfirmAction(ManagedApplicationDeploymentAction.Park)
                  }
                >
                  <PauseCircle className="size-4" />
                  Park
                </Button>
              </SettingsRow>
              <SettingsRow
                label="Destroy application"
                description="Remove the Twenty runtime, storage, cache, app secrets, and dedicated database for this stage."
              >
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={
                    queued || deploymentState.fetching || statusResult.fetching
                  }
                  onClick={() =>
                    setConfirmAction(ManagedApplicationDeploymentAction.Destroy)
                  }
                >
                  <Trash2 className="size-4" />
                  Destroy
                </Button>
              </SettingsRow>
            </SettingsSection>
          ) : null}
        </>
      )}
      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmActionTitle(confirmAction)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmActionDescription(confirmAction)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deploymentState.fetching || confirmAction === null}
              onClick={() => {
                if (confirmAction === null) return;
                void requestDeployment(confirmAction);
              }}
            >
              {confirmActionLabel(confirmAction)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPane>
  );
}

function formatHealthCheck(check: {
  statusCode?: number | null;
  latencyMs: number;
  message: string;
}) {
  const status = check.statusCode ? `HTTP ${check.statusCode}` : "no status";
  return `${status} in ${check.latencyMs} ms. ${check.message}`;
}

function CrmDeployAction({
  provisioned,
  runtimeEnabled,
  queued,
  fetching,
  onDeploy,
}: {
  provisioned: boolean;
  runtimeEnabled: boolean;
  queued: boolean;
  fetching: boolean;
  onDeploy: () => void;
}) {
  if (!provisioned || runtimeEnabled) {
    return null;
  }

  return (
    <Button
      type="button"
      size="sm"
      disabled={queued || fetching}
      onClick={onDeploy}
    >
      <Play className="size-4" />
      {queued ? "Queued" : "Deploy"}
    </Button>
  );
}

function crmActionSatisfied(
  crm: { provisioned: boolean; runtimeEnabled: boolean },
  action: ManagedApplicationDeploymentAction,
) {
  if (action === ManagedApplicationDeploymentAction.Enable) {
    return crm.runtimeEnabled;
  }
  if (action === ManagedApplicationDeploymentAction.Park) {
    return crm.provisioned && !crm.runtimeEnabled;
  }
  return !crm.provisioned && !crm.runtimeEnabled;
}

function actionVerb(action: ManagedApplicationDeploymentAction | null) {
  if (action === ManagedApplicationDeploymentAction.Enable) return "Deploy";
  if (action === ManagedApplicationDeploymentAction.Park) return "Park";
  if (action === ManagedApplicationDeploymentAction.Destroy) return "Destroy";
  return "Deployment";
}

function confirmActionTitle(action: ManagedApplicationDeploymentAction | null) {
  if (action === ManagedApplicationDeploymentAction.Enable) {
    return "Deploy Twenty CRM?";
  }
  if (action === ManagedApplicationDeploymentAction.Park) {
    return "Park Twenty CRM?";
  }
  if (action === ManagedApplicationDeploymentAction.Destroy) {
    return "Destroy Twenty CRM and delete data?";
  }
  return "Update Twenty CRM?";
}

function confirmActionDescription(
  action: ManagedApplicationDeploymentAction | null,
) {
  if (action === ManagedApplicationDeploymentAction.Enable) {
    return "This queues the deploy workflow to provision Twenty CRM and start the server and worker runtime.";
  }
  if (action === ManagedApplicationDeploymentAction.Park) {
    return "This queues the deploy workflow to stop the CRM runtime while retaining the dedicated database, secrets, files, and re-enable path.";
  }
  if (action === ManagedApplicationDeploymentAction.Destroy) {
    return "This queues a destructive deploy workflow that removes the Twenty runtime, storage, cache, app secrets, and dedicated database. This cannot be undone from ThinkWork.";
  }
  return "";
}

function confirmActionLabel(action: ManagedApplicationDeploymentAction | null) {
  if (action === ManagedApplicationDeploymentAction.Enable) return "Deploy";
  if (action === ManagedApplicationDeploymentAction.Park) return "Park";
  if (action === ManagedApplicationDeploymentAction.Destroy) {
    return "Destroy and delete data";
  }
  return "Continue";
}

function ValueListRow({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) {
    return <SettingsRow label={label}>Not provisioned</SettingsRow>;
  }

  return (
    <SettingsRow label={label}>
      <div className="flex max-w-sm flex-col items-end gap-1">
        {values.map((value) => (
          <span key={value} className="max-w-sm truncate" title={value}>
            {value}
          </span>
        ))}
      </div>
    </SettingsRow>
  );
}

function CopyableSettingsRow({
  label,
  value,
  external,
}: {
  label: string;
  value?: string | null;
  external?: boolean;
}) {
  if (!value) {
    return <SettingsRow label={label}>Not provisioned</SettingsRow>;
  }

  return (
    <SettingsRow label={label}>
      <span className="max-w-sm truncate" title={value}>
        {value}
      </span>
      {external ? (
        <Button
          asChild
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Open ${label}`}
          title={`Open ${label}`}
        >
          <a href={value} target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" />
          </a>
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
        onClick={() => {
          void navigator.clipboard.writeText(value);
          toast.success(`${label} copied`);
        }}
      >
        <Copy className="size-4" />
      </Button>
    </SettingsRow>
  );
}
