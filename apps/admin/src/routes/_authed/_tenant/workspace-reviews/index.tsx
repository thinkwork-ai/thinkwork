import { createFileRoute } from "@tanstack/react-router";
import { Check, GitPullRequestDraft, Loader2, RotateCw, X } from "lucide-react";
import { useMemo, useState } from "react";
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
  AgentWorkspaceReviewsQuery,
  AgentsListQuery,
  CancelAgentWorkspaceReviewMutation,
  ResumeAgentWorkspaceRunMutation,
} from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/workspace-reviews/")({
  component: WorkspaceReviewsPage,
});

type ReviewDecision = "accept" | "cancel" | "resume";

interface WorkspaceReview {
  reviewObjectKey?: string | null;
  targetPath: string;
  requestedAt: string;
  reason?: string | null;
  payload?: string | null;
  run: {
    id: string;
    agentId: string;
    targetPath: string;
    status: string;
    sourceObjectKey?: string | null;
    requestObjectKey?: string | null;
    currentWakeupRequestId?: string | null;
    lastEventAt: string;
    createdAt: string;
    updatedAt: string;
  };
  latestEvent?: {
    id: string;
    eventType: string;
    reason?: string | null;
    sourceObjectKey: string;
    payload?: string | null;
    createdAt: string;
  } | null;
}

function WorkspaceReviewsPage() {
  const { tenantId } = useTenant();
  useBreadcrumbs([{ label: "Workspace Reviews" }]);

  const [decision, setDecision] = useState<{
    type: ReviewDecision;
    runId: string;
  } | null>(null);
  const [notes, setNotes] = useState("");

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

  const [, acceptReview] = useMutation(AcceptAgentWorkspaceReviewMutation);
  const [, cancelReview] = useMutation(CancelAgentWorkspaceReviewMutation);
  const [, resumeRun] = useMutation(ResumeAgentWorkspaceRunMutation);

  const reviews: WorkspaceReview[] =
    (reviewsResult.data as any)?.agentWorkspaceReviews ?? [];
  const agentsById = useMemo(() => {
    const map = new Map<string, { name: string; slug?: string | null }>();
    for (const agent of (agentsResult.data as any)?.agents ?? []) {
      map.set(agent.id, { name: agent.name, slug: agent.slug });
    }
    return map;
  }, [agentsResult.data]);

  if (!tenantId || (reviewsResult.fetching && !reviewsResult.data)) {
    return <PageSkeleton />;
  }

  async function submitDecision() {
    if (!decision) return;
    const input = { notes: notes.trim() || null };
    const mutation =
      decision.type === "accept"
        ? acceptReview
        : decision.type === "cancel"
          ? cancelReview
          : resumeRun;
    const result = await mutation({ runId: decision.runId, input });
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success(decisionToast(decision.type));
    setDecision(null);
    setNotes("");
    refetchReviews({ requestPolicy: "network-only" });
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Run</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Review File</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead className="w-[172px] text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reviews.map((review) => {
              const agent = agentsById.get(review.run.agentId);
              const payload = parsePayload(review.payload);
              return (
                <TableRow key={review.run.id}>
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
                  <TableCell className="max-w-[360px]">
                    <div className="flex flex-col gap-1">
                      <span className="truncate font-mono text-xs">
                        {review.reviewObjectKey ??
                          review.latestEvent?.sourceObjectKey}
                      </span>
                      {payload.fileName && (
                        <span className="text-xs text-muted-foreground">
                          {String(payload.fileName)}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">
                      {relativeTime(review.requestedAt)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="outline"
                        size="icon-sm"
                        title="Accept"
                        onClick={() =>
                          setDecision({ type: "accept", runId: review.run.id })
                        }
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        title="Resume"
                        onClick={() =>
                          setDecision({ type: "resume", runId: review.run.id })
                        }
                      >
                        <RotateCw className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        title="Cancel"
                        onClick={() =>
                          setDecision({ type: "cancel", runId: review.run.id })
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Dialog
        open={!!decision}
        onOpenChange={(open) => {
          if (!open) {
            setDecision(null);
            setNotes("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision ? decisionTitle(decision.type) : ""}
            </DialogTitle>
          </DialogHeader>
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Notes"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDecision(null);
                setNotes("");
              }}
            >
              Cancel
            </Button>
            <Button onClick={submitDecision} disabled={!decision}>
              {reviewsResult.fetching ? (
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

function parsePayload(payload?: string | null): Record<string, unknown> {
  if (!payload) return {};
  try {
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function decisionTitle(decision: ReviewDecision): string {
  if (decision === "accept") return "Accept Review";
  if (decision === "resume") return "Resume Run";
  return "Cancel Run";
}

function decisionToast(decision: ReviewDecision): string {
  if (decision === "accept") return "Review accepted";
  if (decision === "resume") return "Run resumed";
  return "Run cancelled";
}
