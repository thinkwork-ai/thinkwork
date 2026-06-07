import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { Button } from "@thinkwork/ui";
import { RefreshCw } from "lucide-react";
import { ManagedApplicationRow } from "./ManagedApplicationRow";
import { ManagedApplicationPlanDialog } from "./ManagedApplicationPlanDialog";
import {
  asManagedAppKey,
  terminalJobStatus,
  type ManagedApplicationJob,
} from "./types";
import {
  SettingsDeploymentStatusQuery,
  SettingsManagedApplicationDeploymentQuery,
  SettingsManagedApplicationsQuery,
  SettingsStartManagedApplicationPlanMutation,
} from "@/lib/settings-queries";
import {
  SettingsHeader,
  SettingsPane,
  SettingsSection,
} from "@/components/settings/SettingsContent";

export function ManagedApplicationsPage() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [optimisticJob, setOptimisticJob] =
    useState<ManagedApplicationJob | null>(null);
  const [appsResult, refreshApps] = useQuery({
    query: SettingsManagedApplicationsQuery,
    requestPolicy: "cache-and-network",
  });
  const [statusResult, refreshStatus] = useQuery({
    query: SettingsDeploymentStatusQuery,
    requestPolicy: "cache-and-network",
  });
  const [jobResult, refreshJob] = useQuery({
    query: SettingsManagedApplicationDeploymentQuery,
    variables: { jobId: selectedJobId ?? "" },
    pause: !selectedJobId,
    requestPolicy: "cache-and-network",
  });
  const [planState, startPlan] = useMutation(
    SettingsStartManagedApplicationPlanMutation,
  );

  const apps = appsResult.data?.managedApplications ?? [];
  const runtimeApps =
    statusResult.data?.deploymentStatus.managedApplications ?? [];
  const selectedJob =
    jobResult.data?.managedApplicationDeployment ?? optimisticJob ?? null;
  const loading = appsResult.fetching && apps.length === 0;
  const unavailable = appsResult.error || statusResult.error;

  useEffect(() => {
    if (!selectedJob || terminalJobStatus(selectedJob.status)) return;
    const timer = window.setInterval(() => {
      refreshJob({ requestPolicy: "network-only" });
      refreshApps({ requestPolicy: "network-only" });
      refreshStatus({ requestPolicy: "network-only" });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [
    refreshApps,
    refreshJob,
    refreshStatus,
    selectedJob?.id,
    selectedJob?.status,
  ]);

  const latestJobsByKey = useMemo(() => {
    const result = new Map<string, ManagedApplicationJob>();
    if (selectedJob) result.set(selectedJob.appKey, selectedJob);
    return result;
  }, [selectedJob]);

  async function startManagedPlan(key: string, operation: string) {
    const appKey = asManagedAppKey(key);
    const idempotencyKey = [
      "spaces",
      appKey,
      operation.toLowerCase(),
      Date.now().toString(36),
    ].join("-");
    const result = await startPlan({
      input: {
        key: appKey,
        operation,
        desiredConfigVersion: "v1",
        desiredConfig: {},
        idempotencyKey,
      },
    });
    if (result.error) {
      toast.error(
        `Could not start ${operation.toLowerCase()} plan: ${result.error.message}`,
      );
      return;
    }
    const job = result.data?.startManagedApplicationPlan;
    if (!job) return;
    setSelectedJobId(job.id);
    setOptimisticJob(job);
    setDialogOpen(true);
    toast.success(
      `${appLabel(appKey)} ${operation.toLowerCase()} plan started.`,
    );
    refreshApps({ requestPolicy: "network-only" });
  }

  function refreshAll() {
    refreshApps({ requestPolicy: "network-only" });
    refreshStatus({ requestPolicy: "network-only" });
    if (selectedJobId) refreshJob({ requestPolicy: "network-only" });
  }

  return (
    <SettingsPane className="max-w-none">
      <SettingsHeader
        title="Managed Applications"
        description="Plan, approve, monitor, and tear down customer-owned Cognee and Twenty deployments."
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refreshAll}
          >
            <RefreshCw className="size-4" />
            Refresh
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
        <SettingsSection label="Applications">
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
              const latestJob =
                latestJobsByKey.get(app.key) ??
                (selectedJob?.appKey === app.key ? selectedJob : null);
              return (
                <ManagedApplicationRow
                  key={app.key}
                  app={app}
                  runtime={runtime}
                  latestJob={latestJob}
                  busy={planState.fetching}
                  onStartPlan={(operation) =>
                    void startManagedPlan(app.key, operation)
                  }
                  onOpenPlan={() => {
                    const jobId = app.lastJobId ?? latestJob?.id;
                    if (jobId) setSelectedJobId(jobId);
                    setDialogOpen(true);
                  }}
                />
              );
            })
          )}
        </SettingsSection>
      )}

      <ManagedApplicationPlanDialog
        job={selectedJob}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onJobChanged={(job) => {
          setOptimisticJob(job);
          setSelectedJobId(job.id);
          refreshApps({ requestPolicy: "network-only" });
          refreshStatus({ requestPolicy: "network-only" });
        }}
      />
    </SettingsPane>
  );
}

function appLabel(key: string): string {
  return key === "twenty" ? "Twenty CRM" : "Cognee";
}
