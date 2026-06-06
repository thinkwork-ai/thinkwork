import { useState } from "react";
import { useMutation } from "urql";
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
  Switch,
} from "@thinkwork/ui";
import { ExternalLink, Settings } from "lucide-react";
import {
  ManagedApplicationDeploymentAction,
  type SettingsDeploymentStatusQuery,
} from "@/gql/graphql";
import { SettingsSetManagedApplicationDeploymentMutation } from "@/lib/settings-queries";
import {
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

type ManagedAppKey = "cognee" | "twenty";
type ManagedAppAction = ManagedApplicationDeploymentAction;
type DeploymentStatus = SettingsDeploymentStatusQuery["deploymentStatus"];
type ManagedApplication =
  SettingsDeploymentStatusQuery["deploymentStatus"]["managedApplications"][number];

const FALLBACK_APPS: Record<ManagedAppKey, ManagedApplication> = {
  cognee: {
    __typename: "ManagedApplicationDeployment",
    key: "cognee",
    displayName: "Cognee",
    description: "Knowledge Graph service for ontology and graph retrieval.",
    status: "disabled",
    enabled: false,
    provisioned: false,
    runtimeEnabled: false,
    url: null,
    endpoint: null,
    backendMode: null,
    logGroupName: null,
    logGroupNames: [],
    clusterArn: null,
    serviceName: null,
    serviceNames: [],
    albArn: null,
    targetGroupArn: null,
    message: "Cognee is not provisioned for this stage.",
  },
  twenty: {
    __typename: "ManagedApplicationDeployment",
    key: "twenty",
    displayName: "Twenty CRM",
    description: "Self-hosted CRM runtime managed by ThinkWork.",
    status: "disabled",
    enabled: false,
    provisioned: false,
    runtimeEnabled: false,
    url: null,
    endpoint: null,
    backendMode: null,
    logGroupName: null,
    logGroupNames: [],
    clusterArn: null,
    serviceName: null,
    serviceNames: [],
    albArn: null,
    targetGroupArn: null,
    message: "Twenty CRM has not been provisioned for this stage.",
  },
};

export function ManagedApplicationsSection({
  deployment,
  loading,
  unavailable,
  onQueued,
}: {
  deployment?: DeploymentStatus;
  loading?: boolean;
  unavailable?: boolean;
  onQueued?: () => void;
}) {
  const [pendingEnabled, setPendingEnabled] = useState<
    Partial<Record<ManagedAppKey, boolean>>
  >({});
  const [pendingAction, setPendingAction] = useState<
    Partial<Record<ManagedAppKey, ManagedAppAction>>
  >({});
  const [confirm, setConfirm] = useState<{
    key: ManagedAppKey;
    action: ManagedAppAction;
  } | null>(null);
  const [deploymentState, setManagedDeployment] = useMutation(
    SettingsSetManagedApplicationDeploymentMutation,
  );

  const apps = [
    appFromDeployment(deployment, "cognee"),
    appFromDeployment(deployment, "twenty"),
  ];

  async function requestDeployment(
    key: ManagedAppKey,
    action: ManagedAppAction,
  ) {
    const result = await setManagedDeployment({ key, action });
    if (result.error) {
      toast.error(`Could not update ${appLabel(key)}: ${result.error.message}`);
      return;
    }

    setPendingEnabled((current) => ({
      ...current,
      [key]: action === ManagedApplicationDeploymentAction.Enable,
    }));
    setPendingAction((current) => ({ ...current, [key]: action }));
    setConfirm(null);
    toast.success(
      result.data?.setManagedApplicationDeployment.message ??
        `${appLabel(key)} deployment queued.`,
    );
    onQueued?.();
  }

  return (
    <SettingsSection label="Managed Applications">
      {unavailable ? (
        <div className="p-4 text-sm text-muted-foreground">
          Managed application status unavailable.
        </div>
      ) : (
        apps.map((app) => {
          const key = app.key as ManagedAppKey;
          const desiredEnabled = pendingEnabled[key] ?? app.runtimeEnabled;
          const activeQueuedAction =
            pendingAction[key] &&
            !managedActionSatisfied(app, pendingAction[key])
              ? pendingAction[key]
              : undefined;
          const queued =
            activeQueuedAction !== undefined ||
            (pendingEnabled[key] !== undefined &&
              pendingEnabled[key] !== app.runtimeEnabled);
          const disabled = loading || deploymentState.fetching || !deployment;

          return (
            <SettingsRow
              key={key}
              label={app.displayName}
              description={managedAppDescription(app)}
            >
              <Badge variant={statusVariant(queued ? "queued" : app.status)}>
                {queued ? "queued" : app.status}
              </Badge>
              {app.url && app.runtimeEnabled ? (
                <Button
                  asChild
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Open ${app.displayName}`}
                  title={`Open ${app.displayName}`}
                >
                  <a href={app.url} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
              ) : null}
              {key === "twenty" ? (
                <Button
                  asChild
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                >
                  <a href="/settings/crm">
                    <Settings className="size-4" />
                    Configure
                  </a>
                </Button>
              ) : (
                <Switch
                  checked={desiredEnabled}
                  disabled={disabled}
                  aria-label={`Toggle ${app.displayName}`}
                  onCheckedChange={(checked) => {
                    const action = checked
                      ? ManagedApplicationDeploymentAction.Enable
                      : ManagedApplicationDeploymentAction.Destroy;
                    if (!checked) {
                      setConfirm({ key, action });
                      return;
                    }
                    void requestDeployment(key, action);
                  }}
                />
              )}
            </SettingsRow>
          );
        })
      )}

      <AlertDialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle(confirm)}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDescription(confirm)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deploymentState.fetching || !confirm}
              onClick={() => {
                if (!confirm) return;
                void requestDeployment(confirm.key, confirm.action);
              }}
            >
              {confirmActionLabel(confirm)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}

function appFromDeployment(
  deployment: DeploymentStatus | undefined,
  key: ManagedAppKey,
): ManagedApplication {
  return (
    deployment?.managedApplications.find((app) => app.key === key) ??
    FALLBACK_APPS[key]
  );
}

function managedAppDescription(app: ManagedApplication): string {
  if (app.message && app.status !== "running") return app.message;
  return app.description;
}

function statusVariant(status: string) {
  if (status === "running" || status === "queued") return "default";
  if (status === "unknown") return "destructive";
  return "secondary";
}

function appLabel(key: ManagedAppKey): string {
  return key === "twenty" ? "Twenty CRM" : "Cognee";
}

function managedActionSatisfied(
  app: ManagedApplication,
  action: ManagedAppAction,
): boolean {
  if (action === ManagedApplicationDeploymentAction.Enable) {
    return app.runtimeEnabled;
  }
  if (action === ManagedApplicationDeploymentAction.Park) {
    return app.provisioned && !app.runtimeEnabled;
  }
  return !app.provisioned && !app.runtimeEnabled;
}

function confirmTitle(
  confirm: { key: ManagedAppKey; action: ManagedAppAction } | null,
): string {
  if (!confirm) return "Update managed application?";
  return confirm.action === ManagedApplicationDeploymentAction.Enable
    ? "Enable Cognee?"
    : "Disable Cognee?";
}

function confirmDescription(
  confirm: { key: ManagedAppKey; action: ManagedAppAction } | null,
): string {
  if (!confirm) return "";
  if (confirm.action === ManagedApplicationDeploymentAction.Enable) {
    return "This queues the deploy workflow to provision the Cognee Knowledge Graph service.";
  }
  return "This queues a Terraform deployment that removes the Cognee service for the current stage. Export graph data first if it needs to be retained.";
}

function confirmActionLabel(
  confirm: { key: ManagedAppKey; action: ManagedAppAction } | null,
): string {
  if (!confirm) return "Continue";
  if (confirm.action === ManagedApplicationDeploymentAction.Enable) {
    return "Deploy";
  }
  if (confirm.action === ManagedApplicationDeploymentAction.Park) {
    return "Park";
  }
  return "Disable";
}
