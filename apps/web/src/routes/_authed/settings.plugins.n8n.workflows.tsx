import { createFileRoute } from "@tanstack/react-router";
import { N8nPluginHome } from "@/components/settings/plugins/n8n/N8nPluginHome";

export const Route = createFileRoute("/_authed/settings/plugins/n8n/workflows")(
  {
    component: () => <N8nPluginHome tab="workflows" />,
  },
);
