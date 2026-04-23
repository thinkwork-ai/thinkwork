import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authed/_tenant/agent-templates/$templateId/",
)({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/agent-templates/$templateId/$tab",
      params: { templateId: params.templateId, tab: "configuration" },
      replace: true,
    });
  },
});
