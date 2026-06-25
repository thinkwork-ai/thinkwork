import {
  Link,
  Outlet,
  createFileRoute,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useQuery } from "urql";
import {
  AlertCircle,
  CalendarClock,
  ListTodo,
  MessageCirclePlus,
} from "lucide-react";
import { IconFiles } from "@tabler/icons-react";
import { Button } from "@thinkwork/ui";
import { WorkspaceFileEditor } from "@thinkwork/workspace-editor";
import { StartOnboardingDialog } from "@/components/spaces/StartOnboardingDialog";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  desktopToolbarActiveButtonClassName,
  desktopToolbarButtonClassName,
} from "@/lib/desktop-chrome";
import {
  SpaceQuery,
  SpaceThreadsQuery,
  WorkItemsQuery,
} from "@/lib/graphql-queries";
import { spacesWorkspaceFilesClient } from "@/lib/workspace-files-api";
import {
  formatRelativeDate,
  threadTitle,
} from "@/components/shell/chat-sidebar-types";
import {
  isWorkItemDueSoon,
  isWorkItemOpen,
  type WorkItemSummary,
} from "@/components/work-items/work-item-display";
import {
  DEFAULT_WORK_ITEM_SEARCH,
  workItemRouteSearchToParams,
  type WorkItemRouteSearch,
} from "@/components/work-items/work-item-filters";

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId")({
  component: SpaceWorkroomPage,
});

interface SpaceResult {
  space?: {
    id: string;
    name?: string | null;
    description?: string | null;
    prompt?: string | null;
    kind?: string | null;
    templateKey?: string | null;
  } | null;
}

interface SpaceThreadsResult {
  threadsPaged?: {
    totalCount?: number | null;
    items?: Array<{
      id: string;
      title?: string | null;
      lastActivityAt?: string | null;
      lastTurnCompletedAt?: string | null;
      updatedAt?: string | null;
      createdAt?: string | null;
    }> | null;
  } | null;
}

interface SpaceWorkItemsResult {
  workItems?: WorkItemSummary[] | null;
}

function SpaceWorkroomPage() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  if (/^\/spaces\/[^/]+\/threads\/[^/]+$/.test(pathname)) {
    return <Outlet />;
  }

  return <SpaceWorkroomHome />;
}

