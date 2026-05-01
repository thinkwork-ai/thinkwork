import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_tenant/routines/$routineId")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/automations/routines/$routineId",
      params,
    });
  },
});
