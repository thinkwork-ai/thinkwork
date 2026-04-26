import { createFileRoute } from "@tanstack/react-router";
import {
  Check,
  FileText,
  GitPullRequestDraft,
  Loader2,
  RotateCw,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery } from "urql";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
import {
  AcceptAgentWorkspaceReviewMutation,
  AgentWorkspaceReviewQuery,
  AgentWorkspaceReviewsQuery,
  AgentsListQuery,
  CancelAgentWorkspaceReviewMutation,
  ResumeAgentWorkspaceRunMutation,
} from "@/lib/graphql-queries";
import { cn, relativeTime } from "@/lib/utils";
import {
  workspaceReviewActionsForStatus,
  workspaceReviewDecisionLabel,
  workspaceReviewDecisionToast,
  workspaceReviewErrorMessage,
  type WorkspaceReviewDecision,
} from "@/lib/workspace-review-state";

export const Route = createFileRoute("/_authed/_tenant/workspace-reviews/")({
  component: WorkspaceReviewsPage,
});

interface WorkspaceReview {
  reviewObjectKey?: string | null;
  targetPath: string;
  requestedAt: string;
  reason?: string | null;
  payload?: string | null;
  reviewBody?: string | null;
  reviewEtag?: string | null;
  reviewMissing?: boolean | null;
  proposedChanges?: ProposedChange[] | null;
  events?: WorkspaceEvent[] | null;
  decisionEvents?: WorkspaceEvent[] | null;
  run: WorkspaceRun;
  latestEvent?: WorkspaceEvent | null;
}

