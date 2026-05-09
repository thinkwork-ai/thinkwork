import { createFileRoute, Outlet } from "@tanstack/react-router";
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
  // Tabs ride up to AppTopBar so /memory/* renders a single header instead
  // of stacking a sub-header below the global one. AppTopBar derives the
  // active tab from window pathname.
  usePageHeaderActions({ title: "Memory", tabs: [...TABS] });
  return <Outlet />;
}