function SpaceWorkroomHome() {
  const { spaceId } = Route.useParams();
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const spaceFilesState = useRouterState({
    select: (state) => {
      const locationState = state.location.state as
        | {
            openSpaceFiles?: unknown;
            defaultOpenFile?: unknown;
          }
        | undefined;
      return {
        openSpaceFiles: locationState?.openSpaceFiles === true,
        defaultOpenFile:
          typeof locationState?.defaultOpenFile === "string"
            ? locationState.defaultOpenFile
            : "CONTEXT.md",
      };
    },
  });
  const [filesModeOpen, setFilesModeOpen] = useState(
    spaceFilesState.openSpaceFiles,
  );
  const [{ data: spaceData, fetching: spaceFetching, error: spaceError }] =
    useQuery<SpaceResult>({
      query: SpaceQuery,
      variables: { id: spaceId },
      requestPolicy: "cache-and-network",
    });
  const [
    { data: threadsData, fetching: threadsFetching, error: threadsError },
  ] = useQuery<SpaceThreadsResult>({
    query: SpaceThreadsQuery,
    variables: {
      tenantId: tenantId ?? "",
      spaceId,
      limit: 40,
      offset: 0,
    },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [
    { data: workItemsData, fetching: workItemsFetching, error: workItemsError },
  ] = useQuery<SpaceWorkItemsResult>({
    query: WorkItemsQuery,
    variables: {
      input: {
        tenantId: tenantId ?? "",
        spaceId,
        includeArchived: false,
        limit: 100,
      },
    },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  const spaceName =
    spaceData?.space?.name?.trim() || (spaceFetching ? "Space" : "Space");
  usePageHeaderActions({
    title: spaceName,
    documentTitle: `Spaces > ${spaceName}`,
    breadcrumbs: [{ label: "Spaces", href: "/new" }, { label: spaceName }],
    action: (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={
          filesModeOpen
            ? "Close Space workspace files"
            : "Open Space workspace files"
        }
        title={
          filesModeOpen
            ? "Close Space workspace files"
            : "Open Space workspace files"
        }
        className={
          filesModeOpen
            ? desktopToolbarActiveButtonClassName
            : desktopToolbarButtonClassName
        }
        onClick={() => setFilesModeOpen((current) => !current)}
      >
        <IconFiles className="size-4" />
      </Button>
    ),
    actionKey: `space-files:${spaceId}:${filesModeOpen ? "open" : "closed"}`,
  });

  const threads = threadsData?.threadsPaged?.items ?? [];
  const workItems = workItemsData?.workItems ?? [];
  const workItemSummary = summarizeSpaceWorkItems(workItems);
  const isCustomerOnboardingSpace = shouldShowCustomerOnboardingStart(
    spaceData?.space,
  );

  if (filesModeOpen) {
    return (
      <main className="flex h-full min-h-0 w-full flex-col bg-background p-4">
        <WorkspaceFileEditor
          target={{ spaceId }}
          targetKey={`space:${spaceId}`}
          client={spacesWorkspaceFilesClient}
          defaultOpenFile={spaceFilesState.defaultOpenFile}
          className="min-h-0 flex-1"
        />
      </main>
    );
  }

  return (
    <main className="flex w-full flex-1 flex-col gap-5 p-4">
      {spaceError ? (
        <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          {spaceError.message}
        </div>
      ) : null}
      <section className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-normal">
              {spaceName}
            </h1>
          </div>
          {isCustomerOnboardingSpace && tenantId ? (
            <StartOnboardingDialog
              tenantId={tenantId}
              spaceId={spaceId}
              onStarted={(threadId) => {
                void navigate({
                  to: "/spaces/$spaceId/threads/$threadId",
                  params: { spaceId, threadId },
                });
              }}
            />
          ) : (
            <Button asChild>
              <Link to="/new" search={{ spaceId }}>
                <MessageCirclePlus className="size-4" />
                <span>New chat</span>
              </Link>
            </Button>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Work Items
          </h2>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
          >
            <Link
              to="/work-items"
              search={
                workItemRouteSearchToParams({
                  ...DEFAULT_WORK_ITEM_SEARCH,
                  view: "board",
                  spaceId,
                }) as unknown as WorkItemRouteSearch
              }
            >
              <ListTodo className="size-4" />
              <span>Open board</span>
            </Link>
          </Button>
        </div>
        {workItemsError ? (
          <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
            {workItemsError.message}
          </div>
        ) : workItemsFetching && workItems.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Loading Work Items...
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            <SpaceWorkItemMetric
              label="Open required"
              value={workItemSummary.openRequired}
              icon={<ListTodo className="size-4" />}
            />
            <SpaceWorkItemMetric
              label="Blocked"
              value={workItemSummary.blocked}
              icon={<AlertCircle className="size-4" />}
              destructive={workItemSummary.blocked > 0}
            />
            <SpaceWorkItemMetric
              label="Due soon"
              value={workItemSummary.dueSoon}
              icon={<CalendarClock className="size-4" />}
            />
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          Recent threads
        </h2>
        {threadsError ? (
          <div className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
            {threadsError.message}
          </div>
        ) : threadsFetching && threads.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Loading threads...
          </div>
        ) : threads.length === 0 ? (
          <div className="rounded-md border p-6 text-sm text-muted-foreground">
            No threads yet.
          </div>
        ) : (
          <div className="divide-y rounded-md border">
            {threads.map((thread) => (
              <Link
                key={thread.id}
                to="/spaces/$spaceId/threads/$threadId"
                params={{ spaceId, threadId: thread.id }}
                className="flex min-w-0 items-center justify-between gap-3 p-3 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 truncate text-sm">
                  {threadTitle(thread)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatRelativeDate(
                    thread.lastActivityAt ??
                      thread.lastTurnCompletedAt ??
                      thread.updatedAt ??
                      thread.createdAt,
                  )}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function SpaceWorkItemMetric({
  label,
  value,
  icon,
  destructive,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  destructive?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-md border p-3">
      <div
        className={`flex size-8 shrink-0 items-center justify-center rounded-md bg-muted ${
          destructive ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-lg font-semibold tabular-nums">{value}</div>
        <div className="truncate text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

export function summarizeSpaceWorkItems(items: WorkItemSummary[]) {
  return {
    openRequired: items.filter(
      (item) => item.required && item.applicable && isWorkItemOpen(item),
    ).length,
    blocked: items.filter((item) => item.blocked && isWorkItemOpen(item))
      .length,
    dueSoon: items.filter(
      (item) => isWorkItemOpen(item) && isWorkItemDueSoon(item.dueAt),
    ).length,
  };
}

export function shouldShowCustomerOnboardingStart(
  space?: {
    kind?: string | null;
    templateKey?: string | null;
  } | null,
) {
  return (
    normalizeSpaceValue(space?.kind) === "customer_onboarding" ||
    normalizeSpaceValue(space?.templateKey) === "customer_onboarding"
  );
}

function normalizeSpaceValue(value?: string | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
}
