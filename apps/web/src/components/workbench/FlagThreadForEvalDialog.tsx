/**
 * Flag-for-evaluation dialog (Evaluations Trust Core U7).
 *
 * Lets a tenant operator flag a completed thread turn into a custom eval
 * dataset with a required resolution target. The mutation snapshots the
 * raw conversation into a long-lived S3 artifact — the dialog discloses
 * that explicitly before submit. Server-side the mutation is
 * operator-gated (requireTenantAdmin on the thread's tenant); this
 * component assumes its trigger affordances are already operator-gated
 * (TenantContext.isOperator) and the server is the enforcement layer.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from "@thinkwork/ui";
import {
  EvalDatasetsForFlagQuery,
  FlagThreadForEvalMutation,
} from "@/lib/evaluation-queries";

const CREATE_NEW_VALUE = "__create-new__";

export interface FlagThreadForEvalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  threadId: string;
  /** The completed turn being flagged; null disables submit. */
  turnId: string | null;
}

export function FlagThreadForEvalDialog({
  open,
  onOpenChange,
  tenantId,
  threadId,
  turnId,
}: FlagThreadForEvalDialogProps) {
  const navigate = useNavigate();
  const [{ data: datasetsData }] = useQuery({
    query: EvalDatasetsForFlagQuery,
    variables: { tenantId },
    pause: !open || !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [{ fetching: submitting }, flagThread] = useMutation(
    FlagThreadForEvalMutation,
  );

  // Baseline is never a flag target; archived datasets are not writable.
  const customDatasets = useMemo(
    () =>
      (datasetsData?.evalDatasets ?? []).filter(
        (dataset) => dataset.kind === "custom" && !dataset.archivedAt,
      ),
    [datasetsData?.evalDatasets],
  );

  const [datasetChoice, setDatasetChoice] = useState<string>(CREATE_NEW_VALUE);
  const [newDatasetName, setNewDatasetName] = useState("");
  const [resolutionTarget, setResolutionTarget] = useState("");
  const [outcomeKind, setOutcomeKind] = useState<"quality" | "security">(
    "quality",
  );

  // Reset per open so a second flag never inherits stale form state.
  useEffect(() => {
    if (!open) return;
    setDatasetChoice(CREATE_NEW_VALUE);
    setNewDatasetName("");
    setResolutionTarget("");
    setOutcomeKind("quality");
  }, [open]);

  // Default to the first existing custom dataset once the list arrives.
  useEffect(() => {
    if (!open) return;
    if (datasetChoice === CREATE_NEW_VALUE && customDatasets.length > 0) {
      setDatasetChoice(customDatasets[0].slug);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customDatasets.length]);

  const creatingNew = datasetChoice === CREATE_NEW_VALUE;
  const canSubmit =
    !submitting &&
    Boolean(turnId) &&
    resolutionTarget.trim().length > 0 &&
    (creatingNew ? newDatasetName.trim().length > 0 : Boolean(datasetChoice));

  async function handleSubmit() {
    if (!canSubmit || !turnId) return;
    try {
      const result = await flagThread({
        input: {
          threadId,
          turnId,
          datasetSlug: creatingNew ? null : datasetChoice,
          newDatasetName: creatingNew ? newDatasetName.trim() : null,
          resolutionTarget: resolutionTarget.trim(),
          outcomeKind,
        },
      });
      if (result.error) {
        toast.error(`Could not flag thread: ${result.error.message}`);
        return;
      }
      const payload = result.data?.flagThreadForEval;
      const completeness = payload?.completeness;
      const gaps: string[] = [];
      if (completeness && !completeness.workspace)
        gaps.push("no workspace snapshot");
      if (completeness && !completeness.traces) gaps.push("no tool traces");
      if (completeness?.truncated)
        gaps.push("history truncated at the size cap");
      toast.success(
        `Flagged into ${payload?.dataset.name ?? payload?.dataset.slug ?? "the dataset"}.`,
        {
          description:
            gaps.length > 0 ? `Captured with: ${gaps.join(", ")}.` : undefined,
          action: {
            label: "Open Evaluations",
            onClick: () =>
              void navigate({ to: "/settings/evaluations/studio" }),
          },
        },
      );
      onOpenChange(false);
    } catch (err) {
      console.error("[FlagThreadForEvalDialog] flag failed", err);
      toast.error(
        `Could not flag thread: ${err instanceof Error ? err.message : "unknown error"}`,
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="flag-thread-eval-dialog">
        <DialogHeader>
          <DialogTitle>Flag for evaluation</DialogTitle>
          <DialogDescription>
            Turn this conversation into an evaluation case so the fix can be
            verified against the current agent.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="flag-eval-dataset">Dataset</Label>
            <Select value={datasetChoice} onValueChange={setDatasetChoice}>
              <SelectTrigger
                id="flag-eval-dataset"
                data-testid="flag-eval-dataset-trigger"
              >
                <SelectValue placeholder="Choose a dataset" />
              </SelectTrigger>
              <SelectContent>
                {customDatasets.map((dataset) => (
                  <SelectItem key={dataset.id} value={dataset.slug}>
                    {dataset.name ?? dataset.slug}
                  </SelectItem>
                ))}
                <SelectItem value={CREATE_NEW_VALUE}>
                  Create new dataset…
                </SelectItem>
              </SelectContent>
            </Select>
            {creatingNew ? (
              <Input
                aria-label="New dataset name"
                data-testid="flag-eval-new-dataset-name"
                placeholder="New dataset name"
                value={newDatasetName}
                onChange={(event) => setNewDatasetName(event.target.value)}
              />
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="flag-eval-resolution-target">
              Resolution target
            </Label>
            <Textarea
              id="flag-eval-resolution-target"
              data-testid="flag-eval-resolution-target"
              placeholder="Describe what a correct response looks like — this becomes the rubric the replay is judged against."
              value={resolutionTarget}
              onChange={(event) => setResolutionTarget(event.target.value)}
              rows={4}
            />
          </div>

          <div className="grid gap-2">
            <Label>Outcome kind</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              value={outcomeKind}
              onValueChange={(value) => {
                if (value === "quality" || value === "security") {
                  setOutcomeKind(value);
                }
              }}
              className="justify-start"
            >
              <ToggleGroupItem
                value="quality"
                data-testid="flag-eval-kind-quality"
              >
                Quality
              </ToggleGroupItem>
              <ToggleGroupItem
                value="security"
                data-testid="flag-eval-kind-security"
              >
                Security
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <p className="text-xs text-muted-foreground">
            Flagging copies the raw conversation (including anything pasted into
            it) into a long-lived evaluation artifact.
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            data-testid="flag-eval-submit"
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
          >
            Flag for evaluation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
