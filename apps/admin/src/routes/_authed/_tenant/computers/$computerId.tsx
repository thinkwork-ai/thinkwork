import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import {
  Archive,
  ArrowLeft,
  DollarSign,
  Loader2,
  Monitor,
  Server,
  User,
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
import {
  ComputerDetailQuery,
  ComputerEventsQuery,
  ComputerTasksQuery,
  ComputerThreadsQuery,
  UpdateComputerMutation,
} from "@/lib/graphql-queries";
import { formatUsd } from "@/lib/utils";
import { ComputerStatus, type Computer } from "@/gql/graphql";
import { ComputerStatusPanel } from "./-components/ComputerStatusPanel";
import { ComputerRuntimePanel } from "./-components/ComputerRuntimePanel";
import { ComputerMigrationPanel } from "./-components/ComputerMigrationPanel";
import { ComputerLiveTasksPanel } from "./-components/ComputerLiveTasksPanel";
import { ComputerEventsPanel } from "./-components/ComputerEventsPanel";
import { ComputerDashboardMetrics } from "./-components/ComputerDashboardMetrics";
import { ComputerDashboardActivity } from "./-components/ComputerDashboardActivity";
import { ComputerIdentityEditPanel } from "./-components/ComputerIdentityEditPanel";
import { ComputerTerminal } from "./-components/ComputerTerminal";
import { WorkspaceEditor } from "@/components/agent-builder/WorkspaceEditor";

export const Route = createFileRoute("/_authed/_tenant/computers/$computerId")({
  component: ComputerDetailPage,
  validateSearch: (search: Record<string, unknown>) => ({
    tab: parseComputerTab(search.tab),
  }),
});

type ComputerDetailTab = "dashboard" | "workspace" | "config" | "terminal";

function parseComputerTab(value: unknown): ComputerDetailTab {
  if (value === "workspace" || value === "config" || value === "terminal") {
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
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);
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
  const refreshActivity = () => {
    reexecute({ requestPolicy: "network-only" });
    setActivityRefreshKey((key) => key + 1);
  };

  return (
    <PageLayout
      contentClassName="space-y-4"
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
                  <TabsTrigger value="config" asChild className="px-4">
                    <Link
                      to="/computers/$computerId"
                      params={{ computerId }}
                      search={{ tab: "config" }}
                    >
                      Config
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
              <User className="h-3 w-3" />
              {ownerLabel}
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
              <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-300">
                <Archive className="h-3 w-3" />
                Archived
              </Badge>
            ) : (
              <ArchiveAction
                computerId={computer.id}
                computerName={computer.name}
                onArchived={() => navigate({ to: "/computers" })}
              />
            )}
          </div>
        </div>
      }
    >
      {tab === "dashboard" ? (
        <ComputerDashboardTab computer={computer} onChanged={refreshActivity} />
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
          <ComputerRuntimePanel computer={computer} />
          <ComputerEventsPanel
            computer={computer}
            refreshKey={activityRefreshKey}
          />
          <ComputerMigrationPanel computer={computer} />
        </div>
      ) : null}

      {tab === "terminal" ? (
        <ComputerTerminalTab computerId={computer.id} />
      ) : null}
    </PageLayout>
  );
}

function ComputerTerminalTab({ computerId }: { computerId: string }) {
  return <ComputerTerminal computerId={computerId} className="min-h-[650px]" />;
}

function ComputerDashboardTab({
  computer,
  onChanged,
}: {
  computer: Pick<
    Computer,
    "id" | "tenantId" | "slug" | "runtimeStatus" | "spentMonthlyCents"
  >;
  onChanged: () => void;
}) {
  const [tasksResult, reexecuteTasks] = useQuery({
    query: ComputerTasksQuery,
    variables: { computerId: computer.id, limit: 50 },
    requestPolicy: "cache-and-network",
  });
  const [threadsResult, reexecuteThreads] = useQuery({
    query: ComputerThreadsQuery,
    variables: {
      tenantId: computer.tenantId,
      computerId: computer.id,
      limit: 50,
    },
    requestPolicy: "cache-and-network",
  });
  const [eventsResult, reexecuteEvents] = useQuery({
    query: ComputerEventsQuery,
    variables: { computerId: computer.id, limit: 24 },
    requestPolicy: "cache-and-network",
  });

  const tasks = tasksResult.data?.computerTasks ?? [];
  const threads = threadsResult.data?.threads ?? [];
  const events = eventsResult.data?.computerEvents ?? [];

  function refreshDashboard() {
    reexecuteTasks({ requestPolicy: "network-only" });
    reexecuteThreads({ requestPolicy: "network-only" });
    reexecuteEvents({ requestPolicy: "network-only" });
    onChanged();
  }

  return (
    <div className="space-y-4">
      <ComputerDashboardMetrics
        computer={computer}
        tasks={tasks}
        threads={threads}
      />
      <ComputerDashboardActivity
        tasks={tasks}
        threads={threads}
        events={events}
        onRefresh={refreshDashboard}
      />
      <ComputerLiveTasksPanel
        computer={computer}
        onChanged={refreshDashboard}
      />
      {tasksResult.error || threadsResult.error || eventsResult.error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          {tasksResult.error?.message ??
            threadsResult.error?.message ??
            eventsResult.error?.message}
        </div>
      ) : null}
    </div>
  );
}

function ComputerWorkspaceTab({ computerId }: { computerId: string }) {
  const target = useMemo(() => ({ computerId }), [computerId]);
  return (
    <WorkspaceEditor
      target={target}
      mode="computer"
      className="min-h-[650px]"
    />
  );
}

function ArchiveAction({
  computerId,
  computerName,
  onArchived,
}: {
  computerId: string;
  computerName: string;
  onArchived: () => void;
}) {
  const [{ fetching }, updateComputer] = useMutation(UpdateComputerMutation);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive() {
    setError(null);
    const result = await updateComputer({
      id: computerId,
      input: { status: ComputerStatus.Archived },
    });
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    onArchived();
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive ml-auto h-6 gap-1 px-2 text-xs"
        >
          <Archive className="h-3 w-3" />
          Archive
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive this Computer?</AlertDialogTitle>
          <AlertDialogDescription>
            Archiving "{computerName}" hides it from the default Computers list
            and frees the owner's active-Computer slot, so they become eligible
            for a new Computer. Toggle "Show archived" on the list to view it
            again. This action cannot be reversed in-place — re-provisioning
            the owner creates a new Computer record.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={fetching}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void archive();
            }}
            disabled={fetching}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {fetching ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Archiving...
              </>
            ) : (
              "Archive"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
