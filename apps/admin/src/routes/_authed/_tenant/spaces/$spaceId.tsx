import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_tenant/spaces/$spaceId")({
  component: SpaceDetailRedirect,
});

function SpaceDetailRedirect() {
  const { spaceId } = Route.useParams();

  return (
    <Navigate to="/spaces/$spaceId/workspace" params={{ spaceId }} replace />
  );
}
