import { createFileRoute, Outlet } from "@tanstack/react-router";
import { usePageHeaderActions } from "@/context/PageHeaderContext";

export const Route = createFileRoute("/_authed/_shell/customize")({
  component: CustomizeLayout,
});

export const CUSTOMIZE_TABS = [
  { to: "/customize/connectors", label: "Connectors" },
  { to: "/customize/skills", label: "Skills" },
  { to: "/customize/workflows", label: "Workflows" },
] as const;

function CustomizeLayout() {
  usePageHeaderActions({ title: "Customize" });
  return <Outlet />;
}
