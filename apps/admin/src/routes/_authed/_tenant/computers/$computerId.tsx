import { useCallback, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import {
  Archive,
  ArrowLeft,
  DollarSign,
  Monitor,
  Server,
  User,
  Users,
} from "lucide-react";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageLayout } from "@/components/PageLayout";
import { PageHeader } from "@/components/PageHeader";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AgentsListQuery,
  ComputerDetailQuery,
  ThreadsPagedQuery,
  UpdateThreadMutation,
} from "@/lib/graphql-queries";
import {
  ThreadsTable,
  computeThreadInboxStatus,
  type ThreadsTableItem,
} from "@/components/threads/ThreadsTable";
import { useActiveTurnsStore } from "@/stores/active-turns-store";
import { formatUsd } from "@/lib/utils";
import { ComputerScope, ComputerStatus, type Computer } from "@/gql/graphql";
import { ComputerStatusPanel } from "./-components/ComputerStatusPanel";
import { ComputerRuntimePanel } from "./-components/ComputerRuntimePanel";
import { ComputerDashboardMetrics } from "./-components/ComputerDashboardMetrics";
import { ComputerIdentityEditPanel } from "./-components/ComputerIdentityEditPanel";
import { ComputerAccessUsersTable } from "./-components/ComputerAccessUsersTable";
import { ComputerTerminal } from "./-components/ComputerTerminal";
import { WorkspaceEditor } from "@/components/agent-builder/WorkspaceEditor";

export const Route = createFileRoute("/_authed/_tenant/computers/$computerId")({
  component: ComputerDetailPage,
  validateSearch: (search: Record<string, unknown>) => ({
    tab: parseComputerTab(search.tab),
  }),
});

type ComputerDetailTab = "dashboard" | "workspace" | "terminal" | "config";

function parseComputerTab(value: unknown): ComputerDetailTab {
  if (value === "workspace" || value === "terminal" || value === "config") {
    return value;
  }
  return "dashboard";
}

