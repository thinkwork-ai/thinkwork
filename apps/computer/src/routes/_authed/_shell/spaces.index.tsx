import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_shell/spaces/")({
  beforeLoad: () => {
    throw redirect({
      to: "/new",
      search: { spaceId: undefined },
      replace: true,
    });
  },
});
