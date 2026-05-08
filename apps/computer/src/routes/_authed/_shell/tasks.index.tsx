import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "urql";
import {
  TaskDashboard,
  type TaskSummary,
} from "@/components/computer/TaskDashboard";
import { useTenant } from "@/context/TenantContext";
import { ComputerThreadsQuery, MyComputerQuery } from "@/lib/graphql-queries";

export const Route = createFileRoute("/_authed/_shell/tasks/")({
  component: TasksPage,
});

interface MyComputerResult {
  myComputer: { id: string; name?: string | null } | null;
}

interface ThreadsResult {
  threads: Array<{
    id: string;
    title?: string | null;
    status?: string | null;
    lifecycleStatus?: string | null;
    lastResponsePreview?: string | null;
    updatedAt?: string | null;
  }>;
}

function TasksPage() {
  const { tenantId } = useTenant();
  const [{ data: computerData }] = useQuery<MyComputerResult>({
    query: MyComputerQuery,
  });
  const computerId = computerData?.myComputer?.id ?? null;
  const threadsContext = useMemo(() => ({ additionalTypenames: ["Thread"] }), []);
  const [{ data, fetching, error }] = useQuery<ThreadsResult>({
    query: ComputerThreadsQuery,
    variables: {
      tenantId: tenantId ?? "",
      computerId: computerId ?? "",
      limit: 50,
    },
    pause: !tenantId || !computerId,
    context: threadsContext,
  });

  return (
    <TaskDashboard
      tasks={(data?.threads ?? []).map(toTaskSummary)}
      isLoading={fetching && !data}
      error={error?.message ?? null}
    />
  );
}

function toTaskSummary(thread: ThreadsResult["threads"][number]): TaskSummary {
  return {
    id: thread.id,
    title: thread.title,
    status: thread.status,
    lifecycleStatus: thread.lifecycleStatus,
    lastResponsePreview: thread.lastResponsePreview,
    updatedAt: thread.updatedAt,
  };
}
