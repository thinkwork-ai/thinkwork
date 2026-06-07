import { createFileRoute } from "@tanstack/react-router";
import { SpacesThreadDetailRoute } from "@/components/workbench/SpacesThreadDetailRoute";

export const Route = createFileRoute(
  "/_authed/_shell/spaces/$spaceId/threads/$threadId",
)({
  component: SpaceThreadDetailPage,
});

function SpaceThreadDetailPage() {
  const { threadId } = Route.useParams();
  return <SpacesThreadDetailRoute threadId={threadId} />;
}
