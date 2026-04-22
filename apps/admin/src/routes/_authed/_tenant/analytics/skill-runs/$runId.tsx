/**
 * Skill Run detail — renders one row of skill_runs with all the context
 * an operator needs to understand what happened:
 *
 *   * Overview: status, skill id/version, invoker, timing, invocation source.
 *   * Inputs: both raw and resolved inputs as read-only JSON.
 *   * Deliverable: delivered_artifact_ref preview. For compositions that
 *     land in chat/email, this is a reference envelope; the actual content
 *     lives downstream. The detail page links out rather than embedding.
 *   * Actions: cancel (if running), delete (if terminal), submit 👍/👎
 *     feedback (invoker only, if terminal).
 *
 * Cancel fires the cancelSkillRun mutation; the composition_runner's own
 * cooperative check (Unit 1) is what actually stops the work — this page
 * just flips the status. Delete purges the row per plan R11.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "urql";
import { ThumbsUp, ThumbsDown, Square, Trash2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { SkillRunStatusBadge } from "@/components/skill-runs/StatusBadge";
import {
  SkillRunQuery,
  CancelSkillRunMutation,
  DeleteRunMutation,
  SubmitRunFeedbackMutation,
} from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/analytics/skill-runs/$runId")({
  component: SkillRunDetailPage,
});

const TERMINAL_STATUSES = new Set([
  "complete",
  "failed",
  "cancelled",
  "invoker_deprovisioned",
  "skipped_disabled",
  "cost_bounded_error",
]);

function SkillRunDetailPage() {
  const navigate = useNavigate();
  const { runId } = Route.useParams();

  const [result, refetch] = useQuery({
    query: SkillRunQuery,
    variables: { id: runId },
  });

  const run = result.data?.skillRun;

  useBreadcrumbs([
    { label: "Analytics", href: "/analytics" },
    { label: "Skill Runs", href: "/analytics/skill-runs" },
    { label: run?.skillId ?? runId.slice(0, 8) },
  ]);

  const [, cancelRun] = useMutation(CancelSkillRunMutation);
  const [, deleteRun] = useMutation(DeleteRunMutation);
  const [, submitFeedback] = useMutation(SubmitRunFeedbackMutation);

  const [feedbackNote, setFeedbackNote] = useState("");

  const isTerminal = run && TERMINAL_STATUSES.has(run.status);
  const isRunning = run?.status === "running";

  const handleCancel = async () => {
    if (!run) return;
    const res = await cancelRun({ runId: run.id });
    if (res.error) {
      toast.error(`Cancel failed: ${res.error.message}`);
      return;
    }
    toast.success("Cancel requested — the runner will abort between steps.");
    refetch({ requestPolicy: "network-only" });
  };

  const handleDelete = async () => {
    if (!run) return;
    const res = await deleteRun({ runId: run.id });
    if (res.error) {
      toast.error(`Delete failed: ${res.error.message}`);
      return;
    }
    toast.success("Run deleted.");
    navigate({ to: "/analytics/skill-runs", search: { skillId: undefined, status: undefined, invocationSource: undefined } });
  };

  const handleFeedback = async (signal: "positive" | "negative") => {
    if (!run) return;
    const res = await submitFeedback({
      input: { runId: run.id, signal, note: feedbackNote.trim() || null },
    });
    if (res.error) {
      toast.error(`Feedback failed: ${res.error.message}`);
      return;
    }
    toast.success("Thanks — feedback recorded.");
    setFeedbackNote("");
    refetch({ requestPolicy: "network-only" });
  };

  const inputs = useMemo(() => safeJson(run?.inputs), [run?.inputs]);
  const resolvedInputs = useMemo(() => safeJson(run?.resolvedInputs), [run?.resolvedInputs]);
  const deliveredArtifact = useMemo(
    () => safeJson(run?.deliveredArtifactRef),
    [run?.deliveredArtifactRef],
  );

  if (result.fetching && !run) return <PageSkeleton />;
  if (!run) {
    return (
      <div className="p-8">
        <Button variant="ghost" onClick={() => navigate({ to: "/analytics/skill-runs", search: { skillId: undefined, status: undefined, invocationSource: undefined } })}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Skill Runs
        </Button>
        <p className="mt-4 text-muted-foreground">Run not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={run.skillId}
        description={`Run ${run.id.slice(0, 8)} — ${run.invocationSource}`}
        actions={
          <>
            {isRunning && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                aria-label="Cancel this run"
              >
                <Square className="h-4 w-4 mr-2" />
                Cancel
              </Button>
            )}
            {isTerminal && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this run?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Purges the audit row and any stored deliverable. This
                      cannot be undone. Use for data-subject deletion only —
                      normal retention sweeps handle day-to-day cleanup.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Overview</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <Field label="Status">
            <SkillRunStatusBadge status={run.status} />
          </Field>
          <Field label="Skill">
            <span className="font-mono text-xs">
              {run.skillId} v{run.skillVersion}
            </span>
          </Field>
          <Field label="Source">{run.invocationSource}</Field>
          <Field label="Invoker">
            <span className="font-mono text-xs">{run.invokerUserId}</span>
          </Field>
          <Field label="Agent">
            {run.agentId ? (
              <span className="font-mono text-xs">{run.agentId}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Field>
          <Field label="Started">
            {run.startedAt ? relativeTime(run.startedAt) : "—"}
          </Field>
          <Field label="Finished">
            {run.finishedAt ? relativeTime(run.finishedAt) : "—"}
          </Field>
          <Field label="Retention">
            {run.deleteAt ? `expires ${relativeTime(run.deleteAt)}` : "—"}
          </Field>
          {run.failureReason && (
            <div className="col-span-2">
              <Field label="Failure reason">
                <pre className="whitespace-pre-wrap text-red-600 text-xs">
                  {run.failureReason}
                </pre>
              </Field>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inputs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <JsonBlock label="Raw" value={inputs} />
            <JsonBlock label="Resolved" value={resolvedInputs} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deliverable</CardTitle>
        </CardHeader>
        <CardContent>
          {deliveredArtifact ? (
            <JsonBlock label="Artifact reference" value={deliveredArtifact} />
          ) : (
            <p className="text-muted-foreground text-sm">
              Nothing delivered yet. The final step of a composition populates
              this envelope; it's empty for runs that failed before reaching
              the packaged deliverable.
            </p>
          )}
        </CardContent>
      </Card>

      {isTerminal && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Feedback</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Was this run useful? Your thumbs-up / thumbs-down powers the
              skill's adoption metric.
            </p>
            <Textarea
              placeholder="Optional note — what worked, what didn't"
              value={feedbackNote}
              onChange={(e) => setFeedbackNote(e.target.value)}
              maxLength={2000}
            />
            <div className="flex items-center gap-2">
              <Button
                variant={run.feedbackSignal === "positive" ? "default" : "outline"}
                size="sm"
                onClick={() => handleFeedback("positive")}
                aria-label="Positive feedback"
              >
                <ThumbsUp className="h-4 w-4 mr-2" />
                Helpful
              </Button>
              <Button
                variant={run.feedbackSignal === "negative" ? "default" : "outline"}
                size="sm"
                onClick={() => handleFeedback("negative")}
                aria-label="Negative feedback"
              >
                <ThumbsDown className="h-4 w-4 mr-2" />
                Not helpful
              </Button>
              {run.feedbackSignal && (
                <span className="text-xs text-muted-foreground ml-2">
                  Recorded: {run.feedbackSignal}
                </span>
              )}
            </div>
            {run.feedbackNote && (
              <p className="text-xs text-muted-foreground border-l-2 pl-2">
                {run.feedbackNote}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <pre className="rounded bg-muted p-3 text-xs overflow-auto max-h-64">
        {value ? JSON.stringify(value, null, 2) : "—"}
      </pre>
    </div>
  );
}

function safeJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return value;
}
