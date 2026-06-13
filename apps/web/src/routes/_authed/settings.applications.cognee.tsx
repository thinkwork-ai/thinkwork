import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/settings/applications/cognee")({
  beforeLoad: () => {
    throw redirect({
      to: "/settings/plugins/$pluginKey",
      params: { pluginKey: "company-brain" },
    });
  },
});
