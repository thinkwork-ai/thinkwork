import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_shell/spaces/$spaceId")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/threads",
      search: { spaceId: params.spaceId },
      replace: true,
    });
  },
});
