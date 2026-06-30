import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/settings/memory/knowledge-graph")(
  {
    beforeLoad: () => {
      throw redirect({ to: "/settings/memory/ontology", replace: true });
    },
  },
);
