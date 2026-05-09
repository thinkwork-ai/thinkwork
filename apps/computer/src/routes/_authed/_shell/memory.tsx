import { createFileRoute, Outlet } from "@tanstack/react-router";
import { usePageHeaderActions } from "@/context/PageHeaderContext";

export const Route = createFileRoute("/_authed/_shell/memory")({
  component: MemoryLayout,
});

export const MEMORY_TABS = [
  { to: "/memory/brain", label: "Memories" },
  { to: "/memory/pages", label: "Pages" },
  { to: "/memory/kbs", label: "KBs" },
] as const;

function MemoryLayout() {
  usePageHeaderActions({ title: "Memory" });
  return <Outlet />;
}
