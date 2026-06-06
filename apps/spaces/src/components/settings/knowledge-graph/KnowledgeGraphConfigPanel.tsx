import { useQuery } from "urql";
import { toast } from "sonner";
import { Badge, Button } from "@thinkwork/ui";
import { Copy, RefreshCw } from "lucide-react";
import {
  SettingsDeploymentStatusQuery,
  SettingsKnowledgeGraphHealthCheckQuery,
} from "@/lib/settings-queries";
import {
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

export function KnowledgeGraphConfigPanel() {
  const [result] = useQuery({ query: SettingsDeploymentStatusQuery });
  const [healthResult, runHealthCheck] = useQuery({
    query: SettingsKnowledgeGraphHealthCheckQuery,
    pause: true,
    requestPolicy: "network-only",
  });

  const status = result.data?.deploymentStatus;
  const statusLabel = status?.cogneeEnabled ? "enabled" : "disabled";

  return (
    <div className="max-w-[750px]">
      <SettingsSection label="Deployment">
        {result.error ? (
          <div className="p-4 text-sm text-muted-foreground">
            Knowledge Graph status unavailable.
          </div>
        ) : (
          <>
            <SettingsRow
              label="Status"
              description="Managed application state reported by deployment status."
            >
              <Badge variant={status?.cogneeEnabled ? "default" : "secondary"}>
                {status ? statusLabel : "..."}
              </Badge>
            </SettingsRow>
            <SettingsRow label="Stage">{status?.stage ?? "..."}</SettingsRow>
            <SettingsRow label="Region">{status?.region ?? "..."}</SettingsRow>
            <SettingsRow label="Backend">
              {status?.cogneeBackendMode ?? "..."}
            </SettingsRow>
          </>
        )}
      </SettingsSection>

      {!result.error ? (
        <SettingsSection label="Service details">
          <SettingsRow label="Service">
            {status?.cogneeServiceName ?? "Not provisioned"}
          </SettingsRow>
          <SettingsRow label="Cluster">
            {status?.cogneeClusterArn ? (
              <span
                className="max-w-md truncate"
                title={status.cogneeClusterArn}
              >
                {status.cogneeClusterArn}
              </span>
            ) : (
              "Not provisioned"
            )}
          </SettingsRow>
          <CopyableSettingsRow
            label="Endpoint"
            value={status?.cogneeEndpoint}
          />
          <CopyableSettingsRow
            label="Logs"
            value={status?.cogneeLogGroupName}
          />
          <SettingsRow
            label="Connection test"
            description="Probe the private Cognee /health endpoint through the Thinkwork API."
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!status?.cogneeEnabled || healthResult.fetching}
              onClick={() => runHealthCheck({ requestPolicy: "network-only" })}
            >
              <RefreshCw className="size-4" />
              Test connection
            </Button>
          </SettingsRow>
          {healthResult.data?.knowledgeGraphHealthCheck ? (
            <SettingsRow label="Last test">
              <Badge
                variant={
                  healthResult.data.knowledgeGraphHealthCheck.healthy
                    ? "default"
                    : "destructive"
                }
              >
                {healthResult.data.knowledgeGraphHealthCheck.healthy
                  ? "healthy"
                  : "unhealthy"}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {formatHealthCheck(healthResult.data.knowledgeGraphHealthCheck)}
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
      ) : null}
    </div>
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

function CopyableSettingsRow({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  if (!value) {
    return <SettingsRow label={label}>Not provisioned</SettingsRow>;
  }

  return (
    <SettingsRow label={label}>
      <span className="max-w-sm truncate" title={value}>
        {value}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Copy ${label}`}
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
