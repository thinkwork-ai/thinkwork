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

export const KNOWLEDGE_TABS: {
  value: KnowledgeTab;
  to:
    | "/knowledge/memory"
    | "/knowledge/wiki"
    | "/knowledge/knowledge-bases"
    | "/knowledge/context-engine";
  label: string;
}[] = [
  { value: "memory", to: "/knowledge/memory", label: "Memory" },
  { value: "wiki", to: "/knowledge/wiki", label: "Pages" },
  {
    value: "knowledge-bases",
    to: "/knowledge/knowledge-bases",
    label: "KBs",
  },
  { value: "context-engine", to: "/knowledge/context-engine", label: "Search" },
];

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
              Brain
            </h1>
          </div>
          <div className="flex justify-center">
            <Tabs value={currentTab}>
              <TabsList>
                {KNOWLEDGE_TABS.map((tab) => (
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
      <Outlet />
    </PageLayout>
  );
}
