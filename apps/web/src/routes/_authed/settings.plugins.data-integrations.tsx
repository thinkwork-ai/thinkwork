import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authed/settings/plugins/data-integrations",
)({
  beforeLoad: () => {
    throw redirect({
      to: "/settings/plugins/$pluginKey",
      params: { pluginKey: "company-etl" },
    });
  },
});
