import { createFileRoute } from "@tanstack/react-router";
import { ManagedApplicationsPage } from "@/components/settings/managed-applications/ManagedApplicationsPage";

export const Route = createFileRoute("/_authed/settings/managed-applications")({
  component: ManagedApplicationsPage,
});
