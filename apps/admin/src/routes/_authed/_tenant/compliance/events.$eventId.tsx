import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "urql";
import { ArrowLeft } from "lucide-react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ComplianceEventDetailQuery } from "@/lib/compliance/queries";
import { ChainPositionPanel } from "@/components/compliance/ChainPositionPanel";
import { AnchorStatusPanel } from "@/components/compliance/AnchorStatusPanel";
import { PayloadSection } from "@/components/compliance/PayloadSection";
import { formatDateTime, relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/_authed/_tenant/compliance/events/$eventId")({
  component: ComplianceEventDetailPage,
});

function ComplianceEventDetailPage() {
  const { eventId } = Route.useParams();
  useBreadcrumbs([
    { label: "Compliance", href: "/compliance" },
    { label: eventId.slice(0, 8) },
  ]);

  const [{ data, fetching, error }] = useQuery({
    query: ComplianceEventDetailQuery,
    variables: { eventId },
  });

  const event = data?.complianceEvent;

  return (
    <PageLayout
      header={
        <PageHeader
          title="Compliance event"
          description={event ? formatEventTypeLabel(event.eventType) : "Loading…"}
          actions={
            <Button asChild variant="outline" size="sm">
              <Link to="/compliance" search={(prev) => prev}>
                <ArrowLeft className="size-3.5" />
                Back to events
              </Link>
            </Button>
          }
        />
      }
    >
      {fetching && !event ? (
        <PageSkeleton />
      ) : error ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Failed to load event: {error.message}
          </CardContent>
        </Card>
      ) : !event ? (
        <Card>
          <CardContent className="p-6 space-y-2">
            <p className="text-sm">
              Event not found, or not visible to your tenant scope.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to="/compliance" search={(prev) => prev}>
                <ArrowLeft className="size-3.5" />
                Back to events
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-6 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {event.eventType.replace(/_/g, ".").toLowerCase()}
                </Badge>
                <Badge variant="outline">{event.actorType.toLowerCase()}</Badge>
                <Badge variant="outline">{event.source}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <Row label="Event ID" value={event.eventId} />
                <Row label="Tenant" value={event.tenantId} />
                <Row label="Actor" value={event.actor} />
                <Row
                  label="Recorded"
                  value={`${relativeTime(event.recordedAt)} · ${formatDateTime(event.recordedAt)}`}
                />
                <Row
                  label="Occurred"
                  value={`${relativeTime(event.occurredAt)} · ${formatDateTime(event.occurredAt)}`}
                />
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChainPositionPanel
              eventHash={event.eventHash}
              prevHash={event.prevHash}
            />
            <AnchorStatusPanel anchorStatus={event.anchorStatus} />
          </div>

          <PayloadSection payload={event.payload} eventId={event.eventId} />
        </div>
      )}
    </PageLayout>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-muted-foreground shrink-0 min-w-[5rem]">{label}</span>
      <span className="truncate font-mono text-xs">{value}</span>
    </div>
  );
}

function formatEventTypeLabel(eventType: string): string {
  return eventType.replace(/_/g, ".").toLowerCase();
}
