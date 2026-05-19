import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Bot, ListChecks, Plus, PlugZap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useSubscription } from "urql";
import { Badge, Button, Separator } from "@thinkwork/ui";
import { LoadingShimmer } from "@/components/LoadingShimmer";
import { NewThreadDialog } from "@/components/NewThreadDialog";
import { SpaceThreadList } from "@/components/spaces/SpaceThreadList";
import { StartOnboardingDialog } from "@/components/spaces/StartOnboardingDialog";
import {
  formatSpaceLabel,
  type SpaceThreadSummary,
} from "@/components/spaces/space-types";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import {
  SpaceQuery,
  SpaceThreadsQuery,
  ThreadTurnUpdatedSubscription,
  ThreadUpdatedSubscription,
} from "@/lib/graphql-queries";

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId")({
  component: SpaceDetailPage,
});

interface SpaceResult {
  space?: {
    id: string;
    tenantId: string;
    name: string;
    description?: string | null;
    prompt?: string | null;
    kind?: string | null;
    checklistTemplates?: Array<{
      id: string;
      name: string;
      description?: string | null;
      items?: Array<{
        id: string;
        title: string;
        roleKey?: string | null;
        required: boolean;
        sortOrder: number;
      }> | null;
    }> | null;
    integrations?: Array<{
      id: string;
      provider: string;
      status: string;
      writebackPolicy: string;
    }> | null;
    agentAssignments?: Array<{
      id: string;
      localRole?: string | null;
      status: string;
      agent?: { id: string; name: string; slug?: string | null } | null;
    }> | null;
  } | null;
}

interface SpaceThreadsResult {
  threadsPaged?: {
    totalCount: number;
    items: SpaceThreadSummary[];
  } | null;
}

