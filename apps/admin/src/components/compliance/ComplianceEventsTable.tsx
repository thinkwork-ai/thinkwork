import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "urql";
import { CheckCircle, Clock, Loader2 } from "lucide-react";
import { ComplianceAnchorState } from "@/gql/graphql";
import { ComplianceEventsListQuery } from "@/lib/compliance/queries";
import {
  resolveSince,
  type ComplianceSearchParams,
} from "@/lib/compliance/url-search-params";
import { useComplianceOperator } from "@/lib/compliance/use-compliance-operator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, relativeTime, cn } from "@/lib/utils";

const PAGE_SIZE = 50;
const SKELETON_ROW_COUNT = 5;

export interface ComplianceEventsTableProps {
  search: ComplianceSearchParams;
  onCursorAdvance: (nextCursor: string) => void;
}

function shortHash(hash: string | undefined | null): string {
  if (!hash) return "—";
  return hash.slice(0, 12);
}

export function ComplianceEventsTable({
  search,
  onCursorAdvance,
}: ComplianceEventsTableProps) {
  const operator = useComplianceOperator();
  // When toggle is OFF, force-clear tenantId from the filter so non-operators
  // and operators-without-cross-tenant-toggle stick to their own scope.
  const effectiveTenantId =
    operator.isOperator && search.xt === 1 ? search.tenantId : undefined;

  const filter = useMemo(
    () => ({
      tenantId: effectiveTenantId,
      actorType: search.actorType,
      eventType: search.eventType,
      since: resolveSince(search),
      until: search.until,
    }),
    [
      effectiveTenantId,
      search.actorType,
      search.eventType,
      search.since,
      search.until,
      search.range,
    ],
  );

  const [{ data, fetching, error }, refetch] = useQuery({
    query: ComplianceEventsListQuery,
    variables: {
      filter,
      after: search.cursor,
      first: PAGE_SIZE,
    },
  });

  const edges = data?.complianceEvents?.edges ?? [];
  const pageInfo = data?.complianceEvents?.pageInfo;
  const isFirstLoad = fetching && !data;

  const hasActiveFilter =
    Boolean(filter.tenantId) ||
    Boolean(filter.actorType) ||
    Boolean(filter.eventType) ||
    Boolean(filter.since) ||
    Boolean(filter.until);

  return (
    <div className="space-y-3">
      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex items-center justify-between gap-3">
          <span>Failed to load compliance events: {error.message}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => refetch({ requestPolicy: "network-only" })}
          >
            Retry
          </Button>
        </div>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[14rem]">Recorded</TableHead>
            <TableHead className="w-[14rem]">Event</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead className="w-[8rem]">Source</TableHead>
            <TableHead className="w-[10rem]">Anchor</TableHead>
            <TableHead className="w-[10rem]">Hash</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isFirstLoad
            ? Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
                <TableRow key={`skeleton-${i}`}>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                </TableRow>
              ))
            : edges.length === 0 && !error ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-12">
                    {hasActiveFilter
                      ? "No audit events match the current filter."
                      : "No audit events have been recorded yet."}
                  </TableCell>
                </TableRow>
              ) : edges.length === 0 ? null : (
                edges.map((edge) => {
                  const event = edge.node;
                  return (
                    <TableRow
                      key={event.eventId}
                      className="cursor-pointer hover:bg-muted/40"
                    >
                      <TableCell className="align-top">
                        <Link
                          to="/compliance/events/$eventId"
                          params={{ eventId: event.eventId }}
                          search={(prev) => prev}
                          className="block"
                        >
                          <div className="font-medium">{relativeTime(event.recordedAt)}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatDateTime(event.recordedAt)}
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell className="align-top">
                        <Link
                          to="/compliance/events/$eventId"
                          params={{ eventId: event.eventId }}
                          search={(prev) => prev}
                          className="block"
                        >
                          <Badge variant="secondary">
                            {event.eventType.replace(/_/g, ".").toLowerCase()}
                          </Badge>
                        </Link>
                      </TableCell>
                      <TableCell className="align-top">
                        <Link
                          to="/compliance/events/$eventId"
                          params={{ eventId: event.eventId }}
                          search={(prev) => prev}
                          className="block"
                        >
                          <div className="truncate max-w-[18rem]">{event.actor}</div>
                          <div className="text-xs text-muted-foreground">
                            {event.actorType.toLowerCase()}
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell className="align-top text-xs text-muted-foreground">
                        {event.source}
                      </TableCell>
                      <TableCell className="align-top">
                        <AnchorBadge state={event.anchorStatus.state} />
                      </TableCell>
                      <TableCell className="align-top">
                        <code className="text-xs font-mono">{shortHash(event.eventHash)}</code>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
        </TableBody>
      </Table>

      {pageInfo?.hasNextPage && pageInfo.endCursor ? (() => {
        const nextCursor = pageInfo.endCursor;
        return (
          <div className="flex justify-center pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={fetching}
              onClick={() => onCursorAdvance(nextCursor)}
            >
              {fetching ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  Loading...
                </>
              ) : (
                "Load more"
              )}
            </Button>
          </div>
        );
      })() : null}
    </div>
  );
}

function AnchorBadge({ state }: { state: ComplianceAnchorState }) {
  if (state === ComplianceAnchorState.Anchored) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400")}>
        <CheckCircle className="size-3.5" />
        Anchored
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400")}>
      <Clock className="size-3.5" />
      Pending
    </span>
  );
}