interface WorkspaceRun {
  id: string;
  agentId: string;
  targetPath: string;
  status: string;
  sourceObjectKey?: string | null;
  requestObjectKey?: string | null;
  currentWakeupRequestId?: string | null;
  currentThreadTurnId?: string | null;
  lastEventAt: string;
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceEvent {
  id: string;
  eventType: string;
  reason?: string | null;
  sourceObjectKey?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  payload?: string | null;
  createdAt: string;
}

interface ProposedChange {
  path?: string | null;
  kind: string;
  summary: string;
  diff?: string | null;
  before?: string | null;
  after?: string | null;
}

function WorkspaceReviewsPage() {
  const { tenantId } = useTenant();
  useBreadcrumbs([{ label: "Workspace Reviews" }]);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [decision, setDecision] = useState<{
    type: WorkspaceReviewDecision;
    runId: string;
  } | null>(null);
  const [notes, setNotes] = useState("");
  const [responseMarkdown, setResponseMarkdown] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [reviewsResult, refetchReviews] = useQuery({
    query: AgentWorkspaceReviewsQuery,
    variables: { tenantId: tenantId!, status: "awaiting_review", limit: 100 },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [agentsResult] = useQuery({
    query: AgentsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });
  const [detailResult, refetchDetail] = useQuery({
    query: AgentWorkspaceReviewQuery,
    variables: { runId: selectedRunId! },
    pause: !selectedRunId,
    requestPolicy: "cache-and-network",
  });

  const [, acceptReview] = useMutation(AcceptAgentWorkspaceReviewMutation);
  const [, cancelReview] = useMutation(CancelAgentWorkspaceReviewMutation);
  const [, resumeRun] = useMutation(ResumeAgentWorkspaceRunMutation);

  const reviews: WorkspaceReview[] =
    (reviewsResult.data as any)?.agentWorkspaceReviews ?? [];
  const detail: WorkspaceReview | null =
    (detailResult.data as any)?.agentWorkspaceReview ?? null;
  const agentsById = useMemo(() => {
    const map = new Map<string, { name: string; slug?: string | null }>();
    for (const agent of (agentsResult.data as any)?.agents ?? []) {
      map.set(agent.id, { name: agent.name, slug: agent.slug });
    }
    return map;
  }, [agentsResult.data]);

  useEffect(() => {
    if (!selectedRunId && reviews.length > 0) {
      setSelectedRunId(reviews[0].run.id);
    }
    if (selectedRunId && reviews.length > 0) {
      const stillVisible = reviews.some(
        (review) => review.run.id === selectedRunId,
      );
      if (!stillVisible) setSelectedRunId(reviews[0].run.id);
    }
  }, [reviews, selectedRunId]);

  if (!tenantId || (reviewsResult.fetching && !reviewsResult.data)) {
    return <PageSkeleton />;
  }

  async function submitDecision() {
    if (!decision) return;
    setSubmitting(true);
    try {
      const input = {
        notes: notes.trim() || null,
        responseMarkdown:
          decision.type === "cancel" ? null : responseMarkdown.trim() || null,
        expectedReviewEtag: detail?.reviewEtag ?? null,
      };
      const mutation =
        decision.type === "accept"
          ? acceptReview
          : decision.type === "cancel"
            ? cancelReview
            : resumeRun;
      const result = await mutation({ runId: decision.runId, input });
      if (result.error) {
        toast.error(workspaceReviewErrorMessage(result.error.message));
        return;
      }
      toast.success(workspaceReviewDecisionToast(decision.type));
      setDecision(null);
      setNotes("");
      setResponseMarkdown("");
      refetchReviews({ requestPolicy: "network-only" });
      refetchDetail({ requestPolicy: "network-only" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageLayout
      header={
        <PageHeader
          title="Workspace Reviews"
          description={`${reviews.length} runs awaiting operator action`}
        />
      }
    >
      {reviews.length === 0 ? (
        <EmptyState
          icon={GitPullRequestDraft}
          title="No pending reviews"
          description="Workspace runs that block on review files appear here."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(460px,0.9fr)_minmax(520px,1.1fr)]">
          <ReviewQueue
            reviews={reviews}
            agentsById={agentsById}
            selectedRunId={selectedRunId}
            onSelect={setSelectedRunId}
          />
          <ReviewDetail
            detail={detail}
            loading={detailResult.fetching && !detailResult.data}
            agent={detail ? agentsById.get(detail.run.agentId) : undefined}
            onDecision={(type, runId) => {
              setDecision({ type, runId });
              setNotes("");
              setResponseMarkdown("");
            }}
          />
        </div>
      )}

      <Dialog
        open={!!decision}
        onOpenChange={(open) => {
          if (!open) {
            setDecision(null);
            setNotes("");
            setResponseMarkdown("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision ? workspaceReviewDecisionLabel(decision.type) : ""}
            </DialogTitle>
          </DialogHeader>
          {decision?.type !== "cancel" && (
            <Textarea
              value={responseMarkdown}
              onChange={(event) => setResponseMarkdown(event.target.value)}
              placeholder="Response for the agent"
              className="min-h-28 font-mono text-xs"
            />
          )}
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Operator notes"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDecision(null);
                setNotes("");
                setResponseMarkdown("");
              }}
            >
              Close
            </Button>
            <Button onClick={submitDecision} disabled={!decision || submitting}>
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}

function ReviewQueue({
  reviews,
  agentsById,
  selectedRunId,
  onSelect,
}: {
  reviews: WorkspaceReview[];
  agentsById: Map<string, { name: string; slug?: string | null }>;
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Run</TableHead>
            <TableHead>Agent</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Requested</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reviews.map((review) => {
            const agent = agentsById.get(review.run.agentId);
            return (
              <TableRow
                key={review.run.id}
                className={cn(
                  "cursor-pointer",
                  selectedRunId === review.run.id && "bg-muted/60",
                )}
                onClick={() => onSelect(review.run.id)}
              >
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-xs">
                      {shortId(review.run.id)}
                    </span>
                    <Badge variant="outline" className="w-fit capitalize">
                      {review.run.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {agent?.name ?? shortId(review.run.agentId)}
                    </span>
                    {agent?.slug && (
                      <span className="text-xs text-muted-foreground">
                        {agent.slug}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs">
                    {review.targetPath || "/"}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-xs text-muted-foreground">
                    {relativeTime(review.requestedAt)}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ReviewDetail({
  detail,
  loading,
  agent,
  onDecision,
}: {
  detail: WorkspaceReview | null;
  loading: boolean;
  agent?: { name: string; slug?: string | null };
  onDecision: (type: WorkspaceReviewDecision, runId: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-lg border">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!detail) {
    return (
      <EmptyState
        icon={FileText}
        title="No review selected"
        className="min-h-[420px] rounded-lg border"
      />
    );
  }

  const actions = workspaceReviewActionsForStatus(detail.run.status);
  const proposedChanges = detail.proposedChanges ?? [];
  const events = detail.events ?? [];

  return (
    <div className="rounded-lg border bg-background">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">
              Review {shortId(detail.run.id)}
            </h2>
            <Badge variant="outline" className="capitalize">
              {detail.run.status.replace(/_/g, " ")}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            {agent?.name ?? shortId(detail.run.agentId)}
            {agent?.slug ? ` / ${agent.slug}` : ""} - {detail.targetPath || "/"}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            disabled={!actions.accept}
            onClick={() => onDecision("accept", detail.run.id)}
          >
            <Check className="h-4 w-4" />
            Accept
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!actions.resume}
            onClick={() => onDecision("resume", detail.run.id)}
          >
            <RotateCw className="h-4 w-4" />
            Continue
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={!actions.cancel}
            onClick={() => onDecision("cancel", detail.run.id)}
          >
            <X className="h-4 w-4" />
            Reject
          </Button>
        </div>
      </div>

      <div className="grid gap-4 p-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4 min-w-0">
          <MetadataGrid detail={detail} />
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Review File</h3>
            {detail.reviewMissing ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                Review object is missing.
              </div>
            ) : (
              <pre className="max-h-[360px] overflow-auto rounded-md border bg-muted/30 p-3 whitespace-pre-wrap break-words font-mono text-xs leading-5">
                {detail.reviewBody || "No review body."}
              </pre>
            )}
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Proposed Changes</h3>
            {proposedChanges.length === 0 ? (
              <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                No structured changes detected.
              </div>
            ) : (
              <div className="space-y-2">
                {proposedChanges.map((change, index) => (
                  <div key={index} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{change.kind}</Badge>
                      <span className="font-medium">{change.summary}</span>
                    </div>
                    {change.path && (
                      <div className="mt-1 font-mono text-xs text-muted-foreground">
                        {change.path}
                      </div>
                    )}
                    {change.diff && (
                      <pre className="mt-2 max-h-52 overflow-auto rounded bg-muted/30 p-2 whitespace-pre-wrap font-mono text-xs">
                        {change.diff}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="space-y-2 min-w-0">
          <h3 className="text-sm font-medium">Event Timeline</h3>
          <div className="max-h-[620px] overflow-auto rounded-md border">
            {events.map((event) => (
              <div key={event.id} className="border-b p-3 last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline">{event.eventType}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {relativeTime(event.createdAt)}
                  </span>
                </div>
                {event.reason && (
                  <div className="mt-1 text-sm">{event.reason}</div>
                )}
                {event.sourceObjectKey && (
                  <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                    {event.sourceObjectKey}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function MetadataGrid({ detail }: { detail: WorkspaceReview }) {
  const rows = [
    ["Run", detail.run.id],
    [
      "Review object",
      detail.reviewObjectKey ?? detail.latestEvent?.sourceObjectKey ?? "-",
    ],
    ["ETag", detail.reviewEtag ?? "-"],
    ["Wakeup", detail.run.currentWakeupRequestId ?? "-"],
    ["Requested", detail.requestedAt],
  ];

  return (
    <div className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="bg-background p-3">
          <div className="text-[11px] uppercase text-muted-foreground">
            {label}
          </div>
          <div className="mt-1 truncate font-mono text-xs">{value}</div>
        </div>
      ))}
    </div>
  );
}

function shortId(id: string): string {
  return id.slice(0, 8);
}
