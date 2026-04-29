import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_tenant/knowledge/")({
  beforeLoad: () => {
    throw redirect({
      to: "/knowledge/memory",
      replace: true,
    });
  },
});
