import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { ToggleGroup, ToggleGroupItem } from "@thinkwork/ui";
import { usePageHeaderActions } from "@/context/PageHeaderContext";

export const Route = createFileRoute("/_authed/_shell/memory")({
  component: MemoryLayout,
});

const TABS = [
  { to: "/memory/brain", label: "Brain" },
  { to: "/memory/pages", label: "Pages" },
  { to: "/memory/kbs", label: "KBs" },
] as const;

function MemoryLayout() {
  usePageHeaderActions({ title: "Memory" });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Match by longest prefix so /memory/kbs/$kbId still highlights "KBs".
  const activeTab =
    [...TABS].reverse().find((t) => pathname === t.to || pathname.startsWith(`${t.to}/`))?.to ??
    "/memory/brain";

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex shrink-0 justify-center border-b border-border/50 px-6 pt-4 pb-3">
        <ToggleGroup type="single" value={activeTab} variant="outline">
          {TABS.map((tab) => (
            <ToggleGroupItem key={tab.to} value={tab.to} asChild className="px-4 text-xs">
              <Link to={tab.to}>{tab.label}</Link>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
    </main>
  );
}
