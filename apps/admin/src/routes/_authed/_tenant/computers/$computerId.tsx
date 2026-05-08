import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "urql";
import {
  ArrowLeft,
  Bot,
  DollarSign,
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ComputerDetailQuery } from "@/lib/graphql-queries";
import { formatDateTime, formatUsd } from "@/lib/utils";
import { type Computer } from "@/gql/graphql";
import { ComputerStatusPanel } from "./-components/ComputerStatusPanel";
import { ComputerRuntimePanel } from "./-components/ComputerRuntimePanel";
import { ComputerMigrationPanel } from "./-components/ComputerMigrationPanel";
import { ComputerLiveTasksPanel } from "./-components/ComputerLiveTasksPanel";
import { ComputerEventsPanel } from "./-components/ComputerEventsPanel";
import { WorkspaceEditor } from "@/components/agent-builder/WorkspaceEditor";

export const Route = createFileRoute("/_authed/_tenant/computers/$computerId")({
  component: ComputerDetailPage,
  validateSearch: (search: Record<string, unknown>) => ({
    tab: parseComputerTab(search.tab),
  }),
});

type ComputerDetailTab = "dashboard" | "workspace" | "config";

function parseComputerTab(value: unknown): ComputerDetailTab {
  if (value === "workspace" || value === "config") return value;
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
              <Bot className="h-3 w-3" />
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
          </div>
        </div>
      }
    >
      {tab === "dashboard" ? (
        <div className="space-y-4">
          <ComputerStatusPanel
            computer={computer}
            onUpdated={() => reexecute({ requestPolicy: "network-only" })}
          />
          <ComputerLiveTasksPanel
            computer={computer}
            onChanged={refreshActivity}
          />
          <ComputerEventsPanel
            computer={computer}
            refreshKey={activityRefreshKey}
          />
          <ComputerRuntimePanel computer={computer} />
          <IdentityCard computer={computer} ownerLabel={ownerLabel} />
        </div>
      ) : null}

      {tab === "workspace" ? (
        <WorkspaceEditor
          target={{ computerId: computer.id }}
          mode="computer"
          className="min-h-[650px]"
        />
      ) : null}

      {tab === "config" ? (
        <div className="space-y-4">
          <ComputerRuntimePanel computer={computer} />
          <ComputerMigrationPanel computer={computer} />
          <IdentityCard computer={computer} ownerLabel={ownerLabel} />
        </div>
      ) : null}
    </PageLayout>
  );
}

function IdentityCard({
  computer,
  ownerLabel,
}: {
  computer: Pick<Computer, "slug" | "createdAt" | "updatedAt" | "template">;
  ownerLabel: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Identity</CardTitle>
        <CardDescription>
          Owner, template, and creation metadata.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="min-w-0">
            <dt className="text-xs font-medium text-muted-foreground">Owner</dt>
            <dd className="mt-1 flex min-w-0 items-center gap-2 text-sm">
              <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{ownerLabel}</span>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium text-muted-foreground">
              Template
            </dt>
            <dd className="mt-1">
              {computer.template ? (
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="text-xs">
                    {computer.template.name}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {computer.template.templateKind}
                  </Badge>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium text-muted-foreground">Slug</dt>
            <dd className="mt-1 break-all text-sm">{computer.slug}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium text-muted-foreground">
              Created
            </dt>
            <dd className="mt-1 text-sm">
              {formatDateTime(computer.createdAt)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium text-muted-foreground">
              Updated
            </dt>
            <dd className="mt-1 text-sm">
              {formatDateTime(computer.updatedAt)}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
