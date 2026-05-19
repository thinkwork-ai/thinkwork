import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import { ComputerThreadDetailRoute } from "@/components/computer/ComputerThreadDetailRoute";
import { OnboardingChecklistPanel } from "@/components/spaces/OnboardingChecklistPanel";
import {
  sourceContextFromThreadMetadata,
  type LinkedTaskSummary,
} from "@/components/spaces/space-types";
import { useTenant } from "@/context/TenantContext";
import {
  SpaceThreadContextQuery,
  ThreadLinkedTasksQuery,
  UpdateThreadMutation,
} from "@/lib/graphql-queries";

export const Route = createFileRoute(
  "/_authed/_shell/spaces/$spaceId/threads/$threadId",
)({
  component: SpaceThreadDetailPage,
});

interface SpaceThreadContextResult {
  thread?: {
    id: string;
    title?: string | null;
    status?: string | null;
    channel?: string | null;
    spaceId?: string | null;
    metadata?: unknown;
    archivedAt?: string | null;
    participants?: Array<{
      id: string;
      participantType?: string | null;
      role?: string | null;
      user?: { id: string; name?: string | null; email?: string | null } | null;
      agent?: { id: string; name?: string | null; slug?: string | null } | null;
    }> | null;
  } | null;
}

interface ThreadLinkedTasksResult {
  threadLinkedTasks?: LinkedTaskSummary[] | null;
}

function SpaceThreadDetailPage() {
  const { spaceId, threadId } = Route.useParams();
  const { tenantId } = useTenant();
  const [{ data: contextData, fetching: fetchingContext }, reexecuteContext] =
    useQuery<SpaceThreadContextResult>({
      query: SpaceThreadContextQuery,
      variables: { id: threadId },
      requestPolicy: "cache-and-network",
    });
  const [
    { data: taskData, fetching: fetchingTasks, error: taskError },
    reexecuteTasks,
  ] = useQuery<ThreadLinkedTasksResult>({
    query: ThreadLinkedTasksQuery,
    variables: { tenantId: tenantId ?? "", threadId },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });
  const [{ fetching: archiving }, updateThread] =
    useMutation(UpdateThreadMutation);
  const thread = contextData?.thread ?? null;

  if (thread?.spaceId && thread.spaceId !== spaceId) {
    return (
      <main className="flex h-full items-center justify-center bg-background px-4 text-center text-sm text-muted-foreground">
        Thread not found in this Space.
      </main>
    );
  }

  return (
    <main className="grid h-full min-h-0 grid-cols-1 overflow-hidden bg-background xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-h-0 min-w-0">
        <ComputerThreadDetailRoute
          threadId={threadId}
          backHref={`/spaces/${spaceId}`}
          documentTitlePrefix="Space Thread"
        />
      </div>
      <OnboardingChecklistPanel
        tasks={taskData?.threadLinkedTasks ?? []}
        sourceContext={sourceContextFromThreadMetadata(thread?.metadata)}
        isLoading={(fetchingContext && !thread) || (fetchingTasks && !taskData)}
        error={taskError?.message ?? null}
        archivedAt={thread?.archivedAt}
        isArchiving={archiving}
        onArchive={async () => {
          const result = await updateThread({
            id: threadId,
            input: { archivedAt: new Date().toISOString() },
          });
          if (result.error) {
            toast.error(`Could not archive Thread: ${result.error.message}`);
            return;
          }
          toast.success("Thread archived.");
          reexecuteContext({ requestPolicy: "network-only" });
          reexecuteTasks({ requestPolicy: "network-only" });
        }}
      />
    </main>
  );
}