function SpaceDetailPage() {
  const { spaceId } = Route.useParams();
  const navigate = useNavigate();
  const { tenantId } = useTenant();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [newThreadOpen, setNewThreadOpen] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const [{ data: spaceData, fetching: fetchingSpace, error: spaceError }] =
    useQuery<SpaceResult>({
      query: SpaceQuery,
      variables: { id: spaceId },
      requestPolicy: "cache-and-network",
    });
  const [
    { data: threadsData, fetching: fetchingThreads, error: threadsError },
    reexecuteThreads,
  ] = useQuery<SpaceThreadsResult>({
    query: SpaceThreadsQuery,
    variables: {
      tenantId: tenantId ?? "",
      spaceId,
      search: debouncedSearch.trim() || undefined,
      limit: 100,
      offset: 0,
    },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [{ data: threadUpdate }] = useSubscription<{
    onThreadUpdated?: { tenantId?: string | null } | null;
  }>({
    query: ThreadUpdatedSubscription,
    variables: { tenantId },
    pause: !tenantId,
  });
  const [{ data: turnUpdate }] = useSubscription<{
    onThreadTurnUpdated?: { tenantId?: string | null } | null;
  }>({
    query: ThreadTurnUpdatedSubscription,
    variables: { tenantId },
    pause: !tenantId,
  });

  useEffect(() => {
    if (threadUpdate?.onThreadUpdated?.tenantId === tenantId) {
      reexecuteThreads({ requestPolicy: "network-only" });
    }
  }, [reexecuteThreads, tenantId, threadUpdate?.onThreadUpdated?.tenantId]);

  useEffect(() => {
    if (turnUpdate?.onThreadTurnUpdated?.tenantId === tenantId) {
      reexecuteThreads({ requestPolicy: "network-only" });
    }
  }, [reexecuteThreads, tenantId, turnUpdate?.onThreadTurnUpdated?.tenantId]);

  const space = spaceData?.space ?? null;
  const threads = threadsData?.threadsPaged?.items ?? [];
  const totalCount = threadsData?.threadsPaged?.totalCount ?? 0;
  const checklist = useMemo(
    () =>
      [...(space?.checklistTemplates?.[0]?.items ?? [])].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      ),
    [space?.checklistTemplates],
  );

  usePageHeaderActions({
    backHref: "/spaces",
    title: space?.name ?? "Space",
    subtitle: space?.description ?? undefined,
    documentTitle: space?.name ? `Space · ${space.name}` : "Space",
    action:
      tenantId && space ? (
        space.kind === "CUSTOMER_ONBOARDING" ? (
          <StartOnboardingDialog
            tenantId={tenantId}
            spaceId={space.id}
            onStarted={(threadId) => {
              reexecuteThreads({ requestPolicy: "network-only" });
              void navigate({
                to: "/spaces/$spaceId/threads/$threadId",
                params: { spaceId, threadId },
              });
            }}
          />
        ) : (
          <>
            <Button size="sm" onClick={() => setNewThreadOpen(true)}>
              <Plus className="size-4" />
              New Thread
            </Button>
            <NewThreadDialog
              open={newThreadOpen}
              onOpenChange={setNewThreadOpen}
              spaceId={space.id}
              spaceName={space.name}
            />
          </>
        )
      ) : null,
    actionKey: `space-actions:${spaceId}:${tenantId ?? ""}:${newThreadOpen}`,
  });

  if (spaceError) {
    return <SpaceDetailState label={spaceError.message} tone="error" />;
  }
  if (fetchingSpace && !space) {
    return (
      <main className="flex h-full items-center justify-center bg-background">
        <LoadingShimmer />
      </main>
    );
  }
  if (!space) {
    return <SpaceDetailState label="Space not found" />;
  }

  return (
    <main className="grid h-full min-h-0 grid-cols-1 overflow-hidden bg-background lg:grid-cols-[minmax(320px,420px)_1fr]">
      <SpaceThreadList
        spaceId={space.id}
        threads={threads}
        totalCount={totalCount}
        search={search}
        isLoading={fetchingThreads && !threadsData}
        error={threadsError?.message ?? null}
        onSearchChange={setSearch}
      />
      <section className="min-h-0 overflow-y-auto p-4">
        <div className="mx-auto grid max-w-3xl gap-4">
          <SpaceOverview
            prompt={space.prompt}
            checklist={checklist}
            integrations={space.integrations ?? []}
            agentAssignments={space.agentAssignments ?? []}
          />
        </div>
      </section>
    </main>
  );
}

function SpaceOverview({
  prompt,
  checklist,
  integrations,
  agentAssignments,
}: {
  prompt?: string | null;
  checklist: Array<{
    id: string;
    title: string;
    roleKey?: string | null;
    required: boolean;
  }>;
  integrations: Array<{
    id: string;
    provider: string;
    status: string;
    writebackPolicy: string;
  }>;
  agentAssignments: Array<{
    id: string;
    localRole?: string | null;
    status: string;
    agent?: { id: string; name: string; slug?: string | null } | null;
  }>;
}) {
  return (
    <>
      <section className="rounded-md border bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ListChecks className="size-4 text-primary" />
          Checklist
        </div>
        <div className="mt-3 space-y-2">
          {checklist.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate">{item.title}</span>
              <div className="flex shrink-0 items-center gap-2">
                {item.roleKey ? (
                  <Badge variant="outline" className="rounded-full text-xs">
                    {formatSpaceLabel(item.roleKey)}
                  </Badge>
                ) : null}
                {item.required ? (
                  <Badge className="rounded-full text-xs">Required</Badge>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-md border bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bot className="size-4 text-primary" />
          Agents
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {agentAssignments.length === 0 ? (
            <span className="text-sm text-muted-foreground">None assigned</span>
          ) : (
            agentAssignments.map((assignment) => (
              <Badge
                key={assignment.id}
                variant="outline"
                className="rounded-full"
              >
                {assignment.agent?.name ?? assignment.localRole ?? "Agent"}
              </Badge>
            ))
          )}
        </div>
        {prompt ? (
          <>
            <Separator className="my-4" />
            <p className="text-sm text-muted-foreground">{prompt}</p>
          </>
        ) : null}
      </section>
      <section className="rounded-md border bg-card p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <PlugZap className="size-4 text-primary" />
          Integrations
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {integrations.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              Not configured
            </span>
          ) : (
            integrations.map((integration) => (
              <Badge
                key={integration.id}
                variant="outline"
                className="rounded-full"
              >
                {formatSpaceLabel(integration.provider)} ·{" "}
                {formatSpaceLabel(integration.writebackPolicy)}
              </Badge>
            ))
          )}
        </div>
      </section>
    </>
  );
}

function SpaceDetailState({
  label,
  tone = "default",
}: {
  label: string;
  tone?: "default" | "error";
}) {
  return (
    <main
      className={`flex h-full items-center justify-center bg-background px-4 text-center text-sm ${
        tone === "error" ? "text-destructive" : "text-muted-foreground"
      }`}
    >
      {label}
    </main>
  );
}
