import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "urql";
import { PageSkeleton } from "@/components/PageSkeleton";
import { TenantAgentConfigSection } from "@/components/tenant-agent/TenantAgentConfigSection";
import { useTenant } from "@/context/TenantContext";
import { TenantAgentQuery } from "@/lib/graphql-queries";

export const Route = createFileRoute("/_authed/_tenant/agent/config")({
  component: AgentConfigPage,
});

function AgentConfigPage() {
  const { tenantId } = useTenant();
  const [result, reexecute] = useQuery({
    query: TenantAgentQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  if (!tenantId || (result.fetching && !result.data)) return <PageSkeleton />;

  const agent = result.data?.agent ?? null;
  if (!agent) return null;

  return (
    <TenantAgentConfigSection
      tenantId={tenantId}
      agent={agent}
      onSaved={() => reexecute({ requestPolicy: "network-only" })}
    />
  );
}
