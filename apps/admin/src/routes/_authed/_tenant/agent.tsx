import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import { useQuery } from "urql";
import { PageLayout } from "@/components/PageLayout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useTenant } from "@/context/TenantContext";
import { TenantAgentQuery } from "@/lib/graphql-queries";

export const Route = createFileRoute("/_authed/_tenant/agent")({
  component: AgentLayout,
});

export type AgentTab = "files" | "config" | "tools" | "mcp-servers";

export const AGENT_TABS: {
  value: AgentTab;
  to: "/agent/files" | "/agent/config" | "/agent/tools" | "/agent/mcp-servers";
  label: string;
}[] = [
  { value: "files", to: "/agent/files", label: "Files" },
  { value: "config", to: "/agent/config", label: "Config" },
  { value: "tools", to: "/agent/tools", label: "Built-in Tools" },
  { value: "mcp-servers", to: "/agent/mcp-servers", label: "MCP Servers" },
];

export function currentAgentTab(pathname: string): AgentTab {
  if (pathname.startsWith("/agent/mcp-servers")) return "mcp-servers";
  if (pathname.startsWith("/agent/tools")) return "tools";
  if (pathname.startsWith("/agent/config")) return "config";
  return "files";
}

function AgentLayout() {
  const { tenantId } = useTenant();
  const { pathname } = useLocation();
  const currentTab = currentAgentTab(pathname);
  useBreadcrumbs([{ label: "Agent" }]);

  const [result] = useQuery({
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
        <div className="grid grid-cols-3 items-center gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold leading-tight tracking-tight text-foreground">
              Agent
            </h1>
          </div>
          <div className="flex justify-center">
            <Tabs value={currentTab}>
              <TabsList>
                {AGENT_TABS.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    asChild
                    className="px-2"
                  >
                    <Link to={tab.to}>{tab.label}</Link>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <div />
        </div>
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
        <Outlet />
      )}
    </PageLayout>
  );
}
