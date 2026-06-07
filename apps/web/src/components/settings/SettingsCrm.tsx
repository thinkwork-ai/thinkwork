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
  const [installMcpState, installMcpServer] = useMutation(
    SettingsInstallManagedApplicationMcpServerMutation,
  );

  const deployment = statusResult.data?.deploymentStatus;
  const crm = deployment?.managedApplications.find(
    (app) => app.key === "twenty",
  );
  const statusLabel = crm?.status ?? "...";
  const deploymentDescription =
    crm?.message ?? "Runtime state from deployment status.";

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
              <Badge variant={crm?.runtimeEnabled ? "default" : "secondary"}>
                {statusLabel}
              </Badge>
              <Button asChild type="button" variant="outline" size="sm">
                <Link to="/settings/managed-applications">
                  <Settings2 className="size-4" />
                  Manage deployment
                </Link>
              </Button>
            </SettingsRow>
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
            <SettingsSection label="Lifecycle">
              <SettingsRow
                label="Deployment actions"
                description="Plan deploy, destructive teardown, release updates, and evidence review from Managed Applications."
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
