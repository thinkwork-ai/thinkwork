import { useEffect, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { Button } from "@thinkwork/ui";
import { Trash2 } from "lucide-react";
import { ManagedApplicationPlanDialog } from "./ManagedApplicationPlanDialog";
import {
  appDisplayName,
  terminalJobStatus,
  type ManagedAppKey,
  type ManagedApplicationJob,
} from "./types";
import {
  SettingsManagedApplicationDeploymentQuery,
  SettingsStartManagedApplicationPlanMutation,
} from "@/lib/settings-queries";

/**
 * Header action that starts (and walks through) a teardown plan for a managed
 * application. Lives on each app's detail page so destruction is initiated from
 * the app you're looking at, not a shared list.
 */
export function ManagedApplicationDestroyButton({
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
  const [jobResult, refreshJob] = useQuery({
    query: SettingsManagedApplicationDeploymentQuery,
    variables: { jobId: selectedJobId ?? "" },
    pause: !selectedJobId,
    requestPolicy: "cache-and-network",
  });

  const job = jobResult.data?.managedApplicationDeployment ?? optimisticJob;

  useEffect(() => {
    if (!job || terminalJobStatus(job.status)) return;
    const timer = window.setInterval(() => {
      refreshJob({ requestPolicy: "network-only" });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshJob, job?.id, job?.status]);

  async function startDestroy() {
    const idempotencyKey = [
      "spaces",
      appKey,
      "destroy",
      Date.now().toString(36),
    ].join("-");
    const result = await startPlan({
      input: {
        key: appKey,
        operation: "DESTROY",
        desiredConfigVersion: "v1",
        desiredConfig: {},
        idempotencyKey,
      },
    });
    if (result.error) {
      toast.error(`Could not start destroy plan: ${result.error.message}`);
      return;
    }
    const started = result.data?.startManagedApplicationPlan;
    if (!started) return;
    setSelectedJobId(started.id);
    setOptimisticJob(started);
    setDialogOpen(true);
    toast.success(`${appDisplayName(appKey)} destroy plan started.`);
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="text-destructive hover:text-destructive"
        aria-label={`Destroy ${appDisplayName(appKey)}`}
        title={`Destroy ${appDisplayName(appKey)}`}
        disabled={planState.fetching}
        onClick={() => void startDestroy()}
      >
        <Trash2 className="size-4" />
      </Button>
      <ManagedApplicationPlanDialog
        job={job}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onJobChanged={(next) => {
          setOptimisticJob(next);
          setSelectedJobId(next.id);
        }}
      />
    </>
  );
}
