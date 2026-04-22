import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "urql";
import { useTenant } from "@/context/TenantContext";
import { AgentsListQuery } from "@/lib/graphql-queries";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PerformanceView } from "../-analytics/PerformanceView";

export const Route = createFileRoute("/_authed/_tenant/analytics/performance")({
  component: PerformancePage,
});

function PerformancePage() {
  const { tenantId } = useTenant();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const [agentsResult] = useQuery({
    query: AgentsListQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
  });
  const allAgents = (agentsResult.data as any)?.agents ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Select
          value={selectedAgentId ?? "all"}
          onValueChange={(v) => setSelectedAgentId(v === "all" ? null : v)}
        >
          <SelectTrigger className="w-48 h-8 text-sm">
            <SelectValue placeholder="All agents" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All agents</SelectItem>
            {allAgents.map((a: { id: string; name: string }) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <PerformanceView selectedAgentId={selectedAgentId} />
    </div>
  );
}
