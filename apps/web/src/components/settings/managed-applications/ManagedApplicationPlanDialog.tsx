import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@thinkwork/ui";
import { toast } from "sonner";
import { ManagedApplicationJobTimeline } from "./ManagedApplicationJobTimeline";
import { ManagedApplicationEvidenceLinks } from "./ManagedApplicationEvidenceLinks";
import {
  appDisplayName,
  destructiveConfirmationFor,
  parseDataImpact,
  type ManagedApplicationJob,
} from "./types";
import {
  SettingsApproveManagedApplicationDeploymentMutation,
  SettingsRejectManagedApplicationDeploymentMutation,
} from "@/lib/settings-queries";
import { useMutation } from "urql";

export function ManagedApplicationPlanDialog({
  job,
  open,
  onOpenChange,
  onJobChanged,
}: {
  job?: ManagedApplicationJob | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJobChanged?: (job: ManagedApplicationJob) => void;
}) {
  const [approveState, approve] = useMutation(
    SettingsApproveManagedApplicationDeploymentMutation,
  );
  const [rejectState, reject] = useMutation(
    SettingsRejectManagedApplicationDeploymentMutation,
  );
  const [ack, setAck] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  const dataImpact = useMemo(
    () => parseDataImpact(job?.dataImpact),
    [job?.dataImpact],
  );
  // Raw string key: plugin-created jobs reuse this dialog, so the key is
  // no longer coerced into the closed ManagedAppKey union.
  const key = job?.appKey ?? "cognee";
  const destructiveConfirmation = destructiveConfirmationFor(key);
  const ready = !!job?.planDigest && job.status === "awaiting_approval";
  const destructiveReady =
    !dataImpact.destructive ||
    (ack && confirmation.trim() === destructiveConfirmation);
  const approvalDisabled =
    !job ||
    !ready ||
    !destructiveReady ||
    approveState.fetching ||
    rejectState.fetching;

  async function approveJob() {
    if (!job?.planDigest) return;
    const result = await approve({
      input: {
        jobId: job.id,
        planDigest: job.planDigest,
        manifestDigest: job.manifestDigest,
        destructiveConfirmation: dataImpact.destructive
          ? destructiveConfirmation
          : null,
      },
    });
    if (result.error) {
      toast.error(`Could not approve deployment: ${result.error.message}`);
      return;
    }
    if (result.data?.approveManagedApplicationDeployment) {
      onJobChanged?.(result.data.approveManagedApplicationDeployment);
    }
    toast.success(`${appDisplayName(key)} deployment approved.`);
  }

  async function rejectJob() {
    if (!job) return;
    const result = await reject({
      input: {
        jobId: job.id,
        reason: "Rejected from Spaces managed application plan dialog.",
      },
    });
    if (result.error) {
      toast.error(`Could not reject deployment: ${result.error.message}`);
      return;
    }
    if (result.data?.rejectManagedApplicationDeployment) {
      onJobChanged?.(result.data.rejectManagedApplicationDeployment);
    }
    toast.success(`${appDisplayName(key)} deployment rejected.`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-none flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {job
              ? `${appDisplayName(key)} ${job.operation}`
              : "Deployment plan"}
          </DialogTitle>
          <DialogDescription>
            Review the plan digest, release, affected data, events, and evidence
            before approving.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto overflow-x-hidden pr-1">
          {!job ? (
            <p className="text-sm text-muted-foreground">
              Start a managed application plan to review it here.
            </p>
          ) : (
            <div className="min-w-0 space-y-4">
              <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                <PlanFact label="Status" value={job.status} />
                <PlanFact label="Operation" value={job.operation} />
                <PlanFact label="Release" value={job.releaseVersion} />
                <PlanFact label="Config" value={job.desiredConfigVersion} />
                <PlanFact label="Manifest digest" value={job.manifestDigest} />
                <PlanFact label="Plan digest" value={job.planDigest ?? "..."} />
              </div>

              <section className="min-w-0 rounded-md border border-border bg-muted/20 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-foreground">
                    Data impact
                  </p>
                  <Badge
                    variant={
                      dataImpact.destructive ? "destructive" : "outline"
                    }
                  >
                    {dataImpact.destructive
                      ? "destructive"
                      : "non-destructive"}
                  </Badge>
                </div>
                <p className="text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                  {dataImpact.summary ??
                    "No destructive data impact reported."}
                </p>
                {dataImpact.resources?.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {dataImpact.resources.map((resource) => (
                      <li className="[overflow-wrap:anywhere]" key={resource}>
                        {resource}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>

              {dataImpact.destructive ? (
                <section className="min-w-0 rounded-md border border-destructive/30 bg-destructive/10 p-3">
                  <label className="flex items-start gap-2 text-sm text-foreground">
                    <Checkbox
                      checked={ack}
                      onCheckedChange={(checked) => setAck(checked === true)}
                      aria-label="Acknowledge destructive data impact"
                    />
                    <span className="[overflow-wrap:anywhere]">
                      I understand this destroys application data and resources
                      for {appDisplayName(key)}.
                    </span>
                  </label>
                  <Input
                    className="mt-3"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    placeholder={destructiveConfirmation}
                    aria-label="Destructive confirmation"
                  />
                </section>
              ) : null}

              <section className="min-w-0">
                <h3 className="mb-2 text-sm font-medium text-foreground">
                  Timeline
                </h3>
                <ManagedApplicationJobTimeline job={job} />
              </section>

              <section className="min-w-0">
                <h3 className="mb-2 text-sm font-medium text-foreground">
                  Evidence
                </h3>
                <ManagedApplicationEvidenceLinks
                  jobId={job.id}
                  fallbackBucket={job.evidenceBucket}
                  fallbackPrefix={job.evidencePrefix}
                />
              </section>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-border pt-4">
          {job?.status === "awaiting_approval" ? (
            <Button
              type="button"
              variant="outline"
              disabled={approveState.fetching || rejectState.fetching}
              onClick={() => void rejectJob()}
            >
              Reject
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={approvalDisabled}
            variant={dataImpact.destructive ? "destructive" : "default"}
            onClick={() => void approveJob()}
          >
            {dataImpact.destructive
              ? "Destroy application and data"
              : "Deploy application"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlanFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-background px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-[13px] leading-5 text-foreground [overflow-wrap:anywhere]">
        {value}
      </p>
    </div>
  );
}
