import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import { PageLayout } from "@/components/PageLayout";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authed/_tenant/knowledge")({
  component: KnowledgeLayout,
});

export type KnowledgeTab =
  | "memory"
  | "wiki"
  | "knowledge-bases"
  | "context-engine";

export function currentKnowledgeTab(pathname: string): KnowledgeTab {
  if (pathname.startsWith("/knowledge/wiki")) return "wiki";
  if (pathname.startsWith("/knowledge/knowledge-bases")) {
    return "knowledge-bases";
  }
  if (pathname.startsWith("/knowledge/context-engine")) {
    return "context-engine";
  }
  return "memory";
}

function KnowledgeLayout() {
  const { pathname } = useLocation();
  const currentTab = currentKnowledgeTab(pathname);

  return (
    <PageLayout
      header={
        <div className="grid grid-cols-3 items-center gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold leading-tight tracking-tight text-foreground">
              Knowledge
            </h1>
          </div>
          <div className="flex justify-center">
            <Tabs value={currentTab}>
              <TabsList>
                <TabsTrigger value="memory" asChild className="px-2">
                  <Link to="/knowledge/memory">Memory</Link>
                </TabsTrigger>
                <TabsTrigger value="wiki" asChild className="px-2">
                  <Link to="/knowledge/wiki">Wiki</Link>
                </TabsTrigger>
                <TabsTrigger value="knowledge-bases" asChild className="px-2">
                  <Link to="/knowledge/knowledge-bases">Knowledge Bases</Link>
                </TabsTrigger>
                <TabsTrigger value="context-engine" asChild className="px-2">
                  <Link to="/knowledge/context-engine">Context Engine</Link>
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