function label(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function centsToUsd(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return formatUsd(cents / 100, 0);
}

function ComputerDetailPage() {
  const { computerId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const [accessRefreshKey, setAccessRefreshKey] = useState(0);
  const [result, reexecute] = useQuery({
    query: ComputerDetailQuery,
    variables: { id: computerId },
    requestPolicy: "cache-and-network",
  });
  const computer = result.data?.computer ?? null;

  useBreadcrumbs([
    { label: "Computers", href: "/computers" },
    { label: computer?.name ?? "Computer" },
  ]);

  if (result.fetching && !result.data) return <PageSkeleton />;

  if (result.error) {
    return (
      <PageLayout
        header={
          <PageHeader
            title="Computer"
            actions={
              <Button
                variant="outline"
                onClick={() => navigate({ to: "/computers" })}
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            }
          />
        }
      >
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {result.error.message}
        </div>
      </PageLayout>
    );
  }

  if (!computer) {
    return (
      <PageLayout
        header={
          <PageHeader
            title="Computer"
            actions={
              <Button
                variant="outline"
                onClick={() => navigate({ to: "/computers" })}
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            }
          />
        }
      >
        <EmptyState
          icon={Monitor}
          title="Computer not found"
          description="The Computer may have been archived or you may not have access."
          action={{
            label: "Back to Computers",
            onClick: () => navigate({ to: "/computers" }),
          }}
        />
      </PageLayout>
    );
  }

  const ownerLabel = computer.owner?.name ?? computer.owner?.email ?? "—";
  const isHistoricalPersonal =
    computer.scope === ComputerScope.HistoricalPersonal;

  return (
    <PageLayout
      // Workspace tab fills the viewport (tree + editor own their own
      // scroll); other tabs keep the default stacked-panels rhythm.
      contentClassName={
        tab === "workspace" ? "flex flex-col pb-4" : "space-y-4"
      }
      header={
        <div className="space-y-3">
          <div className="grid items-center gap-3 lg:grid-cols-[1fr_auto_1fr]">
            <h1 className="min-w-0 truncate text-2xl font-bold leading-tight tracking-tight text-foreground">
              {computer.name}
            </h1>
            <div className="flex justify-start lg:justify-center">
              <Tabs value={tab}>
                <TabsList>
                  <TabsTrigger value="dashboard" asChild className="px-4">
                    <Link
                      to="/computers/$computerId"
                      params={{ computerId }}
                      search={{ tab: "dashboard" }}
                    >
                      Dashboard
                    </Link>
                  </TabsTrigger>
                  <TabsTrigger value="workspace" asChild className="px-4">
                    <Link
                      to="/computers/$computerId"
                      params={{ computerId }}
                      search={{ tab: "workspace" }}
                    >
                      Workspace
                    </Link>
                  </TabsTrigger>
                  <TabsTrigger value="terminal" asChild className="px-4">
                    <Link
                      to="/computers/$computerId"
                      params={{ computerId }}
                      search={{ tab: "terminal" }}
                    >
                      Terminal
                    </Link>
                  </TabsTrigger>
                  <TabsTrigger value="config" asChild className="px-4">
                    <Link
                      to="/computers/$computerId"
                      params={{ computerId }}
                      search={{ tab: "config" }}
                    >
                      Config
                    </Link>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="flex justify-start lg:justify-end">
              <span className="truncate text-sm text-muted-foreground">
                {computer.slug}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="outline" className="gap-1">
              {isHistoricalPersonal ? (
                <User className="h-3 w-3" />
              ) : (
                <Users className="h-3 w-3" />
              )}
              {isHistoricalPersonal ? ownerLabel : "Shared Computer"}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Monitor className="h-3 w-3" />
              {computer.template?.name ?? "No template"}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Server className="h-3 w-3" />
              {label(computer.runtimeStatus)}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <DollarSign className="h-3 w-3" />
              {centsToUsd(computer.spentMonthlyCents)}
            </Badge>
            {computer.status === ComputerStatus.Archived ? (
              <Badge
                variant="outline"
                className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-300"
              >
                <Archive className="h-3 w-3" />
                Archived
              </Badge>
            ) : null}
            {/* Archive control moved to Config → Computer Status (plan U4). */}
          </div>
        </div>
      }
    >
      {tab === "dashboard" ? (
        <ComputerDashboardTab
          computer={computer}
          onChanged={() => reexecute({ requestPolicy: "network-only" })}
        />
      ) : null}

      {tab === "workspace" ? (
        <ComputerWorkspaceTab computerId={computer.id} />
      ) : null}

      {tab === "config" ? (
        <div className="space-y-4">
          <ComputerStatusPanel
            computer={computer}
            onUpdated={() => reexecute({ requestPolicy: "network-only" })}
          />
          <ComputerIdentityEditPanel
            computer={computer}
            onUpdated={() => reexecute({ requestPolicy: "network-only" })}
          />
          <ComputerAccessUsersTable
            computerId={computer.id}
            tenantId={computer.tenantId}
            refreshKey={accessRefreshKey}
            onUpdated={() => setAccessRefreshKey((value) => value + 1)}
          />
          <ComputerRuntimePanel computer={computer} />
        </div>
      ) : null}

      {tab === "terminal" ? (
        <ComputerTerminalTab computerId={computer.id} />
      ) : null}
    </PageLayout>
  );
}

function ComputerTerminalTab({ computerId }: { computerId: string }) {
  // Pin the terminal to viewport-minus-header height so xterm's internal
  // scrollback handles overflow, not the outer page. min-h floor keeps it
  // usable on short windows. h-[calc(...)] cap stops the container from
  // pushing the page scrollbar — the value lines up with the Computer
  // detail header (title + tabs + status badges + body padding ≈ 220px).
  return (
    <ComputerTerminal
      computerId={computerId}
      className="h-[calc(100vh-220px)] min-h-[420px]"
    />
  );
}

function ComputerDashboardTab({
  computer,
  onChanged: _onChanged,
}: {
  computer: Pick<
    Computer,
    "id" | "tenantId" | "slug" | "runtimeStatus" | "spentMonthlyCents"
  >;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const PAGE_SIZE = 10;
  const [pageIndex, setPageIndex] = useState(0);

  // Threads scoped to this Computer via the new computerId filter on
  // threadsPaged (plan U1). Same paginated path /threads uses.
  const [threadsResult] = useQuery({
    query: ThreadsPagedQuery,
    variables: {
      tenantId: computer.tenantId,
      computerId: computer.id,
      limit: PAGE_SIZE,
      offset: pageIndex * PAGE_SIZE,
      showArchived: false,
      sortField: "updated",
      sortDir: "desc",
    },
    requestPolicy: "cache-and-network",
  });
  const [agentsResult] = useQuery({
    query: AgentsListQuery,
    variables: { tenantId: computer.tenantId },
    requestPolicy: "cache-and-network",
  });
  const [, updateThread] = useMutation(UpdateThreadMutation);

  const threadItems: ThreadsTableItem[] = useMemo(
    () =>
      (
        (threadsResult.data?.threadsPaged?.items ?? []) as ThreadsTableItem[]
      ).map((t) => ({
        ...t,
        status: (t.status ?? "").toString().toLowerCase(),
      })),
    [threadsResult.data],
  );
  const totalCount = threadsResult.data?.threadsPaged?.totalCount ?? 0;
  const agents = agentsResult.data?.agents ?? [];

  const activeThreadIds = useActiveTurnsStore((s) => s._activeThreadIds);
  const inboxStatusFor = useCallback(
    (thread: ThreadsTableItem) =>
      computeThreadInboxStatus(
        thread.id,
        thread.lastTurnCompletedAt,
        thread.lastReadAt,
        activeThreadIds,
      ),
    [activeThreadIds],
  );

  const handleUpdateThread = useCallback(
    (id: string, data: Record<string, unknown>) => {
      const input: Record<string, unknown> = {};
      if (data.status) input.status = (data.status as string).toUpperCase();
      if (data.assigneeId !== undefined) input.assigneeId = data.assigneeId;
      if (data.assigneeType !== undefined)
        input.assigneeType = data.assigneeType;
      if (data.agentId !== undefined) {
        input.assigneeType = data.agentId ? "AGENT" : null;
        input.assigneeId = data.agentId || null;
      }
      updateThread({ id, input });
    },
    [updateThread],
  );

  const goToThread = useCallback(
    (threadId: string) =>
      navigate({ to: "/threads/$threadId", params: { threadId } }),
    [navigate],
  );

  // KPI strip pulls tasks/threads counts; both are no-ops post-U2 since
  // the queries are retired. Pass empty arrays — the metrics component
  // already handles that gracefully.
  return (
    <div className="space-y-4">
      <ComputerDashboardMetrics
        computer={computer}
        tasks={[]}
        threads={threadItems as never}
      />
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">
          Recent Threads
        </h2>
        <ThreadsTable
          items={threadItems}
          agents={agents}
          inboxStatusFor={inboxStatusFor}
          onUpdateThread={handleUpdateThread}
          onRowClick={goToThread}
          scope="computer"
          pagination={{
            totalCount,
            pageSize: PAGE_SIZE,
            pageIndex,
            onPageChange: setPageIndex,
          }}
        />
      </div>
      {threadsResult.error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {threadsResult.error.message}
        </div>
      ) : null}
    </div>
  );
}

function ComputerWorkspaceTab({ computerId }: { computerId: string }) {
  const target = useMemo(() => ({ computerId }), [computerId]);
  // Fill the parent (PageLayout content area is flex-column when the tab
  // is `workspace`), so the editor's own scrollback handles overflow and
  // no whitespace sits below the editor border.
  return (
    <WorkspaceEditor
      target={target}
      mode="computer"
      className="h-full min-h-[420px]"
    />
  );
}

// ArchiveAction was moved into ComputerStatusPanel (plan U4) so the
// destructive action lives next to the Computer status data, not in the
// page header where it competed with the title.
