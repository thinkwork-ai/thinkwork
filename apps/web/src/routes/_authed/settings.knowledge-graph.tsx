import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy top-level URL redirects to the Ontology tab under Memory settings.
export const Route = createFileRoute("/_authed/settings/knowledge-graph")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/memory/ontology", replace: true });
  },
});
