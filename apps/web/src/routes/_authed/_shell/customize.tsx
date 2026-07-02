import { createFileRoute, Outlet } from "@tanstack/react-router";
import { usePageHeaderActions } from "@/context/PageHeaderContext";

export const Route = createFileRoute("/_authed/_shell/customize")({
  component: CustomizeLayout,
});

// Skills moved to Settings→Composer (Composer plan U3); /customize/skills
// redirects to the index for stale links.
export const CUSTOMIZE_TABS = [
  { to: "/customize/workflows", label: "Workflow Templates" },
] as const;

function CustomizeLayout() {
  usePageHeaderActions({ title: "Customize" });
  return <Outlet />;
}
