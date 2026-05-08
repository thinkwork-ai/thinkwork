import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "urql";
import {
  TaskThreadView,
  type TaskThread,
} from "@/components/computer/TaskThreadView";
import { ComputerThreadQuery } from "@/lib/graphql-queries";

export const Route = createFileRoute("/_authed/_shell/tasks/$id")({
  component: TaskDetailPage,
});

interface ThreadResult {
  thread: {
    id: string;
    title?: string | null;
    status?: string | null;
    lifecycleStatus?: string | null;
    costSummary?: number | null;
    messages?: {
      edges?: Array<{
        node: {
          id: string;
          role: string;
          content?: string | null;
          createdAt?: string | null;
          durableArtifact?: {
            id: string;
            title: string;
            type?: string | null;
            summary?: string | null;
            metadata?: unknown;
          } | null;
        };
      }>;
    } | null;
  } | null;
}

function TaskDetailPage() {
  const { id } = Route.useParams();
  const [{ data, fetching, error }] = useQuery<ThreadResult>({
    query: ComputerThreadQuery,
    variables: { id, messageLimit: 100 },
  });

  return (
    <TaskThreadView
      thread={data?.thread ? toTaskThread(data.thread) : null}
      isLoading={fetching && !data}
      error={error?.message ?? null}
    />
  );
}

function toTaskThread(thread: NonNullable<ThreadResult["thread"]>): TaskThread {
  return {
    id: thread.id,
    title: thread.title,
    status: thread.status,
    lifecycleStatus: thread.lifecycleStatus,
    costSummary: thread.costSummary,
    messages: (thread.messages?.edges ?? []).map(({ node }) => ({
      id: node.id,
      role: node.role,
      content: node.content,
      createdAt: node.createdAt,
      durableArtifact: node.durableArtifact
        ? {
            id: node.durableArtifact.id,
            title: node.durableArtifact.title,
            type: node.durableArtifact.type,
            summary: node.durableArtifact.summary,
            metadata: metadataObject(node.durableArtifact.metadata),
          }
        : null,
    })),
  };
}

function metadataObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}
