import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "urql";
import { ArrowLeft, Monitor, User } from "lucide-react";
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
import { ComputerDetailQuery } from "@/lib/graphql-queries";
import { formatDateTime } from "@/lib/utils";
import { ComputerStatusPanel } from "./-components/ComputerStatusPanel";
import { ComputerRuntimePanel } from "./-components/ComputerRuntimePanel";
import { ComputerMigrationPanel } from "./-components/ComputerMigrationPanel";

export const Route = createFileRoute("/_authed/_tenant/computers/$computerId")({
  component: ComputerDetailPage,
});

function ComputerDetailPage() {
  const { computerId } = Route.useParams();
  const navigate = useNavigate();
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

  return (
    <PageLayout
      contentClassName="space-y-4"
      header={
        <PageHeader
          title={computer.name}
          description="Durable workplace, runtime state, and migration provenance."
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
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <ComputerStatusPanel
            computer={computer}
            onUpdated={() => reexecute({ requestPolicy: "network-only" })}
          />
          <ComputerRuntimePanel computer={computer} />
          <ComputerMigrationPanel computer={computer} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Identity</CardTitle>
            <CardDescription>
              Owner, template, and creation metadata.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4">
              <div>
                <dt className="text-xs font-medium text-muted-foreground">
                  Owner
                </dt>
                <dd className="mt-1 flex min-w-0 items-center gap-2 text-sm">
                  <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{ownerLabel}</span>
                </dd>
              </div>
              <div>
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
              <div>
                <dt className="text-xs font-medium text-muted-foreground">
                  Slug
                </dt>
                <dd className="mt-1 text-sm">{computer.slug}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">
                  Created
                </dt>
                <dd className="mt-1 text-sm">
                  {formatDateTime(computer.createdAt)}
                </dd>
              </div>
              <div>
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
      </div>
    </PageLayout>
  );
}
