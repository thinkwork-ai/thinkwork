import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "urql";
import { useState } from "react";
import { ArrowLeft, MessageSquare, ChevronRight, MessagesSquare as ThreadIcon } from "lucide-react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  InboxItemDetailQuery,
  ApproveInboxItemMutation,
  RejectInboxItemMutation,
  RequestRevisionMutation,
  ResubmitInboxItemMutation,
  AddInboxItemCommentMutation,
  ActivityLogQuery,
} from "@/lib/graphql-queries";
import { InboxItemPayloadRenderer, typeLabel, typeIcon, defaultTypeIcon } from "@/components/inbox/InboxItemPayload";
import { ActivityRow } from "@/components/ActivityRow";
import { formatDateTime, relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/inbox/$inboxItemId")({
  component: InboxItemDetailPage,
});

function InboxItemDetailPage() {
  const { inboxItemId } = Route.useParams();
  const [commentBody, setCommentBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showRawPayload, setShowRawPayload] = useState(false);

  const [result, reexecute] = useQuery({
    query: InboxItemDetailQuery,
    variables: { id: inboxItemId },
  });

  const item = result.data?.inboxItem;

  const [activityResult] = useQuery({
    query: ActivityLogQuery,
    variables: {
      tenantId: item?.tenantId ?? "",
      entityType: "inbox_item",
      entityId: inboxItemId,
      limit: 20,
    },
    pause: !item?.tenantId,
  });

  const [, approveMut] = useMutation(ApproveInboxItemMutation);
  const [, rejectMut] = useMutation(RejectInboxItemMutation);
  const [, revisionMut] = useMutation(RequestRevisionMutation);
  const [, resubmitMut] = useMutation(ResubmitInboxItemMutation);
  const [, addCommentMut] = useMutation(AddInboxItemCommentMutation);

  useBreadcrumbs([
    { label: "Inbox", href: "/inbox" },
    { label: item?.title || "Request" },
  ]);

  if ((result.fetching && !result.data) || !item) return <PageSkeleton />;

  const status = item.status.toLowerCase();
  const isActionable = status === "pending" || status === "revision_requested";
  const payload: Record<string, unknown> = item.config
    ? (typeof item.config === "string" ? JSON.parse(item.config) : item.config)
    : {};
  const TypeIcon = typeIcon[item.type] ?? defaultTypeIcon;
  const activityEntries = activityResult.data?.activityLog ?? [];

  function refresh() {
    reexecute({ requestPolicy: "network-only" });
  }

  async function handleAction(fn: () => Promise<{ error?: { message: string } | null }>) {
    setError(null);
    const { error: err } = await fn();
    if (err) setError(err.message);
    refresh();
  }

  async function handleAddComment() {
    if (!commentBody.trim()) return;
    setError(null);
    const { error: err } = await addCommentMut({
      input: { inboxItemId, content: commentBody.trim() },
    });
    if (err) setError(err.message);
    else setCommentBody("");
    refresh();
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <Link to="/inbox">
          <Button variant="ghost" size="icon-sm"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <PageHeader
          title={item.title || "Request"}
          actions={<StatusBadge status={status} />}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          {/* Item details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TypeIcon className="h-4 w-4" />
                {typeLabel[item.type] ?? item.type.replace(/_/g, " ")}
                {item.revision > 1 && (
                  <Badge variant="outline" className="text-xs">v{item.revision}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {item.description && (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{item.description}</p>
              )}

              <InboxItemPayloadRenderer type={item.type} payload={payload} />

              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-2"
                onClick={() => setShowRawPayload((v) => !v)}
              >
                <ChevronRight className={`h-3 w-3 transition-transform ${showRawPayload ? "rotate-90" : ""}`} />
                See full request
              </button>
              {showRawPayload && (
                <pre className="text-xs bg-muted/40 rounded-md p-3 overflow-x-auto">
                  {JSON.stringify(payload, null, 2)}
                </pre>
              )}

              {item.reviewNotes && (
                <p className="text-xs text-muted-foreground italic border-t border-border pt-2">
                  Review notes: {item.reviewNotes}
                </p>
              )}

              {/* Action buttons */}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                {isActionable && (
                  <>
                    <Button
                      size="sm"
                      className="bg-green-700 hover:bg-green-600 text-white"
                      onClick={() => handleAction(() => approveMut({ id: inboxItemId }))}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleAction(() => rejectMut({ id: inboxItemId }))}
                    >
                      Reject
                    </Button>
                  </>
                )}
                {status === "pending" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const notes = window.prompt("Revision notes:");
                      if (!notes) return;
                      handleAction(() => revisionMut({ id: inboxItemId, input: { reviewNotes: notes } }));
                    }}
                  >
                    Request revision
                  </Button>
                )}
                {status === "revision_requested" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAction(() => resubmitMut({ id: inboxItemId }))}
                  >
                    Mark resubmitted
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Linked threads */}
          {item.linkedThreads.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ThreadIcon className="h-4 w-4" /> Linked Threads ({item.linkedThreads.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {item.linkedThreads.map((linked) => (
                    <Link
                      key={linked.id}
                      to="/threads/$threadId"
                      params={{ threadId: linked.id }}
                      className="block text-xs rounded border border-border/70 px-2 py-1.5 hover:bg-accent/20"
                    >
                      <span className="font-mono text-muted-foreground mr-2">
                        {linked.identifier ?? `#${linked.number}`}
                      </span>
                      <span>{linked.title}</span>
                      <StatusBadge status={linked.status.toLowerCase()} size="sm" className="ml-2" />
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Comments */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4" /> Comments ({item.comments.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {item.comments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No comments yet.</p>
              ) : (
                <div className="space-y-4">
                  {item.comments.map((c) => (
                    <div key={c.id}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium">{c.authorType ?? "User"}</span>
                        <span className="text-xs text-muted-foreground">{relativeTime(c.createdAt)}</span>
                      </div>
                      <p className="text-sm">{c.content}</p>
                      <Separator className="mt-4" />
                    </div>
                  ))}
                </div>
              )}

              <Textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Add a comment..."
                rows={3}
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={handleAddComment}
                  disabled={!commentBody.trim()}
                >
                  Post comment
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Activity timeline */}
          {activityEntries.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {activityEntries.map((entry) => (
                    <ActivityRow
                      key={entry.id}
                      action={entry.action.split(".").pop() ?? entry.action}
                      actorName={entry.actorType}
                      description={entry.action}
                      timestamp={new Date(entry.createdAt)}
                      entityType={entry.entityType ?? undefined}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Properties sidebar */}
        <Card className="h-fit">
          <CardHeader><CardTitle>Properties</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Row label="Status"><StatusBadge status={status} size="sm" /></Row>
            <Row label="Type"><Badge variant="outline">{item.type}</Badge></Row>
            <Row label="Revision">{item.revision}</Row>
            {item.entityType && <Row label="Entity">{item.entityType}</Row>}
            {item.decidedAt && <Row label="Decided">{formatDateTime(item.decidedAt)}</Row>}
            {item.expiresAt && <Row label="Expires">{formatDateTime(item.expiresAt)}</Row>}
            <Row label="Created">{formatDateTime(item.createdAt)}</Row>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  );
}
