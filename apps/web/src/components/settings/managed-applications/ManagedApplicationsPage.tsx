import { useQuery } from "urql";
import { Button } from "@thinkwork/ui";
import { RefreshCw } from "lucide-react";
import { ManagedApplicationRow } from "./ManagedApplicationRow";
import {
  SettingsDeploymentStatusQuery,
  SettingsManagedApplicationsQuery,
} from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsPane,
  SettingsSection,
} from "@/components/settings/SettingsContent";

export function ManagedApplicationsPage() {
  const [appsResult, refreshApps] = useQuery({
    query: SettingsManagedApplicationsQuery,
    requestPolicy: "cache-and-network",
  });
  const [statusResult, refreshStatus] = useQuery({
    query: SettingsDeploymentStatusQuery,
    requestPolicy: "cache-and-network",
  });

  const apps = appsResult.data?.managedApplications ?? [];
  const runtimeApps =
    statusResult.data?.deploymentStatus.managedApplications ?? [];
  const loading = appsResult.fetching && apps.length === 0;
  const unavailable = appsResult.error || statusResult.error;
  const refreshing = appsResult.fetching || statusResult.fetching;

  function refreshAll() {
    refreshApps({ requestPolicy: "network-only" });
    refreshStatus({ requestPolicy: "network-only" });
  }

  return (
    <SettingsPane className="max-w-none">
      <SettingsHeader
        title="Applications"
        description="Plan, approve, monitor, and tear down customer-owned Cognee and Twenty deployments."
        actions={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={refreshAll}
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw
              className={`size-4${refreshing ? " animate-spin" : ""}`}
            />
          </Button>
        }
      />

      {unavailable ? (
        <SettingsSection>
          <div className="p-4 text-sm text-muted-foreground">
            Managed application status is unavailable.
          </div>
        </SettingsSection>
      ) : (
        <SettingsSection>
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground">
              Loading managed applications...
            </div>
          ) : apps.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              No managed applications are available for this deployment.
            </div>
          ) : (
            apps.map((app) => {
              const runtime = runtimeApps.find(
                (candidate) => candidate.key === app.key,
              );
              return (
                <ManagedApplicationRow
                  key={app.key}
                  app={app}
                  runtime={runtime}
                />
              );
            })
          )}
        </SettingsSection>
      )}
    </SettingsPane>
  );
}
