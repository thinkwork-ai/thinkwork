import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/settings/plugins/n8n/workflows")(
  {
    beforeLoad: () => {
      throw redirect({ to: "/settings/plugins/n8n", replace: true });
    },
  },
);
