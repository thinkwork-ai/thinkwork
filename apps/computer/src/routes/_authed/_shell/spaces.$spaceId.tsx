import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "urql";
import { MessageCirclePlus } from "lucide-react";
import { Button } from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { SpaceQuery, SpaceThreadsQuery } from "@/lib/graphql-queries";
import {
  formatRelativeDate,
  threadTitle,
} from "@/components/shell/chat-sidebar-types";

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId")({
  component: SpaceWorkroomPage,
});

interface SpaceResult {
  space?: {
    id: string;
    name?: string | null;
    description?: string | null;
    prompt?: string | null;
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

function SpaceWorkroomPage() {
  const { spaceId } = Route.useParams();
  const { tenantId } = useTenant();
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

  const spaceName =
    spaceData?.space?.name?.trim() || (spaceFetching ? "Space" : "Space");
  usePageHeaderActions({ title: spaceName });

  const threads = threadsData?.threadsPaged?.items ?? [];

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 p-4 md:p-8">
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
            {spaceData?.space?.description ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {spaceData.space.description}
              </p>
            ) : null}
          </div>
          <Button asChild>
            <Link to="/new" search={{ spaceId }}>
              <MessageCirclePlus className="size-4" />
              <span>New chat</span>
            </Link>
          </Button>
        </div>
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
