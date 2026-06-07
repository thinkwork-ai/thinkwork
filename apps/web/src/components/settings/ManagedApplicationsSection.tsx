import { Link } from "@tanstack/react-router";
import { Badge, Button } from "@thinkwork/ui";
import { ExternalLink, Settings2 } from "lucide-react";
import type { SettingsDeploymentStatusQuery } from "@/gql/graphql";
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
    managedMcpServerId: null,
    managedMcpStatus: "not_applicable",
    managedMcpInstalled: false,
    managedMcpInstallAvailable: false,
    managedMcpMessage: null,
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
    managedMcpServerId: null,
    managedMcpStatus: "missing",
    managedMcpInstalled: false,
    managedMcpInstallAvailable: false,
    managedMcpMessage: null,
  },
};

export function ManagedApplicationsSection({
  deployment,
  loading,
  unavailable,
}: {
  deployment?: DeploymentStatus;
  loading?: boolean;
  unavailable?: boolean;
  onQueued?: () => void;
}) {
  const apps = [
    appFromDeployment(deployment, "cognee"),
    appFromDeployment(deployment, "twenty"),
  ];

  return (
    <SettingsSection label="Managed Applications">
      {unavailable ? (
        <div className="p-4 text-sm text-muted-foreground">
          Managed application status unavailable.
        </div>
      ) : (
        <>
          {apps.map((app) => (
            <SettingsRow
              key={app.key}
              label={app.displayName}
              description={managedAppDescription(app)}
            >
              <Badge
                variant="outline"
                className={statusBadgeClassName(app.status)}
              >
                {loading ? "loading" : app.status}
              </Badge>
              {app.url && app.runtimeEnabled ? (
                <Button asChild type="button" variant="ghost" size="icon-sm">
                  <a
                    href={app.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${app.displayName}`}
                    title={`Open ${app.displayName}`}
                  >
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
              ) : null}
            </SettingsRow>
          ))}
          <SettingsRow
            label="Lifecycle"
            description="Deployment, teardown, release changes, and evidence are managed from the dedicated operator page."
          >
            <Button asChild type="button" variant="outline" size="sm">
              <Link to="/settings/managed-applications">
                <Settings2 className="size-4" />
                Manage
              </Link>
            </Button>
          </SettingsRow>
        </>
      )}
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

function statusBadgeClassName(status: string) {
  if (status === "running") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  }
  if (
    status === "planning" ||
    status === "awaiting_approval" ||
    status === "applying" ||
    status === "deploying"
  ) {
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
