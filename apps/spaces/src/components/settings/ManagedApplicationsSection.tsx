import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
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
  Switch,
} from "@thinkwork/ui";
import { ExternalLink } from "lucide-react";
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

const PENDING_DEPLOYMENT_TTL_MS = 2 * 60 * 60 * 1000;

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
  const [deploymentErrors, setDeploymentErrors] = useState<
    Partial<Record<ManagedAppKey, string>>
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

  useEffect(() => {
    if (!deployment) return;

    const restoredPendingAction: Partial<
      Record<ManagedAppKey, ManagedAppAction>
    > = {};
    const restoredPendingEnabled: Partial<Record<ManagedAppKey, boolean>> = {};

    for (const app of apps) {
      const key = app.key as ManagedAppKey;
      const pending = readStoredPendingDeployment(deployment.stage, key);
      if (!pending) continue;

      if (managedActionSatisfied(app, pending.action)) {
        clearStoredPendingDeployment(deployment.stage, key);
        continue;
      }

      restoredPendingAction[key] = pending.action;
      restoredPendingEnabled[key] =
        pending.action === ManagedApplicationDeploymentAction.Enable;
    }

    setPendingAction((current) => ({
      ...restoredPendingAction,
      ...current,
    }));
    setPendingEnabled((current) => ({
      ...restoredPendingEnabled,
      ...current,
    }));
  }, [deployment?.stage, deployment?.managedApplications]);

  async function requestDeployment(
    key: ManagedAppKey,
    action: ManagedAppAction,
  ) {
    setDeploymentErrors((current) => ({ ...current, [key]: undefined }));
    setPendingAction((current) => ({ ...current, [key]: action }));
    setPendingEnabled((current) => ({
      ...current,
      [key]: action === ManagedApplicationDeploymentAction.Enable,
    }));
    setConfirm(null);
    if (deployment) {
      storePendingDeployment(deployment.stage, key, action);
    }

    const result = await setManagedDeployment({ key, action });
    if (result.error) {
      if (deployment) {
        clearStoredPendingDeployment(deployment.stage, key);
      }
      const errorMessage = result.error.message;
      setPendingAction((current) => ({ ...current, [key]: undefined }));
      setPendingEnabled((current) => ({ ...current, [key]: undefined }));
      setDeploymentErrors((current) => ({
        ...current,
        [key]: errorMessage,
      }));
      toast.error(`Could not update ${appLabel(key)}: ${errorMessage}`);
      return;
    }

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
          const statusLabel = queued
            ? queuedStatus(activeQueuedAction)
            : app.status;
          const disabled = loading || deploymentState.fetching || !deployment;

          return (
            <SettingsRow
              key={key}
              label={<ManagedApplicationLabel app={app} />}
              description={deploymentErrors[key] ?? managedAppDescription(app)}
            >
              <Badge
                variant="outline"
                className={statusBadgeClassName(statusLabel)}
              >
                {statusLabel}
              </Badge>
              {key === "twenty" ? (
                <Switch
                  checked={desiredEnabled}
                  disabled={disabled || queued || app.provisioned}
                  aria-label={`Toggle ${app.displayName}`}
                  onCheckedChange={(checked) => {
                    if (!checked) return;
                    void requestDeployment(
                      key,
                      ManagedApplicationDeploymentAction.Enable,
                    );
                  }}
                />
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

function ManagedApplicationLabel({ app }: { app: ManagedApplication }) {
  if (app.key !== "twenty") return app.displayName;

  return (
    <span className="inline-flex items-center gap-2">
      <Link
        to="/settings/crm"
        className="rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {app.displayName}
      </Link>
      {app.url && app.runtimeEnabled ? (
        <a
          href={app.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Open ${app.displayName}`}
          title={`Open ${app.displayName}`}
        >
          <ExternalLink className="size-4" />
        </a>
      ) : null}
    </span>
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

function statusBadgeClassName(status: string) {
  if (status === "running") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  }
  if (status === "deploying" || status === "queued") {
    return "border-sky-500/40 bg-sky-500/10 text-sky-300";
  }
  if (status === "parked") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  }
  if (status === "unknown" || status === "failed") {
    return "border-destructive/40 bg-destructive/10 text-destructive";
  }
  return "border-border bg-muted/30 text-muted-foreground";
}

function queuedStatus(action: ManagedAppAction | undefined): string {
  if (action === ManagedApplicationDeploymentAction.Enable) return "deploying";
  if (action === ManagedApplicationDeploymentAction.Park) return "parking";
  if (action === ManagedApplicationDeploymentAction.Destroy) return "removing";
  return "queued";
}

function pendingDeploymentStorageKey(
  stage: string,
  key: ManagedAppKey,
): string {
  return `thinkwork:${stage}:managed-app:${key}:pending-action`;
}

function storePendingDeployment(
  stage: string,
  key: ManagedAppKey,
  action: ManagedAppAction,
) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    pendingDeploymentStorageKey(stage, key),
    JSON.stringify({ action, createdAt: Date.now() }),
  );
}

function readStoredPendingDeployment(
  stage: string,
  key: ManagedAppKey,
): { action: ManagedAppAction } | null {
  if (typeof window === "undefined") return null;

  const storageKey = pendingDeploymentStorageKey(stage, key);
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as {
      action?: ManagedAppAction;
      createdAt?: number;
    };
    if (
      !parsed.action ||
      typeof parsed.createdAt !== "number" ||
      Date.now() - parsed.createdAt > PENDING_DEPLOYMENT_TTL_MS
    ) {
      window.localStorage.removeItem(storageKey);
      return null;
    }
    return { action: parsed.action };
  } catch {
    window.localStorage.removeItem(storageKey);
    return null;
  }
}

function clearStoredPendingDeployment(stage: string, key: ManagedAppKey) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(pendingDeploymentStorageKey(stage, key));
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
