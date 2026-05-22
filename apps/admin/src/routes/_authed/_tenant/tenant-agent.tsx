import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Bot, FolderTree, Settings2 } from "lucide-react";
import { useQuery } from "urql";
import { TenantAgentConfigSection } from "@/components/tenant-agent/TenantAgentConfigSection";
import { TenantAgentSubAgentsTab } from "@/components/tenant-agent/TenantAgentSubAgentsTab";
import { TenantAgentWorkspaceTab } from "@/components/tenant-agent/TenantAgentWorkspaceTab";
import { PageHeader } from "@/components/PageHeader";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
import { TenantAgentQuery } from "@/lib/graphql-queries";

type TenantAgentTab = "config" | "workspace" | "sub-agents";

export const Route = createFileRoute("/_authed/_tenant/tenant-agent")({
  component: TenantAgentPage,
  validateSearch: (search: Record<string, unknown>) => ({
    tab: parseTab(search.tab),
  }),
});

function parseTab(value: unknown): TenantAgentTab {
  if (value === "workspace" || value === "sub-agents") return value;
  return "config";
}

function TenantAgentPage() {
  const { tenantId } = useTenant();
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  useBreadcrumbs([{ label: "Tenant agent" }]);

  const [result, reexecute] = useQuery({
    query: TenantAgentQuery,
    variables: { tenantId: tenantId! },
    pause: !tenantId,
    requestPolicy: "cache-and-network",
  });

  if (!tenantId || (result.fetching && !result.data)) return <PageSkeleton />;

  const agent = result.data?.agent ?? null;

  return (
    <PageLayout
      header={
        <PageHeader
          title="Tenant agent"
          description="Configure the platform agent baseline for this tenant."
        />
      }
    >
      {result.error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {result.error.message}
        </div>
      ) : !agent ? (
        <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
          No tenant agent is available.
        </div>
      ) : (
        <div className="space-y-4">
          <Tabs
            value={tab}
            onValueChange={(next) =>
              navigate({
                to: "/tenant-agent",
                search: { tab: next as TenantAgentTab },
              })
            }
          >
            <TabsList>
              <TabsTrigger value="config">
                <Settings2 className="h-4 w-4" />
                Config
              </TabsTrigger>
              <TabsTrigger value="workspace">
                <Bot className="h-4 w-4" />
                Workspace
              </TabsTrigger>
              <TabsTrigger value="sub-agents">
                <FolderTree className="h-4 w-4" />
                Sub-agents
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === "config" ? (
            <TenantAgentConfigSection
              tenantId={tenantId}
              agent={agent}
              onSaved={() => reexecute({ requestPolicy: "network-only" })}
            />
          ) : tab === "workspace" ? (
            <TenantAgentWorkspaceTab agentId={agent.id} />
          ) : (
            <TenantAgentSubAgentsTab agentId={agent.id} />
          )}
        </div>
      )}
    </PageLayout>
  );
}
