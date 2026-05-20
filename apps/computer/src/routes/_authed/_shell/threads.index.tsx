import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_shell/threads/")({
  beforeLoad: () => {
    throw redirect({
      to: "/new",
      search: { spaceId: undefined },
      replace: true,
    });
  },
});
