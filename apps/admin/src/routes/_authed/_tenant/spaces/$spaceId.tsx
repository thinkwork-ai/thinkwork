import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import {
  Bot,
  CheckSquare,
  FolderKanban,
  Plug,
  Settings2,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import {
  ThreadsTable,
  computeThreadInboxStatus,
  type ThreadsTableItem,
} from "@/components/threads/ThreadsTable";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
import { type SpaceAdminDetailQuery as SpaceAdminDetailQueryResult } from "@/gql/graphql";
import {
  AgentsListQuery,
  SpaceAdminDetailQuery,
  ThreadsPagedQuery,
  UpdateThreadMutation,
} from "@/lib/graphql-queries";
import { relativeTime } from "@/lib/utils";
import { useActiveTurnsStore } from "@/stores/active-turns-store";

export const Route = createFileRoute("/_authed/_tenant/spaces/$spaceId")({
  component: SpaceDetailPage,
});

type TabValue =
  | "threads"
  | "agents"
  | "checklist"
  | "members"
  | "integrations"
  | "settings";
type Space = NonNullable<SpaceAdminDetailQueryResult["space"]>;
type SpaceAgentAssignment = Space["agentAssignments"][number];
type SpaceChecklistItem = Space["checklistTemplates"][number]["items"][number];
type SpaceMember = Space["members"][number];
type SpaceIntegration = Space["integrations"][number];

function SpaceDetailPage() {
  const { spaceId } = Route.useParams();
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabValue>("threads");
  const PAGE_SIZE = 25;
  const [pageIndex, setPageIndex] = useState(0);

  const [spaceResult] = useQuery({
    query: SpaceAdminDetailQuery,
    variables: { id: spaceId },
    pause: !spaceId,
    requestPolicy: "cache-and-network",
  });

  const space = spaceResult.data?.space ?? null;
  useBreadcrumbs([
    { label: "Spaces", href: "/spaces" },
    { label: space?.name ?? "Space" },
  ]);

  const [threadsResult] = useQuery({
    query: ThreadsPagedQuery,
    variables: {
      tenantId: tenantId!,
      spaceId,
      limit: PAGE_SIZE,
      offset: pageIndex * PAGE_SIZE,
      sortField: "updated",
      sortDir: "desc",
    },
    pause: !tenantId || !spaceId,
    requestPolicy: "cache-and-network",
  });
  const [agentsResult] = useQuery({
    query: AgentsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [, updateThread] = useMutation(UpdateThreadMutation);

  const activeThreadIds = useActiveTurnsStore((s) => s._activeThreadIds);
  const threads = useMemo<ThreadsTableItem[]>(
    () =>
      (threadsResult.data?.threadsPaged?.items ?? []).map((thread: any) => ({
        ...thread,
        status: String(thread.status).toLowerCase(),
      })),
    [threadsResult.data?.threadsPaged?.items],
  );

  if (!tenantId || (spaceResult.fetching && !spaceResult.data)) {
    return <PageSkeleton />;
  }

  if (!space) {
    return (
      <PageLayout
        header={
          <PageHeader
            title="Space not found"
            description={spaceResult.error?.message}
          />
        }
      >
        <div className="text-sm text-muted-foreground">
          The Space could not be loaded or is not available to this tenant.
        </div>
      </PageLayout>
    );
  }

  const activeAssignments = space.agentAssignments.filter(
    (assignment) => assignment.status === "ACTIVE",
  );
  const requiredChecklistItems = space.checklistTemplates.flatMap((template) =>
    template.items.filter((item) => item.required),
  );

  return (
    <PageLayout
      header={
        <>
          <PageHeader
            title={space.name}
            description={
              space.description ?? `${formatLabel(space.kind)} Space`
            }
          />
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">{formatLabel(space.kind)}</Badge>
            <Badge variant={space.status === "ACTIVE" ? "default" : "outline"}>
              {formatLabel(space.status)}
            </Badge>
            <span className="text-muted-foreground">
              Updated {relativeTime(space.updatedAt)}
            </span>
          </div>
        </>
      }
    >
      <Tabs value={tab} onValueChange={(value) => setTab(value as TabValue)}>
        <TabsList variant="line" className="mb-4">
          <TabsTrigger value="threads">
            <FolderKanban className="h-4 w-4" />
            Threads
          </TabsTrigger>
          <TabsTrigger value="agents">
            <Bot className="h-4 w-4" />
            Agents
          </TabsTrigger>
          <TabsTrigger value="checklist">
            <CheckSquare className="h-4 w-4" />
            Checklist
          </TabsTrigger>
          <TabsTrigger value="members">
            <Users className="h-4 w-4" />
            Members
          </TabsTrigger>
          <TabsTrigger value="integrations">
            <Plug className="h-4 w-4" />
            Integrations
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings2 className="h-4 w-4" />
            Config
          </TabsTrigger>
        </TabsList>

        <TabsContent value="threads">
          <ThreadsTable
            items={threads}
            agents={agentsResult.data?.agents ?? []}
            inboxStatusFor={(thread) =>
              computeThreadInboxStatus(
                thread.id,
                thread.lastTurnCompletedAt,
                thread.lastReadAt,
                activeThreadIds,
              )
            }
            onUpdateThread={(id, data) => {
              const input: Record<string, unknown> = {};
              if (data.status) input.status = String(data.status).toUpperCase();
              if (data.agentId !== undefined) {
                input.assigneeType = data.agentId ? "AGENT" : null;
                input.assigneeId = data.agentId || null;
              }
              updateThread({ id, input });
            }}
            onRowClick={(threadId) =>
              navigate({ to: "/threads/$threadId", params: { threadId } })
            }
            pagination={{
              totalCount: threadsResult.data?.threadsPaged?.totalCount ?? 0,
              pageSize: PAGE_SIZE,
              pageIndex,
              onPageChange: setPageIndex,
            }}
          />
        </TabsContent>

        <TabsContent value="agents">
          <DataTable
            columns={agentColumns}
            data={activeAssignments}
            pageSize={20}
            onRowClick={(row) => {
              if (row.agent?.id) {
                navigate({
                  to: "/agents/$agentId",
                  params: { agentId: row.agent.id },
                });
              }
            }}
          />
        </TabsContent>

        <TabsContent value="checklist">
          <div className="space-y-4">
            {space.checklistTemplates.map((template) => (
              <section key={template.id} className="rounded-md border">
                <div className="border-b px-3 py-2">
                  <div className="font-medium">{template.name}</div>
                  {template.description && (
                    <div className="text-xs text-muted-foreground">
                      {template.description}
                    </div>
                  )}
                </div>
                <DataTable
                  columns={checklistColumns}
                  data={[...template.items].sort(
                    (a, b) => a.sortOrder - b.sortOrder,
                  )}
                  pageSize={0}
                  hideHeader={false}
                />
              </section>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="members">
          <DataTable
            columns={memberColumns}
            data={space.members}
            pageSize={20}
          />
        </TabsContent>

        <TabsContent value="integrations">
          <DataTable
            columns={integrationColumns}
            data={space.integrations}
            pageSize={20}
          />
        </TabsContent>

        <TabsContent value="settings">
          <div className="grid gap-4 lg:grid-cols-2">
            <InfoPanel title="Space Prompt" value={space.prompt} />
            <InfoPanel title="Template Key" value={space.templateKey} />
            <InfoPanel
              title="Configured Agents"
              value={`${activeAssignments.length} active assignment${activeAssignments.length === 1 ? "" : "s"}`}
            />
            <InfoPanel
              title="Required Checklist Items"
              value={`${requiredChecklistItems.length} required item${requiredChecklistItems.length === 1 ? "" : "s"}`}
            />
            <InfoPanel
              title="Raw Config"
              value={formatJson(space.config)}
              wide
            />
          </div>
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}

const agentColumns: ColumnDef<SpaceAgentAssignment>[] = [
  {
    accessorKey: "agent",
    header: "Agent",
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="truncate font-medium">
          {row.original.agent?.name ?? "Unassigned agent"}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {row.original.agent?.slug ?? row.original.agentId}
        </div>
      </div>
    ),
  },
  {
    accessorKey: "localRole",
    header: "Space Role",
    cell: ({ row }) => row.original.localRole ?? "Member",
  },
  {
    accessorKey: "autoSubscribe",
    header: "Subscribe",
    cell: ({ row }) => (row.original.autoSubscribe ? "Auto" : "Manual"),
    size: 100,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant="outline">{formatLabel(row.original.status)}</Badge>
    ),
    size: 120,
  },
];

const checklistColumns: ColumnDef<SpaceChecklistItem>[] = [
  {
    accessorKey: "title",
    header: "Task",
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="truncate font-medium">{row.original.title}</div>
        {row.original.description && (
          <div className="truncate text-xs text-muted-foreground">
            {row.original.description}
          </div>
        )}
      </div>
    ),
  },
  {
    accessorKey: "roleKey",
    header: "Owner Role",
    cell: ({ row }) => row.original.roleKey ?? "Unassigned",
    size: 150,
  },
  {
    accessorKey: "required",
    header: "Required",
    cell: ({ row }) => (row.original.required ? "Yes" : "No"),
    size: 110,
  },
];

const memberColumns: ColumnDef<SpaceMember>[] = [
  {
    accessorKey: "user",
    header: "Member",
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="truncate font-medium">
          {row.original.user?.name ?? row.original.user?.email ?? "User"}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {row.original.user?.email ?? row.original.userId}
        </div>
      </div>
    ),
  },
  {
    accessorKey: "role",
    header: "Role",
    cell: ({ row }) => formatLabel(row.original.role),
  },
  {
    accessorKey: "notificationPreference",
    header: "Notifications",
    cell: ({ row }) => formatLabel(row.original.notificationPreference),
  },
];

const integrationColumns: ColumnDef<SpaceIntegration>[] = [
  {
    accessorKey: "provider",
    header: "Provider",
    cell: ({ row }) => formatLabel(row.original.provider),
  },
  {
    accessorKey: "writebackPolicy",
    header: "Writeback",
    cell: ({ row }) => formatLabel(row.original.writebackPolicy),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant="outline">{formatLabel(row.original.status)}</Badge>
    ),
  },
  {
    accessorKey: "webhookConfigRef",
    header: "Webhook Ref",
    cell: ({ row }) => row.original.webhookConfigRef ?? "-",
  },
];

function InfoPanel({
  title,
  value,
  wide = false,
}: {
  title: string;
  value?: string | null;
  wide?: boolean;
}) {
  return (
    <section
      className={
        wide ? "rounded-md border p-3 lg:col-span-2" : "rounded-md border p-3"
      }
    >
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm">
        {value || "-"}
      </pre>
    </section>
  );
}

function formatLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatJson(value: unknown) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}
