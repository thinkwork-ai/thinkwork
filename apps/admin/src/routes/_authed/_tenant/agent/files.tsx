import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "urql";
import { PageSkeleton } from "@/components/PageSkeleton";
import { TenantAgentWorkspaceTab } from "@/components/tenant-agent/TenantAgentWorkspaceTab";
import { useTenant } from "@/context/TenantContext";
import { TenantAgentQuery } from "@/lib/graphql-queries";

export const Route = createFileRoute("/_authed/_tenant/agent/files")({
  component: AgentFilesPage,
});

function AgentFilesPage() {
  const { tenantId } = useTenant();
  const [result] = useQuery({
    query: TenantAgentQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  if (!tenantId || (result.fetching && !result.data)) return <PageSkeleton />;

  const agent = result.data?.agent ?? null;
  if (!agent) return null;

  return <TenantAgentWorkspaceTab agentId={agent.id} />;
}
