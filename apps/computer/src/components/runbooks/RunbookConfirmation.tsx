"use client";

import { Badge } from "@thinkwork/ui/badge";
import { Button } from "@thinkwork/ui/button";
import { Check, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation } from "urql";
import {
  Confirmation,
  ConfirmationActions,
  ConfirmationContent,
  ConfirmationDescription,
  ConfirmationHeader,
  ConfirmationTitle,
} from "@/components/ai-elements/confirmation";
import {
  ConfirmRunbookRunMutation,
  RejectRunbookRunMutation,
} from "@/lib/graphql-queries";
import type { RunbookConfirmationData } from "@/lib/ui-message-types";

export interface RunbookConfirmationProps {
  data: RunbookConfirmationData;
  onConfirm?: (runbookRunId: string) => Promise<void> | void;
  onReject?: (runbookRunId: string) => Promise<void> | void;
}

export function RunbookConfirmation({
  data,
  onConfirm,
  onReject,
}: RunbookConfirmationProps) {
  const runbookRunId = stringValue(data.runbookRunId);
  const mode = stringValue(data.mode) ?? "approval";
  const persistedDecision = decisionFromStatus(data.status);
  const [, confirmRunbookRun] = useMutation(ConfirmRunbookRunMutation);
  const [, rejectRunbookRun] = useMutation(RejectRunbookRunMutation);
  const [pendingAction, setPendingAction] = useState<
    "confirm" | "reject" | null
  >(null);
  const [decision, setDecision] = useState<"confirmed" | "rejected" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const title =
    stringValue(data.displayName) ??
    stringValue(data.title) ??
    "Runbook confirmation";
  const summary =
    stringValue(data.summary) ??
    stringValue(data.description) ??
    "Confirm before Computer starts this runbook.";
  const isApproval = mode === "approval" && Boolean(runbookRunId);
  const effectiveDecision = decision ?? persistedDecision;
  const canDecide = isApproval && !effectiveDecision;
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const eventDetail = useMemo(
    () => ({ runbookRunId: runbookRunId ?? null }),
    [runbookRunId],
  );

  async function handleConfirm() {
    if (!runbookRunId || pendingAction || effectiveDecision) return;
    setPendingAction("confirm");
    setError(null);
    try {
      if (onConfirm) {
        await onConfirm(runbookRunId);
      } else {
        const result = await confirmRunbookRun({ id: runbookRunId });
        if (result.error) throw result.error;
      }
      setDecision("confirmed");
      window.dispatchEvent(
        new CustomEvent("thinkwork:runbook-decision", {
          detail: { ...eventDetail, decision: "confirmed" },
        }),
      );
    } catch (err) {
      setError(errorMessage(err, "Could not approve this runbook."));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleReject() {
    if (!runbookRunId || pendingAction || effectiveDecision) return;
    setPendingAction("reject");
    setError(null);
    try {
      if (onReject) {
        await onReject(runbookRunId);
      } else {
        const result = await rejectRunbookRun({ id: runbookRunId });
        if (result.error) throw result.error;
      }
      setDecision("rejected");
      window.dispatchEvent(
        new CustomEvent("thinkwork:runbook-decision", {
          detail: { ...eventDetail, decision: "rejected" },
        }),
      );
    } catch (err) {
      setError(errorMessage(err, "Could not reject this runbook."));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <Confirmation aria-label={`${title} confirmation`}>
      <ConfirmationHeader>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ConfirmationTitle>{title}</ConfirmationTitle>
          {effectiveDecision ? (
            <Badge variant="secondary" className="capitalize">
              {effectiveDecision}
            </Badge>
          ) : null}
        </div>
        <ConfirmationDescription>{summary}</ConfirmationDescription>
      </ConfirmationHeader>

      <ConfirmationContent>
        <FieldList
          label="Expected outputs"
          values={stringArray(data.expectedOutputs)}
        />
        <FieldList
          label="Phase summary"
          values={stringArray(data.phaseSummary)}
        />
        <FieldList
          label="Likely tools"
          values={stringArray(data.likelyTools)}
        />
        {candidates.length > 0 ? (
          <CandidateList candidates={candidates} />
        ) : null}
        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
            {error}
          </p>
        ) : null}
      </ConfirmationContent>

      {canDecide ? (
        <ConfirmationActions>
          <Button
            type="button"
            size="sm"
            onClick={handleConfirm}
            disabled={Boolean(pendingAction)}
          >
            <Check className="size-4" />
            {pendingAction === "confirm" ? "Approving" : "Approve"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleReject}
            disabled={Boolean(pendingAction)}
          >
            <X className="size-4" />
            {pendingAction === "reject" ? "Rejecting" : "Reject"}
          </Button>
        </ConfirmationActions>
      ) : null}
    </Confirmation>
  );
}

function FieldList({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="grid gap-1.5">
      <p className="font-medium text-muted-foreground text-xs uppercase">
        {label}
      </p>
      <ul className="grid gap-1 text-sm leading-5">
        {values.map((value) => (
          <li className="text-pretty break-words" key={value}>
            {value}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CandidateList({
  candidates,
}: {
  candidates: RunbookConfirmationData["candidates"];
}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  return (
    <div className="grid gap-2">
      <p className="font-medium text-muted-foreground text-xs uppercase">
        Candidate runbooks
      </p>
      <div className="grid gap-2">
        {candidates.map((candidate, index) => (
          <div
            className="rounded-md border border-border/60 bg-background/40 px-3 py-2"
            key={stringValue(candidate.runbookSlug) ?? `candidate-${index}`}
          >
            <p className="text-pretty break-words font-medium text-sm">
              {stringValue(candidate.displayName) ?? "Runbook"}
            </p>
            {stringValue(candidate.description) ? (
              <p className="text-pretty break-words text-muted-foreground text-xs leading-5">
                {stringValue(candidate.description)}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function decisionFromStatus(value: unknown): "confirmed" | "rejected" | null {
  const status = stringValue(value)?.toLowerCase().replace(/_/g, "-");
  if (!status || status === "awaiting-confirmation") return null;
  if (status === "rejected" || status === "cancelled") return "rejected";
  if (
    status === "queued" ||
    status === "running" ||
    status === "completed" ||
    status === "failed"
  ) {
    return "confirmed";
  }
  return null;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
