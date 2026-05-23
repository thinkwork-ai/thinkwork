import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import { PageLayout } from "@/components/PageLayout";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authed/_tenant/capabilities")({
  component: CapabilitiesLayout,
});

function CapabilitiesLayout() {
  const { pathname } = useLocation();
  // Skills tab removed — with a single platform agent per tenant, skill
  // sharing across agents is no longer a concern and skills are
  // configured filesystem-only in the agent / Space workspace. The
  // `agent_skills` table + derive pipeline retire in their own
  // brainstorm; this just removes the admin surface.
  const currentTab = pathname.startsWith("/capabilities/mcp-servers")
    ? "mcp-servers"
    : "builtin-tools";

  return (
    <PageLayout
      header={
        <div className="grid grid-cols-3 items-center">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight leading-tight text-foreground">
              Tools
            </h1>
          </div>
          <div className="flex justify-center">
            <Tabs value={currentTab}>
              <TabsList>
                <TabsTrigger value="builtin-tools" asChild className="px-2">
                  <Link to="/capabilities/builtin-tools">Built-in Tools</Link>
                </TabsTrigger>
                <TabsTrigger value="mcp-servers" asChild className="px-2">
                  <Link to="/capabilities/mcp-servers">MCP Servers</Link>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div />
        </div>
      }
    >
      <Outlet />
    </PageLayout>
  );
}
