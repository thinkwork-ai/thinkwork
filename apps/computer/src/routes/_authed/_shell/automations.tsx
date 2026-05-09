import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";

export const Route = createFileRoute("/_authed/_shell/automations")({
  component: AutomationsPage,
});

function AutomationsPage() {
  useBreadcrumbs([{ label: "Automations" }]);
  return (
    <PlaceholderPage
      title="Automations"
      subtitle="Routines, scheduled jobs, and webhooks for your Computer. The real list lands in the next phase."
    />
  );
}
