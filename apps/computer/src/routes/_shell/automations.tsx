import { createFileRoute } from "@tanstack/react-router";
import { PlaceholderPage } from "@/components/PlaceholderPage";

export const Route = createFileRoute("/_shell/automations")({
  component: AutomationsPage,
});

function AutomationsPage() {
  return (
    <PlaceholderPage
      title="Automations"
      subtitle="Routines, scheduled jobs, and webhooks for your Computer. The real list lands in the next phase."
    />
  );
}
