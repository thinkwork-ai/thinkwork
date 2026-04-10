import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "urql";
import { AgentDetailQuery } from "@/lib/graphql-queries";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { PageSkeleton } from "@/components/PageSkeleton";
import { PageLayout } from "@/components/PageLayout";
import { AgentScheduledJobs } from "@/components/agents/AgentScheduledJobs";

export const Route = createFileRoute("/_authed/_tenant/agents/$agentId_/scheduled-jobs/")({
  component: AgentScheduledJobsPage,
});

function AgentScheduledJobsPage() {
  const { agentId } = Route.useParams();

  const [result] = useQuery({
    query: AgentDetailQuery,
    variables: { id: agentId },
  });

  const agent = result.data?.agent;

  useBreadcrumbs([
    { label: "Agents", href: "/agents" },
    { label: agent?.name ?? "...", href: `/agents/${agentId}` },
    { label: "Automations" },
  ]);

  if (result.fetching && !result.data) return <PageSkeleton />;

  return (
    <PageLayout
      header={
        <h1 className="text-2xl font-bold tracking-tight leading-tight text-foreground">
          Schedules
        </h1>
      }
    >
      <AgentScheduledJobs agentId={agentId} />
    </PageLayout>
  );
}
