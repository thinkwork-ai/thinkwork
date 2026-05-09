import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";

export const Route = createFileRoute("/_authed/_shell/customize")({
  component: CustomizePage,
});

function CustomizePage() {
  useBreadcrumbs([{ label: "Customize" }]);
  return (
    <PlaceholderPage
      title="Customize"
      subtitle="Computer instructions, connectors, skills, and workflow preferences will live here."
    />
  );
}
