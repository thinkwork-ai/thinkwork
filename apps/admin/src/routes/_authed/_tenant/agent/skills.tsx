import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "urql";
import { PageSkeleton } from "@/components/PageSkeleton";
import { TenantAgentSkillsTab } from "@/components/tenant-agent/TenantAgentSkillsTab";
import { useTenant } from "@/context/TenantContext";
import { TenantAgentQuery } from "@/lib/graphql-queries";

export const Route = createFileRoute("/_authed/_tenant/agent/skills")({
  component: AgentSkillsPage,
});

function AgentSkillsPage() {
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

  return <TenantAgentSkillsTab />;
}
