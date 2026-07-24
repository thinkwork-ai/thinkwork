import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy top-level URL redirects to the Memory tab under Memory settings
// (the Ontology tab retired to the standalone console — THINK-339 U15).
export const Route = createFileRoute("/_authed/settings/knowledge-graph")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/memory/records", replace: true });
  },
});
