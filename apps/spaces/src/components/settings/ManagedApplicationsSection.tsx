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
import { ExternalLink } from "lucide-react";
import type { SettingsDeploymentStatusQuery } from "@/gql/graphql";
import { SettingsSetManagedApplicationDeploymentMutation } from "@/lib/settings-queries";
import {
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

type ManagedAppKey = "cognee" | "twenty";
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
  const [confirm, setConfirm] = useState<{
    key: ManagedAppKey;
    enabled: boolean;
  } | null>(null);
  const [deploymentState, setManagedDeployment] = useMutation(
    SettingsSetManagedApplicationDeploymentMutation,
  );

  const apps = [
    appFromDeployment(deployment, "cognee"),
    appFromDeployment(deployment, "twenty"),
  ];

  async function requestDeployment(key: ManagedAppKey, enabled: boolean) {
    const result = await setManagedDeployment({ key, enabled });
    if (result.error) {
      toast.error(`Could not update ${appLabel(key)}: ${result.error.message}`);
      return;
    }

    setPendingEnabled((current) => ({ ...current, [key]: enabled }));
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
          const queued =
            pendingEnabled[key] !== undefined &&
            pendingEnabled[key] !== app.runtimeEnabled;
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
              <Switch
                checked={desiredEnabled}
                disabled={disabled}
                aria-label={`Toggle ${app.displayName}`}
                onCheckedChange={(checked) => {
                  if (key === "twenty" || !checked) {
                    setConfirm({ key, enabled: checked });
                    return;
                  }
                  void requestDeployment(key, checked);
                }}
              />
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
                void requestDeployment(confirm.key, confirm.enabled);
              }}
            >
              {confirm?.enabled
                ? "Enable"
                : confirm?.key === "twenty"
                  ? "Park"
                  : "Disable"}
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

function confirmTitle(
  confirm: { key: ManagedAppKey; enabled: boolean } | null,
): string {
  if (!confirm) return "Update managed application?";
  if (confirm.key === "twenty") {
    return confirm.enabled ? "Enable Twenty CRM?" : "Park Twenty CRM?";
  }
  return confirm.enabled ? "Enable Cognee?" : "Disable Cognee?";
}

function confirmDescription(
  confirm: { key: ManagedAppKey; enabled: boolean } | null,
): string {
  if (!confirm) return "";
  if (confirm.key === "twenty" && confirm.enabled) {
    return "This queues the deploy workflow. CRM settings remain hidden until deployment status reports Twenty CRM running.";
  }
  if (confirm.key === "twenty") {
    return "This queues the deploy workflow to stop the CRM runtime while retaining the dedicated database, secrets, files, and re-enable path.";
  }
  if (confirm.enabled) {
    return "This queues the deploy workflow to provision the Cognee Knowledge Graph service.";
  }
  return "This queues a Terraform deployment that removes the Cognee service for the current stage. Export graph data first if it needs to be retained.";
}
