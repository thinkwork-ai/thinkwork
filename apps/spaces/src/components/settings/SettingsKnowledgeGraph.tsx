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
  Switch,
} from "@thinkwork/ui";
import { Copy } from "lucide-react";
import {
  SettingsDeploymentStatusQuery,
  SettingsSetKnowledgeGraphDeploymentMutation,
} from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsPane,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/SettingsContent";

export function SettingsKnowledgeGraph() {
  const [disableOpen, setDisableOpen] = useState(false);
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);
  const [result, refetch] = useQuery({ query: SettingsDeploymentStatusQuery });
  const [deploymentState, setDeployment] = useMutation(
    SettingsSetKnowledgeGraphDeploymentMutation,
  );

  const status = result.data?.deploymentStatus;
  const desiredEnabled = pendingEnabled ?? Boolean(status?.cogneeEnabled);
  const queued =
    pendingEnabled !== null &&
    pendingEnabled !== Boolean(status?.cogneeEnabled);

  async function requestDeployment(enabled: boolean) {
    const deployment = await setDeployment({ enabled });
    if (deployment.error) {
      toast.error(
        `Could not ${enabled ? "enable" : "disable"} Knowledge Graph: ${deployment.error.message}`,
      );
      return;
    }

    setPendingEnabled(enabled);
    setDisableOpen(false);
    toast.success(
      deployment.data?.setKnowledgeGraphDeployment.message ??
        `Knowledge Graph ${enabled ? "enable" : "disable"} deployment queued.`,
    );
    refetch({ requestPolicy: "network-only" });
  }

  const statusLabel = queued
    ? "deployment queued"
    : status?.cogneeEnabled
      ? "enabled"
      : "disabled";

  return (
    <SettingsPane>
      <SettingsHeader
        title="Knowledge Graph"
        description="Cognee infrastructure for ontology and graph retrieval."
      />

      <SettingsSection label="Deployment">
        {result.error ? (
          <div className="p-4 text-sm text-muted-foreground">
            Knowledge Graph status unavailable.
          </div>
        ) : (
          <>
            <SettingsRow
              label="Cognee"
              description="Provision or remove the stage Knowledge Graph service through Terraform."
            >
              <Switch
                checked={desiredEnabled}
                disabled={deploymentState.fetching || result.fetching}
                aria-label="Toggle Knowledge Graph infrastructure"
                onCheckedChange={(checked) => {
                  if (checked) {
                    void requestDeployment(true);
                  } else {
                    setDisableOpen(true);
                  }
                }}
              />
            </SettingsRow>
            <SettingsRow label="Status">
              <Badge
                variant={
                  status?.cogneeEnabled || queued ? "default" : "secondary"
                }
              >
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
          {pendingEnabled !== null ? (
            <SettingsRow label="Requested state">
              {pendingEnabled ? "enabled" : "disabled"}
            </SettingsRow>
          ) : null}
        </SettingsSection>
      ) : null}

      <AlertDialog open={disableOpen} onOpenChange={setDisableOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable Knowledge Graph?</AlertDialogTitle>
            <AlertDialogDescription>
              This queues a Terraform deployment that removes the Cognee service
              for the current stage. Export graph data first if it needs to be
              retained.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void requestDeployment(false)}
              disabled={deploymentState.fetching}
            >
              Disable
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPane>
  );
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
