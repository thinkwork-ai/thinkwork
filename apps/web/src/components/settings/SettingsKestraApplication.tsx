import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { Badge, Button } from "@thinkwork/ui";
import { Copy, ExternalLink, Plug, RefreshCw, Settings2 } from "lucide-react";
import {
  SettingsDeploymentStatusQuery,
  SettingsInstallManagedApplicationMcpServerMutation,
  SettingsManagedApplicationHealthCheckQuery,
} from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsPane,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { ManagedApplicationLifecycleActions } from "@/components/settings/managed-applications/ManagedApplicationLifecycleActions";

export function SettingsKestraApplication() {
  usePageHeaderActions({
    title: "Kestra",
    breadcrumbs: [
      { label: "Applications", href: "/settings/managed-applications" },
      { label: "Kestra" },
    ],
    action: <ManagedApplicationLifecycleActions appKey="kestra" />,
    actionKey: "kestra-application:lifecycle",
  });

  const [statusResult, refreshStatus] = useQuery({
    query: SettingsDeploymentStatusQuery,
  });
  const [healthResult, runHealthCheck] = useQuery({
    query: SettingsManagedApplicationHealthCheckQuery,
    variables: { key: "kestra" },
    pause: true,
    requestPolicy: "network-only",
  });
  const [installMcpState, installMcpServer] = useMutation(
    SettingsInstallManagedApplicationMcpServerMutation,
  );

  const deployment = statusResult.data?.deploymentStatus;
  const kestra = deployment?.managedApplications.find(
    (app) => app.key === "kestra",
  );
  const statusLabel = kestra?.status ?? "...";
  const deploymentDescription =
    kestra?.message ?? "Runtime state from deployment status.";

  async function requestMcpInstall() {
    const result = await installMcpServer({ key: "kestra" });
    if (result.error) {
      toast.error(
        `Could not install Kestra MCP server: ${result.error.message}`,
      );
      return;
    }
    toast.success(
      result.data?.installManagedApplicationMcpServer.message ??
        "Kestra control MCP server installed.",
    );
    refreshStatus({ requestPolicy: "network-only" });
  }

  return (
    <SettingsPane>
      <SettingsHeader
        title="Kestra"
        description="Kestra orchestration deployment for this ThinkWork stage."
      />

      {statusResult.error ? (
        <SettingsSection>
          <div className="p-4 text-sm text-muted-foreground">
            Kestra deployment status unavailable.
          </div>
        </SettingsSection>
      ) : (
        <>
          <SettingsSection label="Application">
            <SettingsRow label="Deployment" description={deploymentDescription}>
              <Badge variant={kestra?.runtimeEnabled ? "default" : "secondary"}>
                {statusLabel}
              </Badge>
              <Button asChild type="button" variant="outline" size="sm">
                <Link to="/settings/managed-applications">
                  <Settings2 className="size-4" />
                  Manage deployment
                </Link>
              </Button>
            </SettingsRow>
            <CopyableSettingsRow label="URL" value={kestra?.url} external />
            <SettingsRow
              label="MCP server"
              description={
                kestra?.managedMcpMessage ??
                "Kestra control MCP registration for ThinkWork agents."
              }
            >
              <Badge
                variant={
                  kestra?.managedMcpStatus === "installed"
                    ? "default"
                    : "secondary"
                }
              >
                {kestra?.managedMcpStatus ?? "not_ready"}
              </Badge>
              {kestra?.managedMcpInstallAvailable ? (
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
            <SettingsRow
              label="Supported runtime"
              description="AWS ECS/Fargate standalone Kestra with Postgres queue/repository and S3 internal storage."
            />
            <SettingsRow
              label="Unsupported execution"
              description="Docker socket, Docker-in-Docker, privileged containers, EC2 worker pools, and arbitrary host/container task classes are outside v1."
            />
            <SettingsRow
              label="Namespace policy"
              description="Agents use ThinkWork-approved namespaces through the managed control MCP."
            />
            <SettingsRow label="Stage">
              {deployment?.stage ?? "..."}
            </SettingsRow>
            <SettingsRow label="Region">
              {deployment?.region ?? "..."}
            </SettingsRow>
          </SettingsSection>

          <SettingsSection label="Service details">
            <CopyableSettingsRow label="Cluster" value={kestra?.clusterArn} />
            <ValueListRow
              label="Services"
              values={kestra?.serviceNames ?? []}
            />
            <ValueListRow label="Logs" values={kestra?.logGroupNames ?? []} />
            <CopyableSettingsRow
              label="Storage bucket"
              value={kestra?.storageBucketName}
            />
            <CopyableSettingsRow
              label="Database"
              value={kestra?.databaseName}
            />
            <CopyableSettingsRow label="Load balancer" value={kestra?.albArn} />
            <CopyableSettingsRow
              label="Target group"
              value={kestra?.targetGroupArn}
            />
          </SettingsSection>

          <SettingsSection label="Health">
            <SettingsRow
              label="Connection test"
              description="Probe the public Kestra endpoint through the ThinkWork API."
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!kestra?.runtimeEnabled || healthResult.fetching}
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

          {kestra?.provisioned ? (
            <SettingsSection label="Lifecycle">
              <SettingsRow
                label="Deployment actions"
                description="Plan deploy, park, destructive teardown, release updates, and evidence review from Managed Applications."
              >
                <Button asChild type="button" variant="outline" size="sm">
                  <Link to="/settings/managed-applications">
                    <Settings2 className="size-4" />
                    Manage
                  </Link>
                </Button>
              </SettingsRow>
            </SettingsSection>
          ) : null}
        </>
      )}
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
