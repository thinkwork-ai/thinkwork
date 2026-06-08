import { useEffect, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { Button } from "@thinkwork/ui";
import { Play, RotateCw, Trash2 } from "lucide-react";
import { ManagedApplicationPlanDialog } from "./ManagedApplicationPlanDialog";
import {
  appDisplayName,
  terminalJobStatus,
  type ManagedAppKey,
  type ManagedApplicationJob,
} from "./types";
import {
  SettingsDeploymentStatusQuery,
  SettingsManagedApplicationDeploymentQuery,
  SettingsManagedApplicationsQuery,
  SettingsStartManagedApplicationPlanMutation,
} from "@/lib/settings-queries";

/**
 * Header actions for a managed application's detail page: view the latest plan,
 * plan a deploy (when not yet running), and plan a teardown (when provisioned).
 * Self-contained — queries its own app + runtime state by key — so detail pages
 * just drop it into their header.
 */
export function ManagedApplicationLifecycleActions({
  appKey,
}: {
  appKey: ManagedAppKey;
}) {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [optimisticJob, setOptimisticJob] =
    useState<ManagedApplicationJob | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [planState, startPlan] = useMutation(
    SettingsStartManagedApplicationPlanMutation,
  );
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

  const app = appsResult.data?.managedApplications?.find(
    (candidate) => candidate.key === appKey,
  );
  const runtime = statusResult.data?.deploymentStatus.managedApplications.find(
    (candidate) => candidate.key === appKey,
  );
  const job = jobResult.data?.managedApplicationDeployment ?? optimisticJob;

  const runtimeEnabled =
    runtime?.runtimeEnabled ?? app?.currentStatus === "running";
  const provisioned = runtime?.provisioned ?? runtimeEnabled;
  const canDeploy = !runtimeEnabled;
  const canDestroy = provisioned || runtimeEnabled;
  const hasJob = !!app?.lastJobId || !!job;
  const label = appDisplayName(appKey);

  useEffect(() => {
    if (!job || terminalJobStatus(job.status)) return;
    const timer = window.setInterval(() => {
      refreshJob({ requestPolicy: "network-only" });
      refreshApps({ requestPolicy: "network-only" });
      refreshStatus({ requestPolicy: "network-only" });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshApps, refreshJob, refreshStatus, job?.id, job?.status]);

  async function startOperation(operation: "ENABLE" | "DESTROY") {
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
    const started = result.data?.startManagedApplicationPlan;
    if (!started) return;
    setSelectedJobId(started.id);
    setOptimisticJob(started);
    setDialogOpen(true);
    toast.success(`${label} ${operation.toLowerCase()} plan started.`);
    refreshApps({ requestPolicy: "network-only" });
    refreshStatus({ requestPolicy: "network-only" });
  }

  function openPlan() {
    const jobId = app?.lastJobId ?? job?.id;
    if (jobId) setSelectedJobId(jobId);
    setDialogOpen(true);
  }

  return (
    <div className="flex items-center gap-1">
      {hasJob ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="View plan"
          title="View plan"
          onClick={openPlan}
        >
          <RotateCw className="size-4" />
        </Button>
      ) : null}
      {canDeploy ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Plan deploy ${label}`}
          title="Plan deploy"
          disabled={planState.fetching}
          onClick={() => void startOperation("ENABLE")}
        >
          <Play className="size-4" />
        </Button>
      ) : null}
      {canDestroy ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-destructive hover:text-destructive"
          aria-label={`Plan destroy ${label}`}
          title="Plan destroy"
          disabled={planState.fetching}
          onClick={() => void startOperation("DESTROY")}
        >
          <Trash2 className="size-4" />
        </Button>
      ) : null}
      <ManagedApplicationPlanDialog
        job={job}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onJobChanged={(next) => {
          setOptimisticJob(next);
          setSelectedJobId(next.id);
          refreshApps({ requestPolicy: "network-only" });
          refreshStatus({ requestPolicy: "network-only" });
        }}
      />
    </div>
  );
}
