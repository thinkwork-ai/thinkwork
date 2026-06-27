import { useEffect, useRef, useState } from "react";
import { useQuery } from "urql";
import { Button } from "@thinkwork/ui";
import { RefreshCw } from "lucide-react";
import { ManagedApplicationRow } from "./ManagedApplicationRow";
import {
  SettingsDeploymentStatusQuery,
  SettingsManagedApplicationsQuery,
  SettingsPluginInstallsQuery,
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
  const [installsResult] = useQuery({
    query: SettingsPluginInstallsQuery,
    requestPolicy: "cache-and-network",
  });

  // Transition IA: once an app has a plugin install, Plugins owns the lifecycle
  // home and this legacy managed-app list hides that backing app row. Query
  // failures keep legacy rows visible so operators do not lose access.
  const pluginInstalls = installsResult.data?.pluginInstalls ?? [];
  const twentyPluginInstalled = pluginInstalls.some(
    (install) => install.pluginKey === "twenty",
  );
  const companyBrainPluginInstalled = pluginInstalls.some(
    (install) => install.pluginKey === "company-brain",
  );

  const allApps = appsResult.data?.managedApplications ?? [];
  const apps = allApps.filter((app) => {
    if (twentyPluginInstalled && app.key === "twenty") return false;
    if (companyBrainPluginInstalled && app.key === "cognee") return false;
    return true;
  });
  const runtimeApps =
    statusResult.data?.deploymentStatus.managedApplications ?? [];
  const loading = appsResult.fetching && apps.length === 0;
  const unavailable = appsResult.error || statusResult.error;

  // Spin only in response to an explicit refresh click — not the ambient
  // cache-and-network background fetch of the heavy deploymentStatus query,
  // which otherwise keeps the icon spinning on page load with no user action.
  const [refreshing, setRefreshing] = useState(false);
  const anyFetching = appsResult.fetching || statusResult.fetching;
  const wasFetching = useRef(anyFetching);
  useEffect(() => {
    if (wasFetching.current && !anyFetching) setRefreshing(false);
    wasFetching.current = anyFetching;
  }, [anyFetching]);

  function refreshAll() {
    setRefreshing(true);
    refreshApps({ requestPolicy: "network-only" });
    refreshStatus({ requestPolicy: "network-only" });
  }

  return (
    <SettingsPane className="max-w-none">
      <SettingsHeader
        title="Applications"
        description="Legacy managed-application operations. ThinkWork Brain and Twenty CRM move to Plugins once installed."
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
