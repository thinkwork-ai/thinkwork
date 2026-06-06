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
  asManagedAppKey,
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
  const key = asManagedAppKey(job?.appKey ?? "cognee");
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
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
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

        {!job ? (
          <p className="text-sm text-muted-foreground">
            Start a managed application plan to review it here.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <PlanFact label="Status" value={job.status} />
              <PlanFact label="Operation" value={job.operation} />
              <PlanFact label="Release" value={job.releaseVersion} />
              <PlanFact label="Config" value={job.desiredConfigVersion} />
              <PlanFact label="Manifest digest" value={job.manifestDigest} />
              <PlanFact label="Plan digest" value={job.planDigest ?? "..."} />
            </div>

            <section className="rounded-md border border-border bg-muted/20 p-3">
              <div className="mb-2 flex items-center gap-2">
                <p className="text-sm font-medium text-foreground">
                  Data impact
                </p>
                <Badge
                  variant={dataImpact.destructive ? "destructive" : "outline"}
                >
                  {dataImpact.destructive ? "destructive" : "non-destructive"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {dataImpact.summary ?? "No destructive data impact reported."}
              </p>
              {dataImpact.resources?.length ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {dataImpact.resources.map((resource) => (
                    <li key={resource}>{resource}</li>
                  ))}
                </ul>
              ) : null}
            </section>

            {dataImpact.destructive ? (
              <section className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
                <label className="flex items-start gap-2 text-sm text-foreground">
                  <Checkbox
                    checked={ack}
                    onCheckedChange={(checked) => setAck(checked === true)}
                    aria-label="Acknowledge destructive data impact"
                  />
                  <span>
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

            <section>
              <h3 className="mb-2 text-sm font-medium text-foreground">
                Timeline
              </h3>
              <ManagedApplicationJobTimeline job={job} />
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium text-foreground">
                Evidence
              </h3>
              <ManagedApplicationEvidenceLinks jobId={job.id} />
            </section>
          </div>
        )}

        <DialogFooter>
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
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-all text-sm text-foreground">{value}</p>
    </div>
  );
}
